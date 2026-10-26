// Configuración de Telegram: chat (busca el chat id) y probar (mensaje de prueba)

require("dotenv").config();

const { urlApi, enviar } = require("../src/avisos");

async function buscarChat() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Falta TELEGRAM_BOT_TOKEN en tu archivo .env");
  }

  const respuesta = await fetch(urlApi("getUpdates"), { signal: AbortSignal.timeout(10000) });
  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok || !datos.ok) {
    throw new Error("Telegram rechazó el token. Revisa que TELEGRAM_BOT_TOKEN esté completo y sin espacios.");
  }

  // cada persona que escribió al bot
  const chats = new Map();

  for (const u of datos.result) {
    const chat = (u.message || u.edited_message || {}).chat;
    if (chat && chat.type === "private") chats.set(chat.id, chat);
  }

  if (chats.size === 0) {
    console.log("Todavía nadie le ha escrito al bot.");
    console.log("Pídele a Alejandra que abra el bot en Telegram, toque INICIAR (START) y escriba \"hola\". Luego vuelve a correr este comando.");
    return;
  }

  console.log("Personas que le han escrito al bot:\n");

  for (const chat of chats.values()) {
    const nombre = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
    console.log(`  Chat: ${chat.id}   Nombre: ${nombre}${chat.username ? "   Usuario: @" + chat.username : ""}`);
  }

  console.log("\nCopia el número del chat de Alejandra en tu .env así:  TELEGRAM_CHAT_ID=NUMERO");
}

async function probar() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    throw new Error("Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID en tu archivo .env");
  }

  await enviar("Prueba de aviso de Queens Be Alejandra: si lees esto, los avisos funcionan.");
  console.log("Mensaje enviado. Revisa el Telegram de Alejandra.");
}

const accion = process.argv[2];

(accion === "chat" ? buscarChat() : accion === "probar" ? probar() : Promise.reject(new Error("Usa: chat o probar")))
  .catch((err) => {
    console.error("No se pudo: " + (err.name === "TimeoutError" ? "Telegram tardó demasiado en responder." : err.message));
    process.exitCode = 1;
  });
