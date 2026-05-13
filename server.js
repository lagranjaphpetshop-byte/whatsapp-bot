require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// ================= ENV =================
const TOKEN = process.env.TOKEN_WHATSAPP;
const VERIFY = process.env.VERIFY_TOKEN;
const SHEET_URL = process.env.SHEET_URL;

// ================= MEMORY =================
const users = {};
const processed = new Set();

// ================= GOOGLE CALENDAR =================
let calendar = null;

try {
    const auth = new google.auth.GoogleAuth({
        keyFile: "credentials.json",
        scopes: ["https://www.googleapis.com/auth/calendar"]
    });

    calendar = google.calendar({ version: "v3", auth });

    console.log("📅 Calendar conectado");

} catch (e) {
    console.log("⚠️ Calendar no conectado");
}

// ================= VERIFY WEBHOOK =================
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY) {
        return res.status(200).send(challenge);
    }

    res.sendStatus(403);
});

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {

    res.sendStatus(200);

    const body = req.body;

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const text = message.text?.body?.toLowerCase().trim();
    const id = message.id;

    if (processed.has(id)) return;
    processed.add(id);

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
`🐾 La Granja PH

1️⃣ Agendar cita
2️⃣ Productos
3️⃣ Asesor
4️⃣ Consulta médica`;
    }

    // ================= START =================
    else if (text === "1" && users[from].step === "idle") {
        users[from].step = "name";
        reply = "👤 ¿Tu nombre?";
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

        reply =
`⏰ Horarios:
1️⃣ 9am
2️⃣ 11am
3️⃣ 2pm
4️⃣ 4pm`;
    }

    // ================= TIME =================
    else if (users[from].step === "time") {

        const slots = {
            "1": "09:00:00",
            "2": "11:00:00",
            "3": "14:00:00",
            "4": "16:00:00"
        };

        if (!slots[text]) {
            reply = "❌ Elige 1-4";
        } else {

            users[from].time = slots[text];

            const start = `${users[from].date}T${users[from].time} `;

            const end = `${users[from].date}T${users[from].time} `;

            // ================= SHEETS =================
            try {
                await axios.post(SHEET_URL, {
                    nombre: users[from].name,
                    mascota: users[from].pet,
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
                            summary: ` Cita - ${users[from].pet}`,
                            description: `Cliente: ${users[from].name} `,
                            start: {
                                dateTime: start,
                                timeZone: "America/Bogota"
                            },
                            end: {
                                dateTime: end,
                                timeZone: "America/Bogota"
                            }
                        }
                    });
                }
            } catch (e) {
                console.log("Calendar error");
            }

            reply = `✅ Cita confirmada para ${users[from].pet} `;

            users[from].step = "idle";
        }
    }

    // ================= OTRAS OPCIONES =================
    else if (text === "2") {
        reply = "🍖 Tenemos comida premium para perros y gatos";
    }

    else if (text === "3") {
        reply = "👩‍⚕️ Un asesor te contactará pronto";
    }

    else if (text === "4") {
        reply = "🩺 Escribe el problema de tu mascota";
    }

    // ================= IA =================
    else {
        reply = "🤖 Escribe 'menu' para ver opciones";
    }

    // ================= SEND WHATSAPP =================
    try {
        await axios.post(
            "https://graph.facebook.com/v22.0/1168848789639885/messages",
            {
                messaging_product: "whatsapp",
                to: from,
                text: { body: reply }
            },
            {
                headers: {
                    Authorization: `Bearer ${TOKEN} `
                }
            }
        );
    } catch (e) {
        console.log("WhatsApp error");
    }

});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Bot activo en puerto", PORT);
});
