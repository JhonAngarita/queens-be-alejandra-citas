// Autenticación del panel: clave con scrypt, sesión en cookie httpOnly y solo el sha256 del token en la BD

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const pool = require("./db");

const scrypt = promisify(crypto.scrypt);

const NOMBRE_COOKIE = "sesion_admin";
const DURACION_SESION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

const sha256 = (texto) => crypto.createHash("sha256").update(texto).digest("hex");

async function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const huella = await scrypt(clave, sal, 64);
  return `scrypt$${sal.toString("hex")}$${huella.toString("hex")}`;
}

async function verificarClave(clave, guardada) {
  const [tipo, salHex, huellaHex] = String(guardada).split("$");

  if (tipo !== "scrypt" || !salHex || !huellaHex) return false;

  const esperada = Buffer.from(huellaHex, "hex");
  const calculada = await scrypt(clave, Buffer.from(salHex, "hex"), esperada.length);

  // comparación en tiempo constante
  return crypto.timingSafeEqual(calculada, esperada);
}

// hash falso para igualar el tiempo cuando el usuario no existe
const huellaFalsa = hashClave("clave-falsa-para-igualar-tiempos");

async function crearAdmin(usuario, clave) {
  if (!/^[a-z0-9_.-]{3,30}$/i.test(usuario)) {
    throw new Error("El usuario debe tener de 3 a 30 letras, números, punto, guion o guion bajo.");
  }

  if (typeof clave !== "string" || clave.length < 10 || clave.length > 200) {
    throw new Error("La clave debe tener al menos 10 caracteres.");
  }

  const nombre = usuario.toLowerCase();
  const hash = await hashClave(clave);

  const { rows } = await pool.query(
    `INSERT INTO admins (usuario, clave_hash) VALUES ($1, $2)
     ON CONFLICT (usuario) DO UPDATE SET clave_hash = EXCLUDED.clave_hash
     RETURNING id`,
    [nombre, hash]
  );

  // si cambió la clave, se cierran las sesiones anteriores
  await pool.query("DELETE FROM sesiones WHERE admin_id = $1", [rows[0].id]);

  return rows[0].id;
}

async function comprobarLogin(usuario, clave) {
  const { rows } = await pool.query("SELECT id, clave_hash FROM admins WHERE usuario = $1", [
    String(usuario).toLowerCase()
  ]);

  const admin = rows[0];
  const correcta = await verificarClave(clave, admin ? admin.clave_hash : await huellaFalsa);

  return admin && correcta ? admin.id : null;
}

async function crearSesion(adminId) {
  const token = crypto.randomBytes(32).toString("base64url");

  await pool.query("DELETE FROM sesiones WHERE expira_en < now()"); // borra sesiones vencidas
  await pool.query(
    "INSERT INTO sesiones (token_hash, admin_id, expira_en) VALUES ($1, $2, $3)",
    [sha256(token), adminId, new Date(Date.now() + DURACION_SESION_MS)]
  );

  return token;
}

function leerCookie(req, nombre) {
  const partes = String(req.headers.cookie || "").split(";");

  for (const parte of partes) {
    const [clave, ...resto] = parte.trim().split("=");
    if (clave === nombre) return decodeURIComponent(resto.join("="));
  }

  return null;
}

async function cerrarSesion(req) {
  const token = leerCookie(req, NOMBRE_COOKIE);
  if (token) await pool.query("DELETE FROM sesiones WHERE token_hash = $1", [sha256(token)]);
}

function opcionesCookie() {
  return {
    httpOnly: true, // no accesible desde JS
    sameSite: "strict", // protege contra CSRF
    secure: process.env.NODE_ENV === "production", // https en producción
    path: "/"
  };
}

async function requiereAdmin(req, res, next) {
  const token = leerCookie(req, NOMBRE_COOKIE);

  if (token) {
    const { rows } = await pool.query(
      `SELECT a.id, a.usuario FROM sesiones s JOIN admins a ON a.id = s.admin_id
        WHERE s.token_hash = $1 AND s.expira_en > now()`,
      [sha256(token)]
    );

    if (rows[0]) {
      req.admin = rows[0];
      return next();
    }
  }

  res.status(401).json({ error: "Inicia sesión para continuar." });
}

// rechaza peticiones de otros orígenes
function mismoOrigen(req, res, next) {
  const origen = req.headers.origin;

  if (req.method !== "GET" && origen) {
    let host = null;

    try {
      host = new URL(origen).host;
    } catch {}

    if (host !== req.headers.host) {
      return res.status(403).json({ error: "Solicitud no permitida." });
    }
  }

  next();
}

module.exports = {
  NOMBRE_COOKIE,
  DURACION_SESION_MS,
  hashClave,
  verificarClave,
  crearAdmin,
  comprobarLogin,
  crearSesion,
  cerrarSesion,
  opcionesCookie,
  requiereAdmin,
  mismoOrigen
};
