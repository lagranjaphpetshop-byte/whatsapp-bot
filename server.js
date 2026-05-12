const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// =========================
// CONFIG
// =========================
console.log("🚀 BOT INICIANDO...");

const token = process.env.TOKEN_WHATSAPP;
const verify_token = process.env.VERIFY_TOKEN;
const SHEET_URL = process.env.SHEET_URL;

// OpenRouter
let client = null;
if (process.env.OPENROUTER_API_KEY) {
    client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
    });
}

// =========================
// MEMORIA
// =========================
const usuarios = {};
const processed = new Set();

// =========================
// VERIFY WEBHOOK
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

        console.log("📩:", text);

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

    respuesta =
`🐾 BienvenidoLa GranjaPH soy tu asesor virtualen que puedo ayudarte hoy

1️⃣ Agendar baño y grooming
2️⃣ Productos
3️⃣ Consulta médica
4️⃣ Asesor`;

}

// ================= FLUJO CONTROLADO POR PASO =================

// INICIAR SOLO SI ESTÁ EN MENÚ
else if (usuarios[from].paso === "" && text === "1") {

    usuarios[from].paso = "nombre";
    respuesta = "📝 ¿Cuál es tu nombre?";

}

// NOMBRE
else if (usuarios[from].paso === "nombre") {

    usuarios[from].nombre = text;
    usuarios[from].paso = "mascota";

    respuesta = "🐶 Nombre de tu mascota:";
}

// MASCOTA
else if (usuarios[from].paso === "mascota") {

    usuarios[from].mascota = text;
    usuarios[from].paso = "fecha";

    respuesta = "📅 Escribe la fecha asi (YYYY-MM-DD)";
}

// FECHA
else if (usuarios[from].paso === "fecha") {

    usuarios[from].fecha = text;
    usuarios[from].paso = "hora";

    respuesta =
`⏰ Horarios disponibles:
1️⃣ 9am
2️⃣ 11am
3️⃣ 2pm
4️⃣ 4pm`;
}
        else if (usuarios[from].paso === "hora") {

            const horarios = {
                "1": "9:00 AM",
                "2": "11:00 AM",
                "3": "2:00 PM",
                "4": "4:00 PM"
            };

            if (!horarios[text]) {
                respuesta = "❌ Elige 1-4";
            } else {

                usuarios[from].hora = horarios[text];

                try {

                    const result = await axios.post(SHEET_URL, {
                        nombre: usuarios[from].nombre,
                        mascota: usuarios[from].mascota,
                        servicio: "Baño y grooming",
                        fecha: usuarios[from].fecha,
                        hora: usuarios[from].hora
                    });

                    if (result.data?.disponible) {
                        respuesta = `✅ Cita confirmada para ${usuarios[from].mascota} `;
                        delete usuarios[from];
                    } else {
                        respuesta = "❌ Horario ocupado, elige otro";
                    }

                } catch {
                    respuesta = "⚠️ Error en sistema de citas";
                }
            }
        }

        // ================= PRODUCTOS =================
        else if (text === "2") {
            respuesta =
`🍖 Productos disponibles
- Alimento premium
- Snacks naturales
- Shampoo veterinario

Escribe "menu" para volver`;
        }

        // ================= CONSULTA MÉDICA (NUEVO) =================
        else if (text === "3") {

            respuesta =
`🩺 Consulta médica veterinaria

Describe el síntoma de tu mascota y un veterinario te responderá.

Ejemplo:
"mi perro no quiere comer"`;

        }

        // ================= ASESOR =================
        else if (text === "4") {
            respuesta = "👩‍⚕️ Un asesor te contactará pronto.";
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
                                content:
`Eres un veterinario virtual de una petshop.
Responde corto, claro y profesional.
Si es un síntoma grave, recomienda ir a consulta.`
                            },
                            { role: "user", content: text }
                        ]
                    });

                    respuesta = completion.choices[0].message.content;

                } else {
                    respuesta = "🤖 Servicio no disponible";
                }

            } catch (e) {
                console.log("IA error:", e.message);
                respuesta = "⚠️ Intenta de nuevo";
            }
        }

        // ================= ENVIAR =================
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
        console.log("ERROR:", error.message);
    }
});

// =========================
// SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor corriendo en puerto " + PORT);
});
