// Pruebas de la API con PostgreSQL real, en una base propia (_test) para no tocar las citas

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();

const nombrePrueba = process.env.DB_NAME_TEST || "queens_be_alejandra_test";
assert.ok(nombrePrueba.endsWith("_test"), "DB_NAME_TEST debe terminar en _test para no borrar datos reales");

process.env.DB_NAME = nombrePrueba;
delete process.env.DATABASE_URL; // nunca probar contra una base de datos publicada
process.env.LIMITE_SOLICITUDES = "1000"; // las pruebas hacen muchas solicitudes seguidas

const { preparar } = require("../db/preparar");
const pool = require("../src/db");
const app = require("../src/app");
const reglas = require("../src/reglas");

// Próximo día de la semana (0 = domingo ... 6 = sábado), al menos 7 días en el futuro.
function proximoDia(diaSemana) {
  for (let i = 7; i < 14; i++) {
    const ahoraColombia = Date.now() - 5 * 60 * 60 * 1000;
    const texto = new Date(ahoraColombia + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    if (reglas.diaDeSemana(texto) === diaSemana) return texto;
  }
}

const LUNES = proximoDia(1);
const DOMINGO = proximoDia(0);
const HORA_1_30 = 13 * 60 + 30;

let servidor;
let url;

const datos = (extra = {}) => ({
  servicio: "Uñas acrílicas",
  alcance: "manos",
  fecha: LUNES,
  minutos: HORA_1_30,
  nombre: "Maria Prueba",
  telefono: "3001234567",
  consentimiento: true,
  ...extra
});

async function reservar(cuerpo) {
  const respuesta = await fetch(`${url}/api/citas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo)
  });

  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function disponibilidad(fecha, alcance = "manos") {
  const respuesta = await fetch(`${url}/api/disponibilidad?fecha=${fecha}&alcance=${encodeURIComponent(alcance)}`);
  return respuesta.json();
}

before(async () => {
  await preparar(nombrePrueba);
  servidor = app.listen(0);
  url = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(async () => {
  await pool.query("TRUNCATE citas, bloqueos RESTART IDENTITY CASCADE");
});

after(async () => {
  await new Promise((resolver) => servidor.close(resolver));
  await pool.end();
});

test("una solicitud válida se guarda como pendiente", async () => {
  const { estado, cuerpo } = await reservar(datos());
  assert.equal(estado, 201);
  assert.equal(cuerpo.estado, "pendiente");

  const { rows } = await pool.query("SELECT estado, cliente_telefono FROM citas");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].estado, "pendiente");
  assert.equal(rows[0].cliente_telefono, "3001234567");
});

test("la hora tomada y las que se cruzan aparecen ocupadas; la siguiente queda libre", async () => {
  await reservar(datos()); // 1:30 p. m. a 3:30 p. m.

  const dia = await disponibilidad(LUNES);
  const libre = Object.fromEntries(dia.horas.map((h) => [h.minutos, h.disponible]));

  assert.equal(libre[13 * 60 + 30], false); // 1:30
  assert.equal(libre[14 * 60], false); // 2:00 (se cruza)
  assert.equal(libre[14 * 60 + 30], false); // 2:30 (se cruza)
  assert.equal(libre[15 * 60], false); // 3:00 (se cruza)
  assert.equal(libre[15 * 60 + 30], true); // 3:30: la otra cita ya terminó
});

test("no se puede reservar una hora ocupada ni una que se cruce", async () => {
  assert.equal((await reservar(datos())).estado, 201);

  const igual = await reservar(datos({ nombre: "Otra Clienta" }));
  assert.equal(igual.estado, 409);

  const cruzada = await reservar(datos({ minutos: 14 * 60 + 30 }));
  assert.equal(cruzada.estado, 409);

  const siguiente = await reservar(datos({ minutos: 15 * 60 + 30 }));
  assert.equal(siguiente.estado, 201);
});

test("manos y pies (4 h) bloquea toda la tarde", async () => {
  const pies = await reservar(datos({ alcance: "manos y pies" })); // 1:30 a 5:30
  assert.equal(pies.estado, 201);

  const dia = await disponibilidad(LUNES);
  const libres = dia.horas.filter((h) => h.disponible).map((h) => h.minutos);
  assert.deepEqual(libres, []); // 4:30 empezaría antes de que termine
});

test("una cita cancelada libera la hora", async () => {
  await reservar(datos());
  await pool.query("UPDATE citas SET estado = 'cancelada'");

  const otra = await reservar(datos({ nombre: "Otra Clienta" }));
  assert.equal(otra.estado, 201);
});

test("8 solicitudes al mismo tiempo por la misma hora: solo una gana", async () => {
  const resultados = await Promise.all(
    Array.from({ length: 8 }, (_, i) => reservar(datos({ nombre: `Clienta ${i + 1}` })))
  );

  const estados = resultados.map((r) => r.estado);
  assert.equal(estados.filter((e) => e === 201).length, 1);
  assert.equal(estados.filter((e) => e === 409).length, 7);

  const { rows } = await pool.query("SELECT count(*)::int AS total FROM citas");
  assert.equal(rows[0].total, 1);
});

test("datos inválidos se rechazan con 400", async () => {
  const casos = [
    { telefono: "2001234567" }, // no empieza por 3
    { telefono: "300123456" }, // 9 dígitos
    { telefono: "30012345678" }, // 11 dígitos
    { nombre: "A" },
    { servicio: "Pestañas" },
    { alcance: "__proto__" },
    { consentimiento: false },
    { fecha: "2030-02-31" },
    { fecha: DOMINGO }, // cerrado
    { minutos: 700 }, // 11:40 a. m., fuera del horario
    { minutos: "810" } // debe ser número
  ];

  for (const caso of casos) {
    const { estado } = await reservar(datos(caso));
    assert.equal(estado, 400, `debería rechazar ${JSON.stringify(caso)}`);
  }

  const { rows } = await pool.query("SELECT count(*)::int AS total FROM citas");
  assert.equal(rows[0].total, 0);
});

test("un JSON dañado devuelve 400 y no rompe el servidor", async () => {
  const respuesta = await fetch(`${url}/api/citas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{esto no es json"
  });
  assert.equal(respuesta.status, 400);

  const salud = await fetch(`${url}/api/salud`);
  assert.equal(salud.status, 200);
});

test("/api/vivo responde sin usar la base de datos", async () => {
  const respuesta = await fetch(`${url}/api/vivo`);
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { ok: true });
});

test("un nombre con código SQL se guarda como texto normal (consultas parametrizadas)", async () => {
  const nombre = "Robert'); DROP TABLE citas;--";
  const { estado } = await reservar(datos({ nombre }));
  assert.equal(estado, 201);

  const { rows } = await pool.query("SELECT cliente_nombre FROM citas");
  assert.equal(rows[0].cliente_nombre, nombre); // la tabla sigue existiendo
});

test("el domingo la disponibilidad dice que está cerrado", async () => {
  const dia = await disponibilidad(DOMINGO);
  assert.equal(dia.cerrado, true);
  assert.deepEqual(dia.horas, []);
});

test("la disponibilidad rechaza fechas y zonas inválidas", async () => {
  const mala = await fetch(`${url}/api/disponibilidad?fecha=hola&alcance=manos`);
  assert.equal(mala.status, 400);

  const zona = await fetch(`${url}/api/disponibilidad?fecha=${LUNES}&alcance=cejas`);
  assert.equal(zona.status, 400);
});
