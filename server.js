
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const SHEET_URL = process.env.SHEET_URL;


const usuarios = {};

const app = express();

app.use(bodyParser.json());

// =====================================
// TOKEN WHATSAPP
// =====================================

const token = process.env.TOKEN_WHATSAPP;

// =====================================
// VERIFY TOKEN
// =====================================

const verify_token = process.env.VERIFY_TOKEN;


// =====================================
// OPENROUTER
// =====================================

const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    });

// =====================================
// VERIFICAR WEBHOOK
// =====================================

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

// =====================================
// RECIBIR MENSAJES
// =====================================

app.post("/webhook", async (req, res) => {

    res.sendStatus(200);

    try {

        const message =
        req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (!message) return;

        const from = message.from;

        if (!usuarios[from]) {

            usuarios[from] = {
                paso: "",
                nombre: "",
                mascota: "",
                servicio: "",
                fecha: "",
                hora: ""
            };

        }

        const text =
        message.text?.body?.toLowerCase().trim() || "";

        console.log("Mensaje recibido:", text);

        let respuesta = "";

        // =====================================
        // MENU
        // =====================================

        if (text === "hola" || text === "menu") {

            usuarios[from].paso = "";

            respuesta =
`🐾 Bienvenido a La Granja PH

1️⃣ Agendar baño
2️⃣ Productos
3️⃣ Asesor`;

        }

        // =====================================
        // INICIAR AGENDAMIENTO
        // =====================================

        else if (
            text === "1" &&
            usuarios[from].paso === ""
        ) {

            usuarios[from].paso = "nombre";

            respuesta =
"📝 ¿Cuál es tu nombre?";

        }

        // =====================================
        // NOMBRE
        // =====================================

        else if (
            usuarios[from].paso === "nombre"
        ) {

            usuarios[from].nombre = text;

            usuarios[from].paso = "mascota";

            respuesta =
"🐶 ¿Nombre de tu mascota?";

        }

        // =====================================
        // MASCOTA
        // =====================================

        else if (
            usuarios[from].paso === "mascota"
        ) {

            usuarios[from].mascota = text;

            usuarios[from].paso = "fecha";

            respuesta ="📅 Escribe la fecha así:\n2026-05-15";

        }

        // =====================================
        // FECHA
        // =====================================

        else if (
            usuarios[from].paso === "fecha"
        ) {

            usuarios[from].fecha = text;

            usuarios[from].paso = "hora";

            respuesta =
`⏰ Horarios disponibles:

1️⃣ 9:00 AM
2️⃣ 11:00 AM
3️⃣ 2:00 PM
4️⃣ 4:00 PM

Escribe el número del horario`;

        }

        // =====================================
        // HORA
        // =====================================

        else if (
            usuarios[from].paso === "hora"
        ) {

            const horarios = {
                "1": "9:00 AM",
                "2": "11:00 AM",
                "3": "2:00 PM",
                "4": "4:00 PM"
            };

            if (!horarios[text]) {

                respuesta =
`❌ Opción inválida.

1️⃣ 9:00 AM
2️⃣ 11:00 AM
3️⃣ 2:00 PM
4️⃣ 4:00 PM`;

            } else {

                usuarios[from].hora =
                horarios[text];

                const resultado =
                await axios.post(
                    SHEET_URL,
                    {
                        nombre:
                        usuarios[from].nombre,

                        mascota:
                        usuarios[from].mascota,

                        servicio:
                        "Baño y grooming",

                        fecha:
                        usuarios[from].fecha,

                        hora:
                        usuarios[from].hora
                    }
                );

                if (
                    resultado.data.disponible
                ) {

                    respuesta =
`✅ Cita agendada

👤 ${usuarios[from].nombre}
🐶 ${usuarios[from].mascota}
📅 ${usuarios[from].fecha}
⏰ ${usuarios[from].hora}`;

 delete usuarios[from];


    } else {

    respuesta =
`❌ Ese horario ya está ocupado.

⏰ Horarios disponibles:

1️⃣ 9:00 AM
2️⃣ 11:00 AM
3️⃣ 2:00 PM
4️⃣ 4:00 PM

Escribe otro número de horario`;

}

                           }

        }

        // =====================================
        // PRODUCTOS
        // =====================================

        else if (
            text === "2" &&
            usuarios[from].paso === ""
        ) {

            respuesta =
"🍖 Tenemos comida premium para perros y gatos.";

        }

        // =====================================
        // ASESOR
        // =====================================

        else if (
            text === "3" &&
            usuarios[from].paso === ""
        ) {

            respuesta =
"👩‍⚕️ Un asesor te responderá pronto.";

        }

        // =====================================
        // IA
        // =====================================

        else {

            const completion =
            await client.chat.completions.create({

                model: "openai/gpt-4o-mini",

                messages: [
                    {
                        role: "system",
                        content:
                        "Eres el asistente virtual de La Granja PH. Responde corto y amable. Vendes comida para perros y gatos, haces baños, grooming y domicilios."
                    },
                    {
                        role: "user",
                        content: text
                    }
                ]

            });

            respuesta =
            completion.choices[0].message.content;

        }

        // =====================================
        // ENVIAR WHATSAPP
        // =====================================

        await axios.post(

            "https://graph.facebook.com/v22.0/1168848789639885/messages",

            {
                messaging_product: "whatsapp",
                to: from,
                type: "text",
                text: {
                    body: respuesta
                }
            },

            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                timeout: 100000
            }

        );

        console.log("Respuesta enviada");

    }

    catch (error) {

        console.log(
            "ERROR:",
            error.response?.data || error.message
        );

    }

});

// =====================================
// SERVIDOR
// =====================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(
        "Servidor corriendo en puerto 3000"
    );

});