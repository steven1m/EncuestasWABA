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

const clientes = [
  //dey
  { telefono: "573103620959", nombre: "JOSE GREGORIO LOPEZ" },
  { telefono: "573015888261", nombre: "OLGLASS INTERNACIONAL" },
  { telefono: "573173775085", nombre: "EL AMPARO" },
  { telefono: "573142798413", nombre: "ALUVITEMP" },
  { telefono: "573174422239", nombre: "ARQUIVIDRIOS" },
  { telefono: "573183852494", nombre: "GLASS METAL" },
  //galviz
  { telefono: "573185480082", nombre: "Jorge Andres Ortiz" },
  { telefono: "573006599558", nombre: "Alejandro Ortiz" },
  { telefono: "573168228567", nombre: "Carolina Mejia" },
  { telefono: "573155714858", nombre: "Mauricio Gomez" },
  { telefono: "573164776760", nombre: "Karen benavides" },
  { telefono: "573173559699", nombre: "Jaean Florez" },
  { telefono: "573206729910", nombre: "Jazmin Lucumi" },
  //
  { telefono: "573167700403", nombre: "ALUMINIOS OTTO" },
  { telefono: "573105712286", nombre: "BRUNO DUITAMA" },
  { telefono: "573112224644", nombre: "CLAUDIA FENASTRA" },
  { telefono: "573134165160", nombre: "DEIRY INTERNACIONAL ALUMINIOS" },
  { telefono: "573153831390", nombre: "DIEGO COALUM" },
  { telefono: "573106194065", nombre: "DIEGO FERNANDO CODELAMINA" },
  { telefono: "573112641898", nombre: "IVAN COLWINDOWS" },
  { telefono: "573123799054", nombre: "LEYDI IMPERIO DEL ALUMINIO" },
  { telefono: "573105698700", nombre: "MONICA BACATA" },
  { telefono: "573112029571", nombre: "PAOLA FERROALUMINIOS" },
  { telefono: "573108262005", nombre: "PAOLA FERROALUMINIOS" },
  { telefono: "573134691706", nombre: "PAOLA COMPRAS" },
  { telefono: "573118983184", nombre: "ROSA SANTOS ALUMINIOS ARQUITECTURA" },
  { telefono: "573136999005", nombre: "Steven Murillo" },
];

// Definir las preguntas (solo desde la 2 porque la 1 va en plantilla)
const PREGUNTAS = {
 2: {
   texto: "¿Con qué frecuencia le gustaría recibir mensajes?",
   opciones: [
     { id: "1_semana",     title: "1 vez/semana" },
     { id: "2_semana",     title: "2 veces/mes" },
     { id: "solo_necesario", title: "Solo necesario" },
   ],
 },
 3: {
   texto: "¿Qué tipo de información prefiere recibir?",
   opciones: [
     { id: "pedidos",   title: "Pedidos" },
     { id: "novedades", title: "Novedades" },
     { id: "promos",    title: "Promos" },
   ],
 },
 4: {
   texto: "Si implementamos WhatsApp como canal oficial, ¿lo usaría?",
   opciones: [
     { id: "si_siempre", title: "Sí, siempre" },
     { id: "a_veces",    title: "A veces" },
     { id: "no_usaria",  title: "No usaría" },
   ],
 },
 5: {
   texto: "¿Qué canal usa más hoy con proveedores?",
   opciones: [
     { id: "whatsapp", title: "WhatsApp" },
     { id: "correo",   title: "Correo" },
     { id: "telefono", title: "Teléfono" },
   ],
 },
 6: {
   texto: "¿Qué beneficio valora más al usar WhatsApp?",
   opciones: [
     { id: "rapidez",     title: "Rapidez" },
     { id: "comodidad",   title: "Comodidad" },
     { id: "seguimiento", title: "Seguimiento" },
   ],
 },
 7: {
   texto: "¿Tiene algún comentario o sugerencia? (respuesta abierta)",
   // sin opciones: campo de texto libre
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
      name: "feedback_survey_2", // plantilla aprobada
      language: { code: "es_CO" }
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

//Enviar Encuestas en Batch con delay (1 por segundo)
async function enviarEnBatch(clientes, delayMs = 1000) {
  for (const cliente of clientes) {
    await enviarPrimeraPregunta(cliente.telefono);
    await new Promise(resolve => setTimeout(resolve, delayMs)); // espera entre envíos
  }
}

//Envio de Encuentas
//enviarEnBatch(clientes, 1000);

// Enviar preguntas 2 a 7 como botones interactivos
async function enviarPregunta(numero, numPregunta) {
  const pregunta = PREGUNTAS[numPregunta];
  if (!pregunta) return;

  // Si la pregunta no tiene opciones → mandar texto normal
  if (!pregunta.opciones || pregunta.opciones.length === 0) {
    const payload = {
      messaging_product: "whatsapp",
      to: numero,
      type: "text",
      text: { body: pregunta.texto }
    };

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
    console.log(`✅ Pregunta ${numPregunta} (texto libre) enviada a ${numero}`);
    return;
  }

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

// Enviar mensaje de texto simple
async function enviarMensajeTexto(numero, texto) {
  const payload = {
    messaging_product: "whatsapp",
    to: numero,
    text: { body: texto },
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
    console.log(`✅ Mensaje de texto enviado a ${numero}`);
  } catch (err) {
    console.error("❌ Error enviando mensaje de texto:", err.response?.data || err);
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
    let respuesta = ""
    let texto = ""

    console.log("🔎 Tipo de mensaje recibido:", mensaje.type, JSON.stringify(mensaje, null, 2));

    if (mensaje.type === "interactive") {
      respuesta = mensaje.interactive.button_reply.id;
      texto = mensaje.interactive.button_reply.title;
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

        // 👉 Aquí enviamos el agradecimiento
        await enviarMensajeTexto(
          numero,
          "🎉 ¡Gracias por completar la encuesta! 🙏 Tus respuestas nos ayudan a mejorar nuestro servicio."
        );
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
