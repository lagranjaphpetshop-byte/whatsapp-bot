require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// ================= ENV =================
const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
const SHEET_URL = process.env.SHEET_URL;

// ================= OPENROUTER =================
let client = null;

if (process.env.OPENROUTER_API_KEY) {
    client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
    });
}

// ================= GOOGLE CALENDAR =================
let calendar = null;

try {
    const auth = new google.auth.GoogleAuth({
        keyFile: "credentials.json",
        scopes: ["https://www.googleapis.com/auth/calendar"]
    });

    calendar = google.calendar({ version: "v3", auth });

} catch (e) {
    console.log("⚠️ Calendar no configurado");
}

// ================= MEMORY =================
const users = {};
const processed = new Set();

// ================= VERIFY =================
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = req.query["hub.verify_token"];

    if (mode && verifyToken === verify_token) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
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

        let reply = "";

        // ================= MENU =================
        if (text === "hola" || text === "menu") {

            users[from].step = "idle";

            reply =
`🐾 bienvenidos La Granja PH

1️⃣ Agendar cita
2️⃣ Productos
3️⃣ Asesor
4️⃣ Consulta médica`;
        }

        // ================= START FLOW =================
        else if (text === "1" && users[from].step === "idle") {
            users[from].step = "name";
            reply = "👤 ¿Cuál es tu nombre?";
        }

        else if (users[from].step === "name") {
            users[from].name = text;
            users[from].step = "pet";
            reply = "🐶 Nombre de tu mascota";
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

                // ================= SHEETS =================
                try {
                    await axios.post(SHEET_URL, {
                        nombre: users[from].name,
                        mascota: users[from].pet,
                        servicio: "Baño y grooming",
                        fecha: users[from].date,
                        hora: users[from].time
                    });
                } catch (e) {
                    console.log("Sheets error");
                }

                // ================= CALENDAR =================
                try {
                    if (calendar) {
                        await calendar.events.insert({
                            calendarId: "primary",
                            requestBody: {
                                summary: `Cita - ${users[from].pet} `,
                                description: `Cliente: ${users[from].name} `,
                                start: {
                                    dateTime: `${users[from].date}T10:00:00 `,
                                    timeZone: "America/Bogota"
                                },
                                end: {
                                    dateTime: `${users[from].date}T10:30:00 `,
                                    timeZone: "America/Bogota"
                                }
                            }
                        });
                    }
                } catch (e) {
                    console.log("Calendar error");
                }

                reply = `✅ Cita confirmada para ${users[from].pet} a las ${users[from].time} `;

                users[from].step = "idle";
            }
        }

        // ================= OTHER OPTIONS =================
        else if (text === "2") {
            reply = "🍖 Comida premium para perros y gatos";
        }

        else if (text === "3") {
            reply = "👩‍⚕️ Un asesor te responderá pronto";
        }

        else if (text === "4") {
            reply = "🩺 Describe el problema de tu mascota";
        }

        // ================= IA =================
        else if (users[from].step === "idle" && client) {

            const completion = await client.chat.completions.create({
                model: "openai/gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "Eres asistente veterinario. Respuestas cortas."
                    },
                    {
                        role: "user",
                        content: text
                    }
                ]
            });

            reply = completion.choices[0].message.content;
        }

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

        console.log("✔️ enviado");

    } catch (err) {
        console.log("ERROR:", err.message);
    }
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Bot listo en puerto", PORT);
});
