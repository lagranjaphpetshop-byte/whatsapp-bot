require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// ================= ENV =================
const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
const SHEET_URL = process.env.SHEET_URL;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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

// ================= CHAT LOG =================
function addChat(from, text, role = "user") {
  if (!chats[from]) chats[from] = [];

  chats[from].push({
    role,
    text,
    time: new Date().toISOString()
  });

  if (chats[from].length > 50) chats[from].shift();
}

// ================= VERIFY WEBHOOK =================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = req.query["hub.verify_token"];

  if (mode === "subscribe" && verifyToken === verify_token) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {

  res.sendStatus(200);

  try {

    const body = req.body;

    if (!body.entry) return;

    const change = body.entry[0].changes[0].value;

    // 🔥 SOLO procesar mensajes reales
    if (!change.messages) return;

    const message = change.messages[0];

    if (!message.text) return;

    const from = message.from;
    const text = message.text.body.trim().toLowerCase();
    const id = message.id;

    if (processed.has(id)) return;
    processed.add(id);

    console.log("📩 MENSAJE:", from, text);

    // init user
    if (!users[from]) {
      users[from] = {
        step: "idle",
        name: "",
        pet: "",
        date: "",
        time: ""
      };
    }

    addChat(from, text, "user");

    let reply = "";

    // ================= MENU =================
    if (text === "hola" || text === "menu") {

      users[from].step = "idle";

      reply =
`🐾 *La Granja PH*

1️⃣ Agendar cita
2️⃣ Productos
3️⃣ Asesor humano
4️⃣ Consulta médica`;

    }

    // ================= AGENDAR =================
    else if (text === "1" && users[from].step === "idle") {
      users[from].step = "name";
      reply = "👤 ¿Cuál es tu nombre?";
    }

    else if (users[from].step === "name") {
      users[from].name = text;
      users[from].step = "pet";
      reply = "🐶 ¿Nombre de tu mascota?";
    }

    else if (users[from].step === "pet") {
      users[from].pet = text;
      users[from].step = "date";
      reply = "📅 Fecha (YYYY-MM-DD)";
    }

    else if (users[from].step === "date") {
      users[from].date = text;
      users[from].step = "time";

      reply =
`⏰ Horarios disponibles:

1️⃣ 9:00 AM
2️⃣ 11:00 AM
3️⃣ 2:00 PM
4️⃣ 4:00 PM`;
    }

    else if (users[from].step === "time") {

      const slots = {
        "1": "9:00 AM",
        "2": "11:00 AM",
        "3": "2:00 PM",
        "4": "4:00 PM"
      };

      if (!slots[text]) {
        reply = "❌ Elige un número del 1 al 4";
      } else {

        users[from].time = slots[text];

        try {
          if (SHEET_URL) {
            await axios.post(SHEET_URL, {
              nombre: users[from].name,
              mascota: users[from].pet,
              servicio: "Baño y grooming",
              fecha: users[from].date,
              hora: users[from].time
            });
          }

          reply =
`✅ *Cita confirmada*

👤 ${users[from].name}
🐶 ${users[from].pet}
📅 ${users[from].date}
⏰ ${users[from].time}

Te esperamos 🐾`;

          users[from].step = "idle";

        } catch (e) {
          reply = "⚠️ Error guardando cita";
        }
      }
    }

    // ================= PRODUCTOS =================
    else if (text === "2") {
      reply = "🍖 Tenemos comida premium, accesorios y snacks para mascotas 🐶";
    }

    // ================= ASESOR =================
    else if (text === "3") {
      users[from].step = "advisor";
      reply = "👩‍⚕️ Un asesor humano te responderá pronto. Escribe tu consulta.";
    }

    // ================= CONSULTA MÉDICA =================
    else if (text === "4") {
      users[from].step = "medical";
      reply = "🩺 Describe los síntomas de tu mascota.";
    }

    else if (users[from].step === "advisor") {
      reply = "📩 Tu mensaje fue enviado al asesor.";
    }

    else if (users[from].step === "medical") {
      reply = "🩺 Un veterinario revisará tu caso pronto.";
    }

    // ================= IA =================
    else if (users[from].step === "idle" && client) {

      const completion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Eres asistente veterinario de una petshop. Responde corto, amable y profesional."
          },
          { role: "user", content: text }
        ]
      });

      reply = completion.choices[0].message.content;
    }

    else {
      reply = "Escribe *menu* para ver opciones 🐾";
    }

    addChat(from, reply, "bot");

    // ================= SEND MESSAGE =================
    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

  } catch (err) {
    console.log("❌ ERROR:", err.response?.data || err.message);
  }
});

// ================= PANEL =================
app.get("/panel", (req, res) => {

  let html = `<h1>📊 Panel La Granja PH</h1><hr/>`;

  for (let user in chats) {

    html += `<h3>📱 ${user}</h3>`;

    chats[user].slice(-10).forEach(m => {

      html += `
      <div style="padding:5px;margin:5px;background:${m.role === "user" ? "#e3f2fd" : "#e8f5e9"}">
        <b>${m.role === "user" ? "Cliente" : "Bot"}:</b> ${m.text}
        <br><small>${m.time}</small>
      </div>`;
    });

    html += "<hr/>";
  }

  res.send(html);
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Bot activo en puerto", PORT);
});
