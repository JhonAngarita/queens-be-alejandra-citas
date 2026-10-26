// Pruebas de la foto de referencia que la clienta adjunta al pedir su cita.

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const sharp = require("sharp");

require("dotenv").config();

const nombrePrueba = process.env.DB_NAME_TEST || "queens_be_alejandra_test";
assert.ok(nombrePrueba.endsWith("_test"), "DB_NAME_TEST debe terminar en _test");

process.env.DB_NAME = nombrePrueba;
delete process.env.DATABASE_URL;
process.env.LIMITE_SOLICITUDES = "1000";

const { preparar } = require("../db/preparar");
const pool = require("../src/db");
const app = require("../src/app");
const auth = require("../src/auth");
const reglas = require("../src/reglas");

const CLAVE = "clave-de-prueba-123";
let servidor;
let url;
let telegram;
let recibidos;

function proximoLunes() {
  for (let i = 7; i < 14; i++) {
    const t = new Date(Date.now() - 5 * 3600e3 + i * 86400e3).toISOString().slice(0, 10);
    if (reglas.diaDeSemana(t) === 1) return t;
  }
}
const LUNES = proximoLunes();

// Una imagen de prueba (en base64) con el formato y tamaño que se pida.
async function imagen({ ancho = 600, alto = 400, formato = "jpeg", orientacion } = {}) {
  let base = sharp({ create: { width: ancho, height: alto, channels: 3, background: "#d85b91" } });

  if (orientacion) {
    // Datos ocultos "de celular": orientación y una ubicación GPS inventada.
    base = base.withMetadata({ orientation: orientacion }).withExif({
      IFD0: { Copyright: "SECRETO-DE-PRUEBA" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "4/1 36/1 0/1" }
    });
  }

  const buffer = await base.toFormat(formato).toBuffer();
  return buffer.toString("base64");
}

const reservar = async (extra = {}) => {
  const r = await fetch(`${url}/api/citas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      servicio: "Polygel", alcance: "manos", fecha: LUNES, minutos: 14 * 60,
      nombre: "Maria Secreta Lopez", telefono: "3009998877", consentimiento: true, ...extra
    })
  });
  return { estado: r.status, cuerpo: await r.json().catch(() => ({})) };
};

const contarCitas = async () => (await pool.query("SELECT count(*)::int AS n FROM citas")).rows[0].n;
const contarFotos = async () => (await pool.query("SELECT count(*)::int AS n FROM citas_fotos")).rows[0].n;

async function esperarAvisos(cantidad) {
  for (let i = 0; i < 60 && recibidos.length < cantidad; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function entrar() {
  const r = await fetch(`${url}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "alejandra", clave: CLAVE })
  });
  return r.headers.get("set-cookie").split(";")[0];
}

before(async () => {
  telegram = http.createServer((req, res) => {
    const trozos = [];
    req.on("data", (c) => trozos.push(c));
    req.on("end", () => {
      recibidos.push({
        ruta: req.url,
        tipo: req.headers["content-type"] || "",
        cuerpo: Buffer.concat(trozos)
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => telegram.listen(0, "127.0.0.1", r));

  await preparar(nombrePrueba);
  servidor = app.listen(0);
  url = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(async () => {
  await pool.query("TRUNCATE citas, bloqueos, sesiones, admins RESTART IDENTITY CASCADE");
  await auth.crearAdmin("Alejandra", CLAVE);
  recibidos = [];
  process.env.TELEGRAM_BOT_TOKEN = "123456:TOKEN-DE-PRUEBA";
  process.env.TELEGRAM_CHAT_ID = "555";
  process.env.TELEGRAM_API = `http://127.0.0.1:${telegram.address().port}`;
});

after(async () => {
  await new Promise((r) => servidor.close(r));
  await new Promise((r) => telegram.close(r));
  await pool.end();
});

test("una cita sin foto sigue funcionando igual", async () => {
  assert.equal((await reservar()).estado, 201);
  assert.equal(await contarFotos(), 0);
});

test("foto de manos: se guarda reducida, enderezada y sin datos ocultos", async () => {
  // 3000x2000 con orientación 6 (el celular la tomó de lado): debe quedar de pie y más chica.
  const foto = await imagen({ ancho: 3000, alto: 2000, orientacion: 6 });
  const original = Buffer.from(foto, "base64");
  assert.ok((await sharp(original).metadata()).exif, "la foto de prueba debe traer datos ocultos");

  // Se manda sin reducir a propósito: el servidor no debe fiarse de la página.
  assert.equal((await reservar({ fotoManos: foto })).estado, 201);

  const { rows } = await pool.query("SELECT zona, imagen FROM citas_fotos");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].zona, "manos");

  const meta = await sharp(rows[0].imagen).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok(Math.max(meta.width, meta.height) <= 1280);
  assert.ok(meta.height > meta.width, "debe quedar de pie (se aplicó la orientación)");
  assert.equal(meta.exif, undefined, "no debe quedar ningún dato oculto (EXIF/GPS)");
  assert.ok(!rows[0].imagen.includes(Buffer.from("SECRETO-DE-PRUEBA")));
});

test("manos y pies: se guardan las dos fotos; PNG y WebP también sirven", async () => {
  const r = await reservar({
    alcance: "manos y pies",
    fotoManos: await imagen({ formato: "png" }),
    fotoPies: await imagen({ formato: "webp" })
  });

  assert.equal(r.estado, 201);
  const { rows } = await pool.query("SELECT zona FROM citas_fotos ORDER BY zona");
  assert.deepEqual(rows.map((f) => f.zona), ["manos", "pies"]);
});

test("foto de pies con 'solo manos' se rechaza y no se crea la cita", async () => {
  const r = await reservar({ alcance: "manos", fotoPies: await imagen() });
  assert.equal(r.estado, 400);
  assert.equal(r.cuerpo.campo, "fotoPies");
  assert.equal(await contarCitas(), 0);
});

test("archivos que no son foto se rechazan (texto, SVG, GIF, base64 roto) y no se crea la cita", async () => {
  const malos = [
    Buffer.from("esto no es una foto").toString("base64"),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64"),
    await imagen({ formato: "gif" }),
    "%%%no-es-base64%%%",
    12345,
    { x: 1 }
  ];

  for (const malo of malos) {
    const r = await reservar({ fotoManos: malo });
    assert.equal(r.estado, 400, `debía rechazar: ${String(malo).slice(0, 30)}`);
    assert.equal(r.cuerpo.campo, "fotoManos");
  }

  assert.equal(await contarCitas(), 0);
  assert.equal(await contarFotos(), 0);
});

test("una foto demasiado grande se rechaza (400) y un cuerpo enorme también (413)", async () => {
  const r = await reservar({ fotoManos: "A".repeat(1_700_000) });
  assert.equal(r.estado, 400);

  const enorme = await fetch(`${url}/api/citas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ servicio: "Polygel", fotoManos: "A".repeat(3_500_000) })
  });
  assert.equal(enorme.status, 413);
  assert.equal(await contarCitas(), 0);
});

test("si la hora está ocupada, la foto no queda guardada (todo o nada)", async () => {
  assert.equal((await reservar({ fotoManos: await imagen() })).estado, 201);
  assert.equal(await contarFotos(), 1);

  const otra = await reservar({ nombre: "Otra Clienta", fotoManos: await imagen() });
  assert.equal(otra.estado, 409);
  assert.equal(await contarCitas(), 1);
  assert.equal(await contarFotos(), 1);
});

test("Telegram recibe el aviso y luego la foto, sin nombre ni celular", async () => {
  assert.equal((await reservar({ fotoManos: await imagen() })).estado, 201);
  await esperarAvisos(2);

  assert.equal(recibidos.length, 2);
  assert.match(recibidos[0].ruta, /\/sendMessage$/);
  assert.match(recibidos[1].ruta, /\/sendPhoto$/);
  assert.match(recibidos[1].tipo, /^multipart\/form-data/);

  const texto = recibidos[1].cuerpo.toString("latin1");
  assert.match(texto, /Foto de referencia: manos/);
  assert.match(texto, /name="photo"/);
  assert.doesNotMatch(texto, /Secreta|Lopez|3009998877/);
});

test("si Telegram falla, la cita y su foto se guardan igual", async () => {
  process.env.TELEGRAM_API = "http://127.0.0.1:1";
  assert.equal((await reservar({ fotoManos: await imagen() })).estado, 201);
  assert.equal(await contarCitas(), 1);
  assert.equal(await contarFotos(), 1);
});

test("el panel muestra qué fotos tiene cada cita y las sirve solo con sesión", async () => {
  await reservar({ alcance: "manos y pies", minutos: 14 * 60, fotoManos: await imagen(), fotoPies: await imagen() });
  const lunesSiguiente = new Date(Date.parse(`${LUNES}T12:00:00Z`) + 7 * 86400e3).toISOString().slice(0, 10);
  await reservar({ fecha: lunesSiguiente, telefono: "3001112233" }); // sin fotos
  const cookie = await entrar();

  const lista = await (await fetch(`${url}/api/admin/citas`, { headers: { Cookie: cookie } })).json();
  const conFoto = lista.citas.find((c) => c.alcance === "manos y pies");
  const sinFoto = lista.citas.find((c) => c.alcance === "manos");
  assert.deepEqual(conFoto.fotos, ["manos", "pies"]);
  assert.deepEqual(sinFoto.fotos, []);

  const foto = await fetch(`${url}/api/admin/citas/${conFoto.id}/fotos/manos`, { headers: { Cookie: cookie } });
  assert.equal(foto.status, 200);
  assert.equal(foto.headers.get("content-type"), "image/jpeg");
  assert.match(foto.headers.get("cache-control"), /private/);
  assert.equal((await sharp(Buffer.from(await foto.arrayBuffer())).metadata()).format, "jpeg");

  // Sin sesión, no.
  assert.equal((await fetch(`${url}/api/admin/citas/${conFoto.id}/fotos/manos`)).status, 401);
  // Cosas raras en la ruta, no.
  assert.equal((await fetch(`${url}/api/admin/citas/${conFoto.id}/fotos/cara`, { headers: { Cookie: cookie } })).status, 400);
  assert.equal((await fetch(`${url}/api/admin/citas/1;DROP/fotos/manos`, { headers: { Cookie: cookie } })).status, 400);
  assert.equal((await fetch(`${url}/api/admin/citas/${sinFoto.id}/fotos/manos`, { headers: { Cookie: cookie } })).status, 404);
});

test("al borrar una cita se borran sus fotos (datos:borrar)", async () => {
  await reservar({ fotoManos: await imagen() });
  assert.equal(await contarFotos(), 1);

  await pool.query("DELETE FROM citas WHERE cliente_telefono = $1", ["3009998877"]);
  assert.equal(await contarFotos(), 0);
});
