const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// =========================
// ENV CHECK
// =========================
console.log("🚀 BOT ONLINE");

const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
const SHEET_URL = process.env.SHEET_URL;

// =========================
// OPENROUTER
// =========================
let client = null;

if (process.env.OPENROUTER_API_KEY) {
    client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
    });
}

// =========================
// MEMORY
// =========================
const users = {};
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
// WEBHOOK
// =========================
app.post("/webhook", async (req, res) => {

    res.sendStatus(200);

    try {

        const value = req.body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (!message || message.type !== "text") return;

        if (processed.has(message.id)) return;
        processed.add(message.id);

        const from = message.from;
        const text = message.text?.body?.toLowerCase().trim();

        if (!users[from]) {
            users[from] = {
                step: "",
                name: "",
                pet: "",
                date: "",
                time: "",
                symptoms: ""
            };
        }

        let reply = "";

        // ================= MENU =================
        if (text === "menu" || text === "hola") {

            users[from].step = "";

            reply =
`🐾 Bienvenido a La GranjaPH soy tu asistente virtual en que puedo ayudarte hoy?

1️⃣ Agendar baño y grooming
2️⃣ Productos
3️⃣ Consulta médica veterinaria
4️⃣ Hablar con asesor`;

        }

        // ================= INICIO FLUJO =================
        else if (users[from].step === "" && text === "1") {

            users[from].step = "name";
            reply = "📝 ¿Cuál es tu nombre?";
        }

        else if (users[from].step === "name") {

            users[from].name = text;
            users[from].step = "pet";

            reply = "🐶 Nombre de tu mascota?:";
        }

        else if (users[from].step === "pet") {

            users[from].pet = text;
            users[from].step = "date";

            reply = "📅 Escribe la fecha asi: (YYYY-MM-DD)";
        }

        else if (users[from].step === "date") {

            // validación simple
            if (!text.match(/^\d{4}-\d{2}-\d{2}$/)) {
                reply = "❌ Formato inválido. Usa YYYY-MM-DD";
            } else {
                users[from].date = text;
                users[from].step = "time";

                reply =
`⏰ Horarios disoonibles:
1️⃣ 9:00 AM
2️⃣ 11:00 AM
3️⃣ 2:00 PM
4️⃣ 4:00 PM`;
            }
        }

        else if (users[from].step === "time") {

            const hours = {
                "1": "9:00 AM",
                "2": "11:00 AM",
                "3": "2:00 PM",
                "4": "4:00 PM"
            };

            if (!hours[text]) {
                reply = "❌ Elige un horario válido (1-4)";
            } else {

                users[from].time = hours[text];

                try {

                    const result = await axios.post(SHEET_URL, {
                        nombre: users[from].name,
                        mascota: users[from].pet,
                        servicio: "Baño y grooming",
                        fecha: users[from].date,
                        hora: users[from].time
                    });

                    if (result.data?.disponible) {
                        reply = `✅ Tu cita a sido confirmada para ${users[from].pet}`;
                        delete users[from];
                    } else {
                        reply = "❌ Horario ocupado, intenta otro horario";
                    }

                } catch {
                    reply = "⚠️ Error en sistema de citas";
                }
            }
        }

        // ================= PRODUCTOS =================
        else if (text === "2") {

            reply =
`🍖 Productos disponibles
* Alimento premium
* Snacks naturales
* Shampoo veterinario

Escribe "menu" para volver`;
        }

        // ================= CONSULTA MÉDICA REAL =================
        else if (text === "3") {

            users[from].step = "symptoms";

            reply =
`🩺 Consulta médica veterinaria

Describe los síntomas de tu mascota.
Ejemplo: "no quiere comer / vomita / está decaído"`;
        }

        else if (users[from].step === "symptoms") {

            users[from].symptoms = text;

            try {

                if (client) {

                    const ai = await client.chat.completions.create({
                        model: "openai/gpt-4o-mini",
                        messages: [
                            {
                                role: "system",
                                content:
`Eres veterinario profesional.
Responde corto, claro y serio.
Si es grave, recomienda consulta presencial.`
                            },
                            {
                                role: "user",
                                content: text
                            }
                        ]
                    });

                    reply = ai.choices[0].message.content;

                } else {
                    reply = "🤖 Servicio no disponible";
                }

            } catch {
                reply = "⚠️ Error en consulta médica";
            }

            users[from].step = "";
        }

        // ================= ASESOR =================
        else if (text === "4") {
            reply = "👩‍⚕️ Un asesor te contactará pronto.";
        }

        // ================= FALLBACK =================
        else {

            if (client) {

                try {

                    const ai = await client.chat.completions.create({
                        model: "openai/gpt-4o-mini",
                        messages: [
                            {
                                role: "system",
                                content: "Responde corto como asistente de veterinaria."
                            },
                            { role: "user", content: text }
                        ]
                    });

                    reply = ai.choices[0].message.content;

                } catch {
                    reply = "⚠️ Error temporal";
                }

            } else {
                reply = "🤖 No disponible";
            }
        }

        // ================= SEND =================
        await axios.post(
            "https://graph.facebook.com/v22.0/1168848789639885/messages",
            {
                messaging_product: "whatsapp",
                to: from,
                type: "text",
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
        console.log("ERROR:", err.message);
    }
});

// =========================
// SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor en puerto " + PORT);
});
