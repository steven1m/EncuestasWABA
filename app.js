// Importar dependencias
const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

// Variables de entorno
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN || "MI_TOKEN_VERIFICACION";
const accessToken = process.env.ACCESS_TOKEN; // Token permanente de Meta
const phoneNumberId = process.env.PHONE_NUMBER_ID; // ID del número en WABA
const dbUrl = process.env.DATABASE_URL; // URL de Postgres en Render

// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false } // Render requiere SSL
});

// Definir las preguntas (solo desde la 2 porque la 1 va en plantilla)
const PREGUNTAS = {
  2: {
    texto: "¿Con qué frecuencia le gustaría recibir mensajes de nuestra empresa por WhatsApp?",
    opciones: [
      { id: "tiempo", title: "1 vez por semana" },
      { id: "producto", title: "2 vez por semana" },
      { id: "atencion", title: "Solo info importante" },
    ],
  },
  3: {
    texto: "¿Qué tipo de información le gustaría recibir a través de WhatsApp?",
    opciones: [
      { id: "promos", title: "Promociones y descuentos" },
      { id: "novedades", title: "Novedades de productos" },
      { id: "pqrs", title: "Soporte Pedidos/PQRS" },
    ],
  },
  4: {
    texto: "Satisfacción con el Vendedor Asignado: ¿Qué tan satisfecho está con la atención recibida por el vendedor asignado?",
    opciones: [
      { id: "Muysatisfecho", title: "Muy satisfecho" },
      { id: "Satisfecho", title: "Satisfecho" },
      { id: "Neutral", title: "Neutral" },
      { id: "Insatisfecho", title: "Insatisfecho" },
    ],
  },
  5: {
    texto: "¿Cómo calificaría la disponibilidad y tiempo de respuesta del vendedor asignado?",
    opciones: [
      { id: "Excelente", title: "Excelente" },
      { id: "Bueno", title: "Bueno" },
      { id: "Regular", title: "Regular" },
      { id: "Malo", title: "Malo" },
    ],
  },
  6: {
    texto: "¿Qué tan claro le ha resultado el vendedor al explicar los productos o servicios?",
    opciones: [
      { id: "Muyclaro", title: "Muy claro" },
      { id: "Claro", title: "Claro" },
      { id: "Pococlaro", title: "Poco claro" },
      { id: "Nadaclaro", title: "Nada claro" },
    ],
  },
  7: {
    texto: "¿Tiene algún comentario adicional sobre el uso de WhatsApp o la atención del vendedor asignado? (Respuesta abierta)",
    //opciones: [{ id: "fin", title: "Cerrar" }],
  },
};

// ========================
// FUNCIONES DE BASE DE DATOS
// ========================

// Crear cliente y encuesta si no existen
async function crearEncuesta(numero) {
  const cliente = await pool.query(
    "INSERT INTO clientes (telefono) VALUES ($1) ON CONFLICT (telefono) DO UPDATE SET telefono=EXCLUDED.telefono RETURNING id",
    [numero]
  );
  const clienteId = cliente.rows[0].id;

  const encuesta = await pool.query(
    "INSERT INTO encuestas (cliente_id) VALUES ($1) RETURNING id",
    [clienteId]
  );

  return encuesta.rows[0].id;
}

// Guardar respuesta en la DB
async function guardarRespuesta(encuestaId, preguntaNum, respuestaId, respuestaTexto) {
  await pool.query(
    "INSERT INTO respuestas (encuesta_id, pregunta_num, respuesta_id, respuesta_texto) VALUES ($1, $2, $3, $4)",
    [encuestaId, preguntaNum, respuestaId, respuestaTexto]
  );
}

// Obtener progreso actual de la encuesta
async function obtenerProgreso(numero) {
  const res = await pool.query(
    `SELECT e.id AS encuesta_id, COUNT(r.id) AS total
     FROM encuestas e
     JOIN clientes c ON e.cliente_id = c.id
     LEFT JOIN respuestas r ON e.id = r.encuesta_id
     WHERE c.telefono = $1 AND e.estado = 'en_progreso'
     GROUP BY e.id
     ORDER BY e.fecha_inicio DESC
     LIMIT 1`,
    [numero]
  );

  if (res.rows.length > 0) {
    return {
      encuestaId: res.rows[0].encuesta_id,
      totalRespuestas: parseInt(res.rows[0].total),
    };
  }

  return null;
}

// ========================
// FUNCIONES DE WHATSAPP API
// ========================

// Enviar la primera pregunta como plantilla
async function enviarPrimeraPregunta(numero) {
  const payload = {
    messaging_product: "whatsapp",
    to: numero,
    type: "template",
    template: {
      name: "feedback_survey2", // plantilla aprobada
      language: { code: "es_ES" }
    }
  };

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Primera pregunta enviada con plantilla a ${numero}`);
  } catch (err) {
    console.error("❌ Error enviando plantilla:", err.response?.data || err);
  }
}

// Enviar preguntas 2 a 7 como botones interactivos
async function enviarPregunta(numero, numPregunta) {
  const pregunta = PREGUNTAS[numPregunta];
  if (!pregunta) return;

  const buttons = pregunta.opciones.map((op) => ({
    type: "reply",
    reply: { id: op.id, title: op.title },
  }));

  const payload = {
    messaging_product: "whatsapp",
    to: numero,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: pregunta.texto },
      action: { buttons },
    },
  };

  if (numPregunta === 7) {
    // 📌 Última pregunta como texto libre
    const payload = {
      messaging_product: "whatsapp",
      to: numero,
      type: "text",
      text: { body: pregunta.texto }
    };
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Pregunta ${numPregunta} enviada a ${numero}`);
  } catch (err) {
    console.error("❌ Error enviando mensaje:", err.response?.data || err);
  }
}

// ========================
// RUTAS DEL WEBHOOK
// ========================

// Verificación del webhook (GET)
app.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    console.log("✅ WEBHOOK VERIFICADO");
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// Recepción de mensajes (POST)
app.post("/", async (req, res) => {
  const body = req.body;
  console.log("\n📩 Webhook recibido:\n", JSON.stringify(body, null, 2));

  try {
    const mensaje = body.entry[0].changes[0].value.messages[0];
    const numero = mensaje.from;

    console.log("🔎 Tipo de mensaje recibido:", mensaje.type, JSON.stringify(mensaje, null, 2));

    if (mensaje.type === "interactive") {
      const respuesta = mensaje.interactive.button_reply.id;
      const texto = mensaje.interactive.button_reply.title;
    }  else if (mensaje.type === "button") {
        respuesta = mensaje.button.payload;
        texto = mensaje.button.text;
    } else if (mensaje.type === "text") {
        respuesta = mensaje.text.body;
        texto = mensaje.text.body;
    }  

    if (respuesta) {
      console.log(`👉 Respuesta de ${numero}: ${respuesta}`);

      // Revisar si ya existe encuesta en curso
      let progreso = await obtenerProgreso(numero);

      let encuestaId, preguntaNum;
      if (!progreso) {
        // Crear encuesta nueva (se supone que ya mandaste plantilla)
        encuestaId = await crearEncuesta(numero);
        preguntaNum = 1;
      } else {
        encuestaId = progreso.encuestaId;
        preguntaNum = progreso.totalRespuestas + 1;
      }

      // Guardar respuesta en DB
      await guardarRespuesta(encuestaId, preguntaNum, respuesta, texto);
      console.log(`💾 Guardado: ${numero} → P${preguntaNum} → ${texto}`);

      // Enviar siguiente pregunta
      const siguiente = preguntaNum + 1;
      if (siguiente <= 7) {
        await enviarPregunta(numero, siguiente);
      } else {
        await pool.query(
          "UPDATE encuestas SET estado='finalizada', fecha_fin=NOW() WHERE id=$1",
          [encuestaId]
        );
        console.log(`✅ Encuesta finalizada para ${numero}`);
      }
    }
  } catch (err) {
    console.error("❌ Error procesando webhook:", err.message);
  }

  res.sendStatus(200);
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en puerto ${port}`);
});
