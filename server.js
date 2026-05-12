require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// =========================
// VARIABLES DE ENTORNO
// =========================

const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
const SHEET_URL = process.env.SHEET_URL;

// =========================
// OPENROUTER (SEGURO)
// =========================

let client = null;

if (process.env.OPENROUTER_API_KEY) {
    client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
    });
}

// =========================
// USUARIOS EN MEMORIA
// =========================

const usuarios = {};

// =========================
// WEBHOOK VERIFY
// =========================

app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = req.query["hub.verify_token"];

    if (mode && verifyToken === verify_token) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// =========================
// RECIBIR MENSAJES
// =========================

app.post("/webhook", async (req, res) => {
    res.sendStatus(200);

    try {
        const message =
            req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (!message) return;

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

        // =========================
        // MENÚ
        // =========================

        if (text === "hola" || text === "menu") {
            usuarios[from].paso = "";
            respuesta = `🐾 Bienvenido a La Granja PH

1️⃣ Agendar baño
2️⃣ Productos
3️⃣ Asesor`;
        }

        // =========================
        // INICIO AGENDAMIENTO
        // =========================

        else if (text === "1" && usuarios[from].paso === "") {
            usuarios[from].paso = "nombre";
            respuesta = "📝 ¿Cuál es tu nombre?";
        }

        else if (usuarios[from].paso === "nombre") {
            usuarios[from].nombre = text;
            usuarios[from].paso = "mascota";
            respuesta = "🐶 ¿Nombre de tu mascota?";
        }

        else if (usuarios[from].paso === "mascota") {
            usuarios[from].mascota = text;
            usuarios[from].paso = "fecha";
            respuesta = "📅 Escribe la fecha (YYYY-MM-DD)";
        }

        else if (usuarios[from].paso === "fecha") {
            usuarios[from].fecha = text;
            usuarios[from].paso = "hora";

            respuesta = `⏰ Horarios:

1️⃣ 9:00 AM
2️⃣ 11:00 AM
3️⃣ 2:00 PM
4️⃣ 4:00 PM`;
        }

        else if (usuarios[from].paso === "hora") {
            const horarios = {
                "1": "9:00 AM",
                "2": "11:00 AM",
                "3": "2:00 PM",
                "4": "4:00 PM"
            };

            if (!horarios[text]) {
                respuesta = "❌ Opción inválida. Elige 1-4.";
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
                        respuesta = `✅ Cita agendada

👤 ${usuarios[from].nombre}
🐶 ${usuarios[from].mascota}
📅 ${usuarios[from].fecha}
⏰ ${usuarios[from].hora}`;

                        delete usuarios[from];
                    } else {
                        respuesta = "❌ Horario ocupado, intenta otro.";
                    }

                } catch (e) {
                    respuesta = "❌ Error con agenda, intenta más tarde.";
                }
            }
        }

        // =========================
        // PRODUCTOS
        // =========================

        else if (text === "2") {
            respuesta = "🍖 Tenemos comida premium para perros y gatos.";
        }

        // =========================
        // ASESOR
        // =========================

        else if (text === "3") {
            respuesta = "👩‍⚕️ Un asesor te responderá pronto.";
        }

        // =========================
        // IA (SEGURA)
        // =========================

        else {
            if (client) {
                const completion = await client.chat.completions.create({
                    model: "openai/gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content:
                                "Eres el asistente de una veterinaria. Responde corto y amable."
                        },
                        {
                            role: "user",
                            content: text
                        }
                    ]
                });

                respuesta = completion.choices[0].message.content;
            } else {
                respuesta = "🤖 IA no disponible en este momento.";
            }
        }

        // =========================
        // ENVIAR WHATSAPP
        // =========================

        await axios.post(
            "https://graph.facebook.com/v22.0/1168848789639885/messages",
            {
                messaging_product: "whatsapp",
                to: from,
                type: "text",
                text: { body: respuesta }
            },
            {
                headers: {
                    Authorization: `Bearer ${token} `,
                    "Content-Type": "application/json"
                }
            }
        );

    } catch (error) {
        console.log("ERROR:", error.response?.data || error.message);
    }
});

// =========================
// SERVER
// =========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor corriendo en puerto " + PORT);
});
