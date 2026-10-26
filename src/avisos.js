// Avisos a Alejandra por Telegram. Solo van servicio, día y hora (sin nombre ni celular) y la foto de referencia si hay.
// Si Telegram falla, la cita se guarda igual.

const reglas = require("./reglas");

const TIEMPO_MAXIMO_MS = 5000;
const TIEMPO_FOTO_MS = 20000; // subir una foto tarda más que un texto

function configurado() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function urlApi(metodo) {
  // TELEGRAM_API solo cambia en las pruebas
  const base = process.env.TELEGRAM_API || "https://api.telegram.org";
  return `${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`;
}

function textoNuevaCita({ servicio, alcance, inicio }) {
  const { fecha, minutos } = reglas.partesColombia(inicio);
  const [anio, mes, dia] = fecha.split("-").map(Number);

  const dialargo = new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString("es-CO", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
  });

  const zona = alcance === "manos" ? "solo manos" : "manos y pies";

  return (
    `Nueva solicitud de cita\n` +
    `${dialargo}, ${reglas.etiqueta(minutos)}\n` +
    `${servicio} (${zona})\n\n` +
    `Ábrela en el panel para confirmarla` +
    (process.env.PUBLIC_URL ? `:\n${process.env.PUBLIC_URL.replace(/\/$/, "")}/admin` : ".")
  );
}

async function enviar(texto) {
  const respuesta = await fetch(urlApi("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: texto,
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS)
  });

  if (!respuesta.ok) {
    throw new Error(`Telegram respondió ${respuesta.status}`);
  }

  return true;
}

async function enviarFoto(imagen, pie) {
  const formulario = new FormData();
  formulario.append("chat_id", process.env.TELEGRAM_CHAT_ID);
  formulario.append("caption", pie);
  formulario.append("photo", new Blob([imagen], { type: "image/jpeg" }), "referencia.jpg");

  const respuesta = await fetch(urlApi("sendPhoto"), {
    method: "POST",
    body: formulario,
    signal: AbortSignal.timeout(TIEMPO_FOTO_MS)
  });

  if (!respuesta.ok) {
    throw new Error(`Telegram respondió ${respuesta.status}`);
  }

  return true;
}

// no lanza errores: un aviso caído no debe impedir reservar
async function nuevaCita(cita) {
  if (!configurado()) return false;

  try {
    await enviar(textoNuevaCita(cita));

    for (const foto of cita.fotos || []) {
      await enviarFoto(foto.imagen, `Foto de referencia: ${foto.zona}`);
    }

    return true;
  } catch (err) {
    // nunca se registra la URL (lleva el token)
    console.error("No se pudo enviar el aviso por Telegram:", err.name === "TimeoutError" ? "tardó demasiado" : err.message);
    return false;
  }
}

module.exports = { configurado, urlApi, enviar, enviarFoto, textoNuevaCita, nuevaCita };
