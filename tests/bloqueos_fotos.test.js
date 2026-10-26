// Pruebas de: bloqueos de días/horas, historial y galería de fotos.

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();

const nombrePrueba = process.env.DB_NAME_TEST || "queens_be_alejandra_test";
assert.ok(nombrePrueba.endsWith("_test"), "DB_NAME_TEST debe terminar en _test");

process.env.DB_NAME = nombrePrueba;
delete process.env.DATABASE_URL;
process.env.LIMITE_SOLICITUDES = "1000";

const sharp = require("sharp");
const { preparar } = require("../db/preparar");
const pool = require("../src/db");
const app = require("../src/app");
const auth = require("../src/auth");
const reglas = require("../src/reglas");

const CLAVE = "clave-de-prueba-123";
let servidor;
let url;
let cookie;

function proximoDia(diaSemana, desde = 7) {
  for (let i = desde; i < desde + 7; i++) {
    const t = new Date(Date.now() - 5 * 3600e3 + i * 86400e3).toISOString().slice(0, 10);
    if (reglas.diaDeSemana(t) === diaSemana) return t;
  }
}
const LUNES = proximoDia(1);
const MARTES = proximoDia(2);

async function pedir(ruta, { metodo = "GET", cuerpo, conCookie = true, tipo = "application/json", crudo } = {}) {
  const cabeceras = {};
  if (tipo) cabeceras["Content-Type"] = tipo;
  if (conCookie && cookie) cabeceras.Cookie = cookie;

  const respuesta = await fetch(`${url}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: crudo ?? (cuerpo ? JSON.stringify(cuerpo) : undefined)
  });

  const texto = await respuesta.arrayBuffer();
  let json = {};
  try { json = JSON.parse(Buffer.from(texto).toString()); } catch {}
  return { estado: respuesta.status, cuerpo: json, bytes: Buffer.from(texto), respuesta };
}

const reservar = (extra = {}) =>
  pedir("/api/citas", {
    metodo: "POST", conCookie: false,
    cuerpo: {
      servicio: "Polygel", alcance: "manos", fecha: LUNES, minutos: 13 * 60 + 30,
      nombre: "Maria Prueba", telefono: "3001234567", consentimiento: true, ...extra
    }
  });

const bloquear = (cuerpo) => pedir("/api/admin/bloqueos", { metodo: "POST", cuerpo });

const imagen = (formato = "jpeg", ancho = 300, alto = 200, extra) =>
  sharp({ create: { width: ancho, height: alto, channels: 3, background: "#d85b91" } })[formato]();

before(async () => {
  await preparar(nombrePrueba);
  servidor = app.listen(0);
  url = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(async () => {
  await pool.query("TRUNCATE citas, bloqueos, fotos, sesiones, admins RESTART IDENTITY CASCADE");
  await auth.crearAdmin("alejandra", CLAVE);

  const r = await fetch(`${url}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "alejandra", clave: CLAVE })
  });
  cookie = r.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  await new Promise((resolver) => servidor.close(resolver));
  await pool.end();
});

test("bloquear un día completo: ninguna hora queda libre y no se puede reservar", async () => {
  const r = await bloquear({ fecha: LUNES, tipo: "dia", motivo: "Cita médica" });
  assert.equal(r.estado, 201);
  assert.equal(r.cuerpo.bloqueo.todoElDia, true);
  assert.equal(r.cuerpo.bloqueo.fecha, LUNES);
  assert.equal(r.cuerpo.bloqueo.motivo, "Cita médica");
  assert.deepEqual(r.cuerpo.conflictos, []);

  const dia = await (await fetch(`${url}/api/disponibilidad?fecha=${LUNES}&alcance=manos`)).json();
  assert.ok(dia.horas.length > 0);
  assert.equal(dia.horas.some((h) => h.disponible), false);

  assert.equal((await reservar()).estado, 409);

  // El día siguiente sigue libre
  const otro = await (await fetch(`${url}/api/disponibilidad?fecha=${MARTES}&alcance=manos`)).json();
  assert.ok(otro.horas.some((h) => h.disponible));
});

test("bloquear solo unas horas (almuerzo): bloquea esas y las que se cruzan, no el resto", async () => {
  // 2:00 p. m. a 3:00 p. m.
  const r = await bloquear({ fecha: LUNES, tipo: "horas", desde: 14 * 60, hasta: 15 * 60 });
  assert.equal(r.estado, 201);
  assert.equal(r.cuerpo.bloqueo.todoElDia, false);
  assert.equal(r.cuerpo.bloqueo.desde, "2:00 p. m.");
  assert.equal(r.cuerpo.bloqueo.hasta, "3:00 p. m.");

  const dia = await (await fetch(`${url}/api/disponibilidad?fecha=${LUNES}&alcance=manos`)).json();
  const libre = Object.fromEntries(dia.horas.map((h) => [h.minutos, h.disponible]));
  assert.equal(libre[13 * 60 + 30], false); // 1:30 + 2 h se cruza con el bloqueo
  assert.equal(libre[14 * 60], false);
  assert.equal(libre[14 * 60 + 30], false);
  assert.equal(libre[15 * 60], true); // empieza justo cuando termina el bloqueo

  assert.equal((await reservar({ minutos: 15 * 60 })).estado, 201);
});

test("vacaciones: varios días seguidos en un solo bloqueo", async () => {
  const r = await bloquear({ fecha: LUNES, tipo: "dia", hastaFecha: MARTES });
  assert.equal(r.estado, 201);
  assert.equal(r.cuerpo.bloqueo.fecha, LUNES);
  assert.equal(r.cuerpo.bloqueo.fechaFin, MARTES);

  for (const f of [LUNES, MARTES]) {
    const dia = await (await fetch(`${url}/api/disponibilidad?fecha=${f}&alcance=manos`)).json();
    assert.equal(dia.horas.some((h) => h.disponible), false);
  }
});

test("la base de datos misma rechaza una cita dentro de un bloqueo (aunque se salten la API)", async () => {
  await bloquear({ fecha: LUNES, tipo: "dia" });
  const inicio = reglas.inicioDe(LUNES, 13 * 60 + 30);

  await assert.rejects(
    pool.query(
      `INSERT INTO citas (servicio, alcance, cliente_nombre, cliente_telefono, inicio, fin)
       VALUES ('Polygel', 'manos', 'Directa', '3001234567', $1, $2)`,
      [inicio, new Date(inicio.getTime() + 90 * 60000)]
    ),
    (err) => err.code === "23P01"
  );
});

test("bloquear un horario con citas ya hechas las avisa pero NO las cancela", async () => {
  await reservar();
  const r = await bloquear({ fecha: LUNES, tipo: "dia" });

  assert.equal(r.estado, 201);
  assert.equal(r.cuerpo.conflictos.length, 1);
  assert.equal(r.cuerpo.conflictos[0].nombre, "Maria Prueba");

  const { rows } = await pool.query("SELECT estado FROM citas");
  assert.equal(rows[0].estado, "pendiente");
});

test("quitar un bloqueo libera el horario", async () => {
  const id = (await bloquear({ fecha: LUNES, tipo: "dia" })).cuerpo.bloqueo.id;
  assert.equal((await reservar()).estado, 409);

  assert.equal((await pedir(`/api/admin/bloqueos/${id}`, { metodo: "DELETE" })).estado, 200);
  assert.equal((await pedir(`/api/admin/bloqueos/${id}`, { metodo: "DELETE" })).estado, 404);
  assert.equal((await reservar()).estado, 201);
});

test("la lista de bloqueos muestra los vigentes y no los pasados", async () => {
  await bloquear({ fecha: LUNES, tipo: "dia" });
  await pool.query(
    "INSERT INTO bloqueos (inicio, fin) VALUES (now() - interval '5 days', now() - interval '4 days')"
  );

  const lista = await pedir("/api/admin/bloqueos");
  assert.equal(lista.cuerpo.bloqueos.length, 1);
  assert.equal(lista.cuerpo.bloqueos[0].fecha, LUNES);
});

test("bloqueos: datos inválidos se rechazan", async () => {
  const casos = [
    { fecha: "2030-02-31", tipo: "dia" },
    { fecha: "2020-01-01", tipo: "dia" }, // ya pasó
    { fecha: LUNES, tipo: "semana" },
    { fecha: LUNES, tipo: "dia", hastaFecha: "2020-01-01" }, // termina antes de empezar
    { fecha: LUNES, tipo: "dia", hastaFecha: "2099-01-01" }, // más de 60 días
    { fecha: LUNES, tipo: "dia", motivo: "x".repeat(81) },
    { fecha: LUNES, tipo: "dia", motivo: 5 },
    { fecha: LUNES, tipo: "horas", desde: 900, hasta: 840 }, // al revés
    { fecha: LUNES, tipo: "horas", desde: 845, hasta: 900 }, // no es múltiplo de 30
    { fecha: LUNES, tipo: "horas", desde: "840", hasta: 900 }, // texto, no número
    { fecha: LUNES, tipo: "horas", desde: 0, hasta: 1500 }
  ];

  for (const caso of casos) {
    assert.equal((await bloquear(caso)).estado, 400, `debería rechazar ${JSON.stringify(caso)}`);
  }

  const { rows } = await pool.query("SELECT count(*)::int AS total FROM bloqueos");
  assert.equal(rows[0].total, 0);
});

test("bloqueos: sin sesión no se puede ver, crear ni borrar (401)", async () => {
  assert.equal((await pedir("/api/admin/bloqueos", { conCookie: false })).estado, 401);
  assert.equal((await pedir("/api/admin/bloqueos", { metodo: "POST", conCookie: false, cuerpo: { fecha: LUNES, tipo: "dia" } })).estado, 401);
  assert.equal((await pedir("/api/admin/bloqueos/1", { metodo: "DELETE", conCookie: false })).estado, 401);
});

test("el historial trae solo citas de días anteriores, la más reciente primero", async () => {
  const insertar = (nombre, dias) =>
    pool.query(
      `INSERT INTO citas (servicio, alcance, cliente_nombre, cliente_telefono, inicio, fin)
       VALUES ('Polygel','manos',$1,'3001234567', now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval + interval '90 minutes')`,
      [nombre, String(dias)]
    );

  await insertar("Hace diez", 10);
  await insertar("Hace tres", 3);
  await reservar(); // una futura

  const h = await pedir("/api/admin/citas?vista=historial");
  assert.deepEqual(h.cuerpo.citas.map((c) => c.nombre), ["Hace tres", "Hace diez"]);

  const proximas = await pedir("/api/admin/citas");
  assert.deepEqual(proximas.cuerpo.citas.map((c) => c.nombre), ["Maria Prueba"]);

  assert.equal((await pedir("/api/admin/citas?vista=historial", { conCookie: false })).estado, 401);
});

const subir = (buffer, tipo = "image/jpeg", descripcion = "Uñas rosadas", extra = {}) =>
  pedir(`/api/admin/fotos?descripcion=${encodeURIComponent(descripcion)}`, { metodo: "POST", tipo, crudo: buffer, ...extra });

test("subir una foto: queda en la galería pública, reducida y con miniatura", async () => {
  const original = await imagen("jpeg", 3000, 2000).toBuffer();
  const r = await subir(original);
  assert.equal(r.estado, 201);

  // Cualquiera (sin sesión) puede ver la lista y las imágenes
  const lista = await (await fetch(`${url}/api/fotos`)).json();
  assert.equal(lista.fotos.length, 1);
  assert.equal(lista.fotos[0].descripcion, "Uñas rosadas");
  assert.equal(lista.fotos[0].ancho, 1600); // se redujo de 3000 a 1600
  assert.equal(lista.fotos[0].alto, 1067);

  const grande = await fetch(`${url}/media/fotos/${lista.fotos[0].id}/grande`);
  assert.equal(grande.status, 200);
  assert.equal(grande.headers.get("content-type"), "image/jpeg");
  assert.match(grande.headers.get("cache-control"), /max-age/);
  assert.equal((await sharp(Buffer.from(await grande.arrayBuffer())).metadata()).width, 1600);

  const mini = await fetch(`${url}/media/fotos/${lista.fotos[0].id}/mini`);
  assert.equal((await sharp(Buffer.from(await mini.arrayBuffer())).metadata()).width, 800);
});

test("la foto se endereza y se le quitan los datos ocultos (ubicación, autor...)", async () => {
  // Foto "acostada" (orientación 6) con un dato oculto de autor
  const original = await imagen("jpeg", 300, 200)
    .withExif({ IFD0: { Copyright: "DATO-SECRETO-123" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  assert.ok(original.includes(Buffer.from("DATO-SECRETO-123")), "la foto de prueba debe traer el dato oculto");

  assert.equal((await subir(original)).estado, 201);

  const { rows } = await pool.query("SELECT grande, mini, ancho, alto FROM fotos");
  assert.equal(rows[0].grande.includes(Buffer.from("DATO-SECRETO-123")), false);
  assert.equal(rows[0].mini.includes(Buffer.from("DATO-SECRETO-123")), false);
  assert.equal((await sharp(rows[0].grande).metadata()).exif, undefined);

  // Orientación aplicada: 300x200 acostada pasa a 200x300 de pie
  assert.equal(rows[0].ancho, 200);
  assert.equal(rows[0].alto, 300);
});

test("PNG y WebP se aceptan y se guardan como JPEG", async () => {
  assert.equal((await subir(await imagen("png").toBuffer(), "image/png")).estado, 201);
  assert.equal((await subir(await imagen("webp").toBuffer(), "image/webp")).estado, 201);
  assert.equal((await (await fetch(`${url}/api/fotos`)).json()).fotos.length, 2);
});

test("fotos: archivos que no son imagen se rechazan", async () => {
  // Texto disfrazado de JPEG
  assert.equal((await subir(Buffer.from("esto no es una foto"))).estado, 400);
  // Formatos no permitidos aunque sean imágenes reales (GIF dicho como PNG)
  const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
  assert.equal((await subir(gif, "image/png")).estado, 400);
  // Tipos no permitidos
  assert.equal((await subir(Buffer.from("<svg/>"), "image/svg+xml")).estado, 415);
  assert.equal((await subir(Buffer.from("MZ"), "application/octet-stream")).estado, 415);
  // Vacío
  assert.equal((await subir(Buffer.alloc(0))).estado, 415);

  assert.equal((await pool.query("SELECT count(*)::int AS n FROM fotos")).rows[0].n, 0);
});

test("fotos: más de 15 MB se rechaza (413)", async () => {
  const r = await subir(Buffer.alloc(16 * 1024 * 1024, 1));
  assert.equal(r.estado, 413);
});

test("fotos: máximo 40 en la galería", async () => {
  await pool.query(
    `INSERT INTO fotos (grande, mini, ancho, alto, descripcion)
     SELECT 'x'::bytea, 'x'::bytea, 1, 1, 'relleno' FROM generate_series(1, 40)`
  );
  assert.equal((await subir(await imagen().toBuffer())).estado, 409);
});

test("fotos: sin sesión no se puede subir ni quitar (401)", async () => {
  const buf = await imagen().toBuffer();
  assert.equal((await subir(buf, "image/jpeg", "x", { conCookie: false })).estado, 401);
  assert.equal((await pedir("/api/admin/fotos/1", { metodo: "DELETE", conCookie: false })).estado, 401);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM fotos")).rows[0].n, 0);
});

test("quitar una foto la saca de la galería", async () => {
  await subir(await imagen().toBuffer());
  const id = (await (await fetch(`${url}/api/fotos`)).json()).fotos[0].id;

  assert.equal((await pedir(`/api/admin/fotos/${id}`, { metodo: "DELETE" })).estado, 200);
  assert.equal((await (await fetch(`${url}/api/fotos`)).json()).fotos.length, 0);
  assert.equal((await fetch(`${url}/media/fotos/${id}/grande`)).status, 404);
  assert.equal((await pedir(`/api/admin/fotos/${id}`, { metodo: "DELETE" })).estado, 404);
  assert.equal((await pedir("/api/admin/fotos/abc", { metodo: "DELETE" })).estado, 400);
});

test("las fotos nuevas salen primero y las rutas de imagen validan sus datos", async () => {
  await subir(await imagen().toBuffer(), "image/jpeg", "primera");
  await subir(await imagen().toBuffer(), "image/jpeg", "segunda");
  const lista = await (await fetch(`${url}/api/fotos`)).json();
  assert.deepEqual(lista.fotos.map((f) => f.descripcion), ["segunda", "primera"]);

  assert.equal((await fetch(`${url}/media/fotos/1/original`)).status, 404);
  assert.equal((await fetch(`${url}/media/fotos/1;drop/mini`)).status, 404);
  assert.equal((await fetch(`${url}/media/fotos/999/mini`)).status, 404);
});
