require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
const SHEET_URL = process.env.SHEET_URL;

let client = null;

if (process.env.OPENROUTER_API_KEY) {
    client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
    });
}

const usuarios = {};
const processedMessages = new Set();

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
// WEBHOOK POST
// =========================

app.post("/webhook", async (req, res) => {
    res.sendStatus(200);

    try {
        const message =
            req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (!message) return;

        const msgId = message.id;
        if (processedMessages.has(msgId)) return;
        processedMessages.add(msgId);

        const from = message.from;
        const text = message.text?.body?.toLowerCase().trim() || "";

        if (!usuarios[from]) {
            usuarios[from] = {
                paso: "",
                nombre: "",
                mascota: "",
                fecha: "",
                hora: ""
            };
        }

        let respuesta = "";

        // ================= MENU =================
        if (text === "hola" || text === "menu") {
            usuarios[from].paso = "";
            respuesta = "🐾 Bienvenido a La Granja PH\n\n1️⃣ Agendar baño\n2️⃣ Productos\n3️⃣ Asesor";
        }

        // ================= FLUJO =================
        else if (text === "1" && usuarios[from].paso === "") {
            usuarios[from].paso = "nombre";
            respuesta = "📝 ¿Cuál es tu nombre?";
        }

        else if (usuarios[from].paso === "nombre") {
            usuarios[from].nombre = text;
            usuarios[from].paso = "mascota";
            respuesta = "🐶 Nombre de tu mascota?";
        }

        else if (usuarios[from].paso === "mascota") {
            usuarios[from].mascota = text;
            usuarios[from].paso = "fecha";
            respuesta = "📅 Fecha (YYYY-MM-DD)";
        }

        else if (usuarios[from].paso === "fecha") {
            usuarios[from].fecha = text;
            usuarios[from].paso = "hora";

            respuesta = "⏰ 1️⃣9am 2️⃣11am 3️⃣2pm 4️⃣4pm";
        }

        else if (usuarios[from].paso === "hora") {
            const horarios = {
                "1": "9:00 AM",
                "2": "11:00 AM",
                "3": "2:00 PM",
                "4": "4:00 PM"
            };

            if (!horarios[text]) {
                respuesta = "❌ Opción inválida (1-4)";
            } else {
                usuarios[from].hora = horarios[text];

                try {
                    const resultado = await axios.post(SHEET_URL, {
                        nombre: usuarios[from].nombre,
                        mascota: usuarios[from].mascota,
                        servicio: "Baño y grooming",
                        fecha: usuarios[from].fecha,
                        hora: usuarios[from].hora
                    });

                    if (resultado.data?.disponible) {
                        respuesta = `✅ Cita confirmada `;
                        delete usuarios[from];
                    } else {
                        respuesta = "❌ Horario ocupado";
                    }

                } catch (e) {
                    respuesta = "⚠️ Error guardando cita";
                }
            }
        }

        else if (text === "2") {
            respuesta = "🍖 Comida premium disponible";
        }

        else if (text === "3") {
            respuesta = "👩‍⚕️ Asesor te contactará pronto";
        }

        // ================= IA =================
        else {
            try {
                if (client) {
                    const completion = await client.chat.completions.create({
                        model: "openai/gpt-4o-mini",
                        messages: [
                            {
                                role: "system",
                                content: "Eres asistente de veterinaria. Respuestas cortas."
                            },
                            {
                                role: "user",
                                content: text
                            }
                        ]
                    });

                    respuesta = completion.choices[0].message.content;
                } else {
                    respuesta = "🤖 IA no disponible";
                }
            } catch (e) {
                respuesta = "⚠️ Error en IA, intenta otra vez";
            }
        }

        await axios.post(
            "https://graph.facebook.com/v22.0/1168848789639885/messages",
            {
                messaging_product: "whatsapp",
                to: from,
                text: { body: respuesta }
            },
            {
                headers: {
                    Authorization: `Bearer ${token} `
                }
            }
        );

    } catch (error) {
        console.log("ERROR:", error.message);
    }
});

// =========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor corriendo en puerto " + PORT);
});
