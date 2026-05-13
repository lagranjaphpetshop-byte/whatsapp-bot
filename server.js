require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// ================= ENV =================
const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SHEET_URL = process.env.SHEET_URL;

// ================= IA =================
let client = null;

if (process.env.OPENROUTER_API_KEY) {
  client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  });
}

// ================= MEMORY =================
const users = {};
const chats = {};
const processed = new Set();

function addChat(from, role, content) {
  if (!chats[from]) chats[from] = [];
  chats[from].push({ role, content });

  if (chats[from].length > 15) chats[from].shift();
}

// ================= VERIFY =================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = req.query["hub.verify_token"];

  if (mode && verifyToken === verify_token) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    if (!value || !value.messages) return;

    const message = value.messages[0];
    if (!message.text) return;

    const from = message.from;
    const text = message.text.body.toLowerCase().trim();
    const id = message.id;

    if (processed.has(id)) return;
    processed.add(id);
    if (processed.size > 1000) processed.clear();

    const timestamp = parseInt(message.timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > 20) return;

    if (!users[from]) {
      users[from] = { step: "idle" };
    }

    addChat(from, "user", text);

    let reply = "";

    // ===================== FLUJOS PRIORIDAD =====================

    if (users[from].step === "name") {
      users[from].name = text;
      users[from].step = "pet";
      reply = "🐶 Perfecto 😊 ¿Cómo se llama tu mascota?";
    }

    else if (users[from].step === "pet") {
      users[from].pet = text;
      users[from].step = "date";
      reply = "📅 ¿Para qué fecha deseas el baño? (Ej: 2026-05-20)";
    }

    else if (users[from].step === "date") {
      users[from].date = text;
      users[from].step = "time";

      reply =
`⏰ Horarios disponibles:

1️⃣ 9:00 AM  
2️⃣ 11:00 AM  
3️⃣ 2:00 PM  
4️⃣ 4:00 PM  

Escribe el número del horario 😊`;
    }

    else if (users[from].step === "time") {

      const slots = {
        "1": "9:00 AM",
        "2": "11:00 AM",
        "3": "2:00 PM",
        "4": "4:00 PM"
      };

      if (!slots[text]) {
        reply = "❌ Por favor elige un número del 1 al 4 😊";
      } else {

        users[from].time = slots[text];

        try {
          await axios.post(SHEET_URL, {
            nombre: users[from].name,
            mascota: users[from].pet,
            servicio: "Baño y grooming",
            fecha: users[from].date,
            hora: users[from].time
          });

          reply =
`✅ *Cita confirmada* 🐾

👤 ${users[from].name}  
🐶 ${users[from].pet}  
📅 ${users[from].date}  
⏰ ${users[from].time}

¡Te esperamos en La Granja PH! 💚`;

          users[from].step = "idle";

        } catch (e) {
          reply = "⚠️ Hubo un error guardando la cita. Intenta nuevamente.";
        }
      }
    }

    else if (users[from].step === "medical") {
      reply = "🩺 Gracias por la información. Nuestro veterinario revisará tu caso y te responderá pronto.";
      users[from].step = "idle";
    }

    // ===================== MENÚ PRINCIPAL =====================

    else if (["hola","menu","buenas","buenos dias","buenas tardes"].includes(text)) {

      users[from].step = "idle";

      reply =
`🐾 *Bienvenido a La Granja PH* 🐾

1️⃣ Agendar baño o grooming  
2️⃣ Ver comidas para perros  
3️⃣ Consulta veterinaria  
4️⃣ Hablar con asesor humano  

Escribe el número de la opción 😊`;
    }

    else if (text === "1" && users[from].step === "idle") {
      users[from].step = "name";
      reply = "👤 ¡Genial! ¿Cuál es tu nombre?";
    }

    // ===================== PRODUCTOS REALES =====================

    else if (text === "2" && users[from].step === "idle") {

      reply =
`🍖 *Comidas disponibles para perros:*

🔹 Chunky Adulto / Cachorro  
🔹 Dog Chow (Purina)  
🔹 Pedigree Adulto y Puppy  
🔹 Pro Plan (Premium)  
🔹 Royal Canin (Especializadas)  
🔹 Taste of the Wild  
🔹 Monello  
🔹 Hills Science Diet  

Tenemos líneas para:
✔ Cachorros  
✔ Adultos  
✔ Senior  
✔ Razas pequeñas  
✔ Razas grandes  
✔ Perros con alergias  
✔ Problemas digestivos  

¿Para qué edad o necesidad buscas alimento? 😊`;
    }

    else if (text === "3" && users[from].step === "idle") {
      users[from].step = "medical";
      reply = "🩺 Cuéntanos qué síntomas presenta tu mascota y te orientamos con gusto.";
    }

    else if (text === "4" && users[from].step === "idle") {
      reply = "👩‍💼 Un asesor humano te responderá en breve. Gracias por tu paciencia 😊";
    }

    // ===================== IA INTELIGENTE =====================

    else if (client) {

      const completion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres asistente profesional de un petshop llamado La Granja PH en Colombia. Responde amable, clara y útil. Si es emergencia veterinaria grave, recomienda acudir a urgencias."
          },
          ...chats[from].map(m => ({
            role: m.role,
            content: m.content
          }))
        ],
      });

      reply = completion.choices[0].message.content;
    }

    else {
      reply = "Escribe *menu* para ver las opciones disponibles 🐾";
    }

    addChat(from, "assistant", reply);

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

  } catch (err) {
    console.log("ERROR:", err.response?.data || err.message);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Bot profesional La Granja PH activo en puerto", PORT);
});
