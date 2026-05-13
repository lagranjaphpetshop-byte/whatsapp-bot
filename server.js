require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// =========================
// ENV CHECK
// =========================
console.log("ENV CHECK:", {
  TOKEN_WHATSAPP: !!process.env.TOKEN_WHATSAPP,
  VERIFY_TOKEN: !!process.env.VERIFY_TOKEN,
  OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
  SHEET_URL: !!process.env.SHEET_URL
});

const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
const SHEET_URL = process.env.SHEET_URL;

// =========================
// IA (OpenRouter)
// =========================
let client = null;

if (process.env.OPENROUTER_API_KEY) {
  client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  });
}

// =========================
// MEMORY DB
// =========================
const users = {};
const chats = {};
const processed = new Set();

// =========================
// WEBHOOK VERIFY
// =========================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = req.query["hub.verify_token"];

  if (mode && verifyToken === verify_token) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// =========================
// WEBHOOK RECEIVE
// =========================
app.post("/webhook", async (req, res) => {

  console.log("📩 WEBHOOK HIT:", JSON.stringify(req.body, null, 2));

  res.sendStatus(200);

  try {

    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const text = message.text?.body?.toLowerCase().trim() || "";
    const id = message.id;

    // evitar duplicados
    if (processed.has(id)) return;
    processed.add(id);

    // init user
    if (!users[from]) {
      users[from] = { step: "", name: "", pet: "", date: "", time: "" };
    }

    // init chat log
    if (!chats[from]) chats[from] = [];

    // guardar mensaje
    chats[from].push({
      from,
      text,
      time: new Date().toISOString()
    });

    let reply = "";

    // ================= MENU =================
    if (text === "hola" || text === "menu") {
      users[from].step = "";
      reply = `🐾 La Granja PH

1️⃣ Agendar cita
2️⃣ Productos
3️⃣ Asesor
4️⃣ Consulta médica`;
    }

    // ================= AGENDA =================
   else if (text === "1" && !users[from].step) {
      users[from].step = "name";
      reply = "👤 ¿Tu nombre?";
    }

    else if (users[from].step === "name") {
      users[from].name = text;
      users[from].step = "pet";
      reply = "🐶 Nombre de tu mascota?";
    }

    else if (users[from].step === "pet") {
      users[from].pet = text;
      users[from].step = "date";
      reply = "📅 Fecha (YYYY-MM-DD)";
    }

    else if (users[from].step === "date") {
      users[from].date = text;
      users[from].step = "time";
      reply = "⏰ 1=9am 2=11am 3=2pm 4=4pm";
    }

    else if (users[from].step === "time") {

      const slots = {
        "1": "9:00 AM",
        "2": "11:00 AM",
        "3": "2:00 PM",
        "4": "4:00 PM"
      };

      if (!slots[text]) {
        reply = "❌ Elige 1-4";
      } else {

        users[from].time = slots[text];

        try {
          const r = await axios.post(SHEET_URL, {
            nombre: users[from].name,
            mascota: users[from].pet,
            servicio: "Baño",
            fecha: users[from].date,
            hora: users[from].time
          });

          reply = ` ✅ Cita confirmada para ${users[from].pet}`;

          delete users[from];

        } catch (e) {
          reply = "⚠️ Error guardando cita";
        }
      }
    }

    // ================= PRODUCTOS =================
    else if (text === "2") {
      reply = "🍖 Tenemos comida premium para perros y gatos";
    }

    // ================= ASESOR =================
    else if (text === "3" || text.includes("asesor") || text.includes("humano")) {

      users[from].step = "advisor";

      reply = "👩‍⚕️ Un asesor te atenderá pronto. Escribe tu consulta.";
    }

    // ================= CONSULTA MÉDICA =================
    else if (text === "4" || users[from].step === "advisor") {

      reply = "🩺 Describe el problema de tu mascota y un veterinario te responde.";

    }

    // ================= IA =================
    else {

      if (client) {
        const completion = await client.chat.completions.create({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "Eres asistente de veterinaria. Respuestas cortas."
            },
            { role: "user", content: text }
          ]
        });

        reply = completion.choices[0].message.content;
      } else {
        reply = "🤖 IA no disponible";
      }
    }

    // enviar WhatsApp
    await axios.post(
      "https://graph.facebook.com/v22.0/1168848789639885/messages",
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply }
      },
      {
        headers: {
          Authorization: ` Bearer ${token}`
        }
      }
    );

    console.log("✔️ respuesta enviada");

  } catch (err) {
    console.log("ERROR:", err.message);
  }
});

// =========================
// PANEL WEB (WHATSAPP BUSINESS STYLE)
// =========================
app.get("/panel", (req, res) => {

  let html = ` <h1>📊 PANEL LA GRANJA PH</h1>`;
  html += `<p>Total chats: ${Object.keys(chats).length}</p><hr/> `;

  for (let user in chats) {

    html += ` <h3>📱 ${user}</h3>`;

    chats[user].slice(-15).forEach(m => {
      html += `<p><b>${m.from}</b>: ${m.text}<br><small>${m.time}</small></p> `;
    });

    html += "<hr/>";
  }

  res.send(html);
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Servidor corriendo en puerto", PORT);
});
