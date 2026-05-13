require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// ================= ENV =================
const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
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

// ================= WEBHOOK VERIFY =================
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
            users[from] = {
                step: "idle",
                name: "",
                pet: "",
                date: "",
                time: ""
            };
        }

        // init chat log
        if (!chats[from]) chats[from] = [];

        chats[from].push({ from, text, time: new Date().toISOString() });

        let reply = "";

        // ================= SOLO RESPONDE SI HAY TEXTO =================
        if (!text) return;

        // ================= MENU =================
        if (text === "hola" || text === "menu") {

            users[from].step = "idle";

            reply =
`🐾 La Granja PH

Bienvenido 👋

Elige una opción:

1️⃣ Agendar cita
2️⃣ Productos
3️⃣ Asesor
4️⃣ Consulta médica`;
        }

        // ================= INICIO SOLO SI ESTA IDLE =================
        else if (text === "1" && users[from].step === "idle") {

            users[from].step = "name";
            reply = "👤 Perfecto, ¿cuál es tu nombre?";
        }

        // ================= FLUJO CONTROLADO =================
        else if (users[from].step === "name") {

            users[from].name = text;
            users[from].step = "pet";
            reply = "🐶 ¿Nombre de tu mascota?";
        }

        else if (users[from].step === "pet") {

            users[from].pet = text;
            users[from].step = "date";
            reply = "📅 Escribe la fecha (YYYY-MM-DD)";
        }

        else if (users[from].step === "date") {

            users[from].date = text;
            users[from].step = "time";

            reply =
`⏰ Elige horario:

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
                    await axios.post(SHEET_URL, {
                        nombre: users[from].name,
                        mascota: users[from].pet,
                        servicio: "Baño",
                        fecha: users[from].date,
                        hora: users[from].time
                    });

                    reply = `✅ Listo ${users[from].name}, tu cita para ${users[from].pet} quedó agendada a las ${users[from].time} `;

                    users[from].step = "idle";

                } catch (e) {
                    reply = "⚠️ Error guardando cita, intenta más tarde";
                }
            }
        }

        // ================= OPCIONES DIRECTAS =================
        else if (text === "2") {
            reply = "🍖 Tenemos alimento premium para perros y gatos. ¿Qué necesitas?";
        }

        else if (text === "3" || text.includes("asesor")) {

            users[from].step = "advisor";

            reply = "👩‍⚕️ Un asesor te responderá pronto. Escribe tu consulta.";
        }

        else if (text === "4" || users[from].step === "advisor") {

            reply = "🩺 Describe el problema de tu mascota y un veterinario lo revisará.";
        }

        // ================= IA SOLO SI ESTA IDLE =================
        else if (users[from].step === "idle") {

            if (client) {
                const completion = await client.chat.completions.create({
                    model: "openai/gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: "Eres asistente veterinario. Respuestas cortas, claras y profesionales."
                        },
                        {
                            role: "user",
                            content: text
                        }
                    ]
                });

                reply = completion.choices[0].message.content;
            } else {
                reply = "🤖 Servicio no disponible en este momento";
            }
        }

        // ================= ENVIO =================
        if (!reply) return;

        await axios.post(
            "https://graph.facebook.com/v22.0/1168848789639885/messages",
            {
                messaging_product: "whatsapp",
                to: from,
                text: { body: reply }
            },
            {
                headers: {
                    Authorization: `Bearer ${token} `
                }
            }
        );

        console.log("✔️ mensaje enviado");

    } catch (err) {
        console.log("ERROR:", err.message);
    }
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Bot corriendo en puerto", PORT);
});
