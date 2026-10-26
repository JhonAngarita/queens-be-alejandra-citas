// Pruebas del panel de Alejandra (login, permisos, confirmar y cancelar).

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();

const nombrePrueba = process.env.DB_NAME_TEST || "queens_be_alejandra_test";
assert.ok(nombrePrueba.endsWith("_test"), "DB_NAME_TEST debe terminar en _test");

process.env.DB_NAME = nombrePrueba;
delete process.env.DATABASE_URL;
process.env.LIMITE_SOLICITUDES = "1000";
process.env.LIMITE_LOGIN = "6";

const { preparar } = require("../db/preparar");
const pool = require("../src/db");
const app = require("../src/app");
const auth = require("../src/auth");
const reglas = require("../src/reglas");

const CLAVE = "clave-de-prueba-123";
let servidor;
let url;

function proximoLunes() {
  for (let i = 7; i < 14; i++) {
    const t = new Date(Date.now() - 5 * 3600e3 + i * 86400e3).toISOString().slice(0, 10);
    if (reglas.diaDeSemana(t) === 1) return t;
  }
}
const LUNES = proximoLunes();

async function pedir(ruta, { metodo = "GET", cuerpo, cookie, origen } = {}) {
  const cabeceras = { "Content-Type": "application/json" };
  if (cookie) cabeceras.Cookie = cookie;
  if (origen) cabeceras.Origin = origen;

  const respuesta = await fetch(`${url}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });

  return { estado: respuesta.status, cuerpo: await respuesta.json().catch(() => ({})), respuesta };
}

async function entrar() {
  const { respuesta } = await pedir("/api/admin/login", {
    metodo: "POST",
    cuerpo: { usuario: "alejandra", clave: CLAVE }
  });
  return respuesta.headers.get("set-cookie").split(";")[0];
}

const reservar = (extra = {}) =>
  pedir("/api/citas", {
    metodo: "POST",
    cuerpo: {
      servicio: "Polygel", alcance: "manos", fecha: LUNES, minutos: 13 * 60 + 30,
      nombre: "Maria Prueba", telefono: "3001234567", consentimiento: true, ...extra
    }
  });

before(async () => {
  await preparar(nombrePrueba);
  servidor = app.listen(0);
  url = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(async () => {
  await pool.query("TRUNCATE citas, bloqueos, sesiones, admins RESTART IDENTITY CASCADE");
  await auth.crearAdmin("Alejandra", CLAVE);
});

after(async () => {
  await new Promise((resolver) => servidor.close(resolver));
  await pool.end();
});

test("la clave se guarda como hash, no como texto", async () => {
  const { rows } = await pool.query("SELECT usuario, clave_hash FROM admins");
  assert.equal(rows[0].usuario, "alejandra");
  assert.ok(rows[0].clave_hash.startsWith("scrypt$"));
  assert.ok(!rows[0].clave_hash.includes(CLAVE));
  assert.equal(await auth.verificarClave(CLAVE, rows[0].clave_hash), true);
  assert.equal(await auth.verificarClave("otra-clave-distinta", rows[0].clave_hash), false);
});

test("crearAdmin rechaza claves cortas y usuarios raros", async () => {
  await assert.rejects(auth.crearAdmin("ale", "corta"));
  await assert.rejects(auth.crearAdmin("a b!", "clave-larga-suficiente"));
});

test("sin sesión no se puede ver ni cambiar nada (401)", async () => {
  assert.equal((await pedir("/api/admin/citas")).estado, 401);
  assert.equal((await pedir("/api/admin/yo")).estado, 401);
  assert.equal((await pedir("/api/admin/citas/1", { metodo: "PATCH", cuerpo: { estado: "cancelada" } })).estado, 401);
  assert.equal((await pedir("/api/admin/citas", { cookie: "sesion_admin=inventada" })).estado, 401);
});

test("login con clave o usuario incorrectos da el mismo 401", async () => {
  const mala = await pedir("/api/admin/login", { metodo: "POST", cuerpo: { usuario: "alejandra", clave: "incorrecta-123" } });
  const otra = await pedir("/api/admin/login", { metodo: "POST", cuerpo: { usuario: "nadie", clave: CLAVE } });
  assert.equal(mala.estado, 401);
  assert.equal(otra.estado, 401);
  assert.equal(mala.cuerpo.error, otra.cuerpo.error);
  assert.equal(mala.respuesta.headers.get("set-cookie"), null);
});

test("login correcto: cookie httpOnly + SameSite=Strict y la sesión funciona", async () => {
  const { estado, respuesta } = await pedir("/api/admin/login", {
    metodo: "POST", cuerpo: { usuario: "ALEJANDRA", clave: CLAVE }
  });
  assert.equal(estado, 200);

  const cookie = respuesta.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);

  const yo = await pedir("/api/admin/yo", { cookie: cookie.split(";")[0] });
  assert.equal(yo.estado, 200);
  assert.equal(yo.cuerpo.usuario, "alejandra");

  // En la base de datos NO está el código de la cookie, solo su huella.
  const token = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  const { rows } = await pool.query("SELECT token_hash FROM sesiones");
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
});

test("logout cierra la sesión de verdad", async () => {
  const cookie = await entrar();
  assert.equal((await pedir("/api/admin/logout", { metodo: "POST", cookie })).estado, 200);
  assert.equal((await pedir("/api/admin/yo", { cookie })).estado, 401);
});

test("una sesión vencida ya no sirve", async () => {
  const cookie = await entrar();
  await pool.query("UPDATE sesiones SET expira_en = now() - interval '1 minute'");
  assert.equal((await pedir("/api/admin/yo", { cookie })).estado, 401);
});

test("cambiar la clave cierra las sesiones anteriores", async () => {
  const cookie = await entrar();
  await auth.crearAdmin("alejandra", "otra-clave-nueva-456");
  assert.equal((await pedir("/api/admin/yo", { cookie })).estado, 401);
});

test("una solicitud desde otro sitio web se rechaza (403)", async () => {
  const cookie = await entrar();
  const r = await pedir("/api/admin/logout", { metodo: "POST", cookie, origen: "https://sitio-malo.example" });
  assert.equal(r.estado, 403);
});

test("lista, confirma y cancela citas; cancelar libera la hora", async () => {
  await reservar();
  const cookie = await entrar();

  const lista = await pedir("/api/admin/citas", { cookie });
  assert.equal(lista.cuerpo.citas.length, 1);
  const cita = lista.cuerpo.citas[0];
  assert.equal(cita.estado, "pendiente");
  assert.equal(cita.fecha, LUNES);
  assert.equal(cita.hora, "1:30 p. m.");
  assert.equal(cita.horaFin, "3:30 p. m.");
  assert.equal(cita.telefono, "3001234567");

  const confirmada = await pedir(`/api/admin/citas/${cita.id}`, { metodo: "PATCH", cookie, cuerpo: { estado: "confirmada" } });
  assert.equal(confirmada.estado, 200);
  assert.equal(confirmada.cuerpo.cita.estado, "confirmada");

  // Confirmada sigue bloqueando la hora
  assert.equal((await reservar({ nombre: "Otra" })).estado, 409);

  // Confirmar dos veces no se puede
  const repetida = await pedir(`/api/admin/citas/${cita.id}`, { metodo: "PATCH", cookie, cuerpo: { estado: "confirmada" } });
  assert.equal(repetida.estado, 409);

  const cancelada = await pedir(`/api/admin/citas/${cita.id}`, { metodo: "PATCH", cookie, cuerpo: { estado: "cancelada" } });
  assert.equal(cancelada.estado, 200);

  // Ya cancelada: no se puede reactivar ni cancelar otra vez
  assert.equal((await pedir(`/api/admin/citas/${cita.id}`, { metodo: "PATCH", cookie, cuerpo: { estado: "confirmada" } })).estado, 409);
  assert.equal((await pedir(`/api/admin/citas/${cita.id}`, { metodo: "PATCH", cookie, cuerpo: { estado: "cancelada" } })).estado, 409);

  // La hora quedó libre para otra clienta
  assert.equal((await reservar({ nombre: "Otra" })).estado, 201);
});

test("PATCH con datos inválidos o cita inexistente", async () => {
  const cookie = await entrar();
  const patch = (id, cuerpo) => pedir(`/api/admin/citas/${id}`, { metodo: "PATCH", cookie, cuerpo });

  assert.equal((await patch("abc", { estado: "cancelada" })).estado, 400);
  assert.equal((await patch("1", { estado: "pendiente" })).estado, 400);
  assert.equal((await patch("1", { estado: "__proto__" })).estado, 400);
  assert.equal((await patch("1", {})).estado, 400);
  assert.equal((await patch("999", { estado: "cancelada" })).estado, 404);
});

test("el panel no muestra citas de días anteriores", async () => {
  await pool.query(
    `INSERT INTO citas (servicio, alcance, cliente_nombre, cliente_telefono, inicio, fin)
     VALUES ('Polygel','manos','Vieja','3001234567', now() - interval '3 days', now() - interval '3 days' + interval '90 minutes')`
  );
  const cookie = await entrar();
  assert.equal((await pedir("/api/admin/citas", { cookie })).cuerpo.citas.length, 0);
});

test("partesColombia convierte bien a hora de Colombia", () => {
  const p = reglas.partesColombia(new Date("2030-01-07T18:30:00Z"));
  assert.deepEqual(p, { fecha: "2030-01-07", minutos: 13 * 60 + 30 });
  // 02:00 UTC del día siguiente sigue siendo el día anterior en Colombia
  assert.equal(reglas.partesColombia(new Date("2030-01-08T02:00:00Z")).fecha, "2030-01-07");
});

// Va al final: después de esto el limitador queda bloqueado para esta IP.
test("después de varios intentos fallidos el login se bloquea (429)", async () => {
  let ultimo;
  for (let i = 0; i < 8; i++) {
    ultimo = await pedir("/api/admin/login", { metodo: "POST", cuerpo: { usuario: "alejandra", clave: "mala-clave-xyz" } });
  }
  assert.equal(ultimo.estado, 429);
});
