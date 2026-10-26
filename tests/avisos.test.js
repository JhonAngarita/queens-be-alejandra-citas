// Pruebas de los avisos por Telegram, con un Telegram falso

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

require("dotenv").config();

const nombrePrueba = process.env.DB_NAME_TEST || "queens_be_alejandra_test";
assert.ok(nombrePrueba.endsWith("_test"), "DB_NAME_TEST debe terminar en _test");

process.env.DB_NAME = nombrePrueba;
delete process.env.DATABASE_URL;
process.env.LIMITE_SOLICITUDES = "1000";

const { preparar } = require("../db/preparar");
const pool = require("../src/db");
const app = require("../src/app");
const reglas = require("../src/reglas");

const TOKEN = "123456:TOKEN-SECRETO-DE-PRUEBA";
let servidor;
let url;
let telegram;
let recibidos;
let respuestaTelegram;

function proximoLunes() {
  for (let i = 7; i < 14; i++) {
    const t = new Date(Date.now() - 5 * 3600e3 + i * 86400e3).toISOString().slice(0, 10);
    if (reglas.diaDeSemana(t) === 1) return t;
  }
}
const LUNES = proximoLunes();

const reservar = async (extra = {}) => {
  const r = await fetch(`${url}/api/citas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      servicio: "Semipermanente", alcance: "manos", fecha: LUNES, minutos: 14 * 60,
      nombre: "Maria Secreta Lopez", telefono: "3009998877", consentimiento: true, ...extra
    })
  });
  return r.status;
};

// espera a que llegue el aviso (se envía sin hacer esperar a la clienta)
async function esperarAvisos(cantidad) {
  for (let i = 0; i < 40 && recibidos.length < cantidad; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  // Telegram falso
  telegram = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      recibidos.push({ ruta: req.url, cuerpo: JSON.parse(cuerpo || "{}") });
      res.writeHead(respuestaTelegram, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: respuestaTelegram === 200 }));
    });
  });
  await new Promise((r) => telegram.listen(0, "127.0.0.1", r));

  await preparar(nombrePrueba);
  servidor = app.listen(0);
  url = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(async () => {
  await pool.query("TRUNCATE citas, bloqueos RESTART IDENTITY CASCADE");
  recibidos = [];
  respuestaTelegram = 200;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_CHAT_ID = "555";
  process.env.TELEGRAM_API = `http://127.0.0.1:${telegram.address().port}`;
  delete process.env.PUBLIC_URL;
});

after(async () => {
  await new Promise((r) => servidor.close(r));
  await new Promise((r) => telegram.close(r));
  await pool.end();
});

test("una solicitud nueva avisa a Alejandra, sin nombre ni celular de la clienta", async () => {
  assert.equal(await reservar(), 201);
  await esperarAvisos(1);

  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0].ruta, `/bot${TOKEN}/sendMessage`);
  assert.equal(recibidos[0].cuerpo.chat_id, "555");

  const texto = recibidos[0].cuerpo.text;
  assert.match(texto, /Nueva solicitud de cita/);
  assert.match(texto, /2:00 p\. m\./);
  assert.match(texto, /Semipermanente \(solo manos\)/);
  assert.doesNotMatch(texto, /Secreta|Lopez|3009998877/);
});

test("el aviso lleva el enlace al panel cuando hay PUBLIC_URL", async () => {
  process.env.PUBLIC_URL = "https://queens.example/";
  await reservar();
  await esperarAvisos(1);
  assert.match(recibidos[0].cuerpo.text, /https:\/\/queens\.example\/admin/);
});

test("sin configurar Telegram no se envía nada y la cita se guarda", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.equal(await reservar(), 201);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(recibidos.length, 0);
});

test("si Telegram responde con error, la cita se guarda igual", async () => {
  respuestaTelegram = 500;
  assert.equal(await reservar(), 201);
  await esperarAvisos(1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM citas")).rows[0].n, 1);
});

test("si Telegram no está disponible (sin internet), la cita se guarda igual", async () => {
  process.env.TELEGRAM_API = "http://127.0.0.1:1"; // nadie escucha ahí
  assert.equal(await reservar(), 201);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM citas")).rows[0].n, 1);
});

test("una solicitud rechazada (hora ocupada o datos malos) no genera aviso", async () => {
  assert.equal(await reservar(), 201);
  await esperarAvisos(1);
  recibidos = [];

  assert.equal(await reservar({ nombre: "Otra Clienta" }), 409); // misma hora
  assert.equal(await reservar({ telefono: "123" }), 400); // celular malo
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(recibidos.length, 0);
});

test("el token del bot nunca sale en los mensajes de error del servidor", async () => {
  const antes = console.error;
  const mensajes = [];
  console.error = (...a) => mensajes.push(a.join(" "));

  try {
    respuestaTelegram = 500;
    await reservar();
    await esperarAvisos(1);
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    console.error = antes;
  }

  assert.ok(mensajes.length > 0, "debe registrar el fallo");
  assert.ok(mensajes.every((m) => !m.includes("TOKEN-SECRETO")));
});
