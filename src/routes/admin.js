// Rutas del panel (/api/admin). Todas menos login y logout piden sesión.

const express = require("express");
const sharp = require("sharp");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const reglas = require("../reglas");
const auth = require("../auth");

const router = express.Router();

router.use(auth.mismoOrigen);

// frena el adivinado de claves
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LIMITE_LOGIN) || 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true, // solo cuentan los intentos fallidos
  message: { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." }
});

// estados desde los que se permite pasar a cada estado
const DESDE = {
  confirmada: ["pendiente"],
  cancelada: ["pendiente", "confirmada"]
};

function aJson(fila) {
  const inicio = reglas.partesColombia(fila.inicio);
  const fin = reglas.partesColombia(fila.fin);

  return {
    id: fila.id,
    servicio: fila.servicio,
    alcance: fila.alcance,
    nombre: fila.cliente_nombre,
    telefono: fila.cliente_telefono,
    fecha: inicio.fecha,
    hora: reglas.etiqueta(inicio.minutos),
    horaFin: reglas.etiqueta(fin.minutos),
    estado: fila.estado,
    fotos: fila.fotos || []
  };
}

// columnas de una cita y zonas con foto (sin traer las fotos)
const COLUMNAS_CITA =
  `id, servicio, alcance, cliente_nombre, cliente_telefono, inicio, fin, estado,
   ARRAY(SELECT zona FROM citas_fotos WHERE cita_id = citas.id ORDER BY zona) AS fotos`;

router.post("/login", limiteLogin, async (req, res) => {
  const { usuario, clave } = req.body ?? {};

  if (typeof usuario !== "string" || typeof clave !== "string" || !usuario || !clave ||
      usuario.length > 60 || clave.length > 200) {
    return res.status(400).json({ error: "Escribe tu usuario y tu clave." });
  }

  const adminId = await auth.comprobarLogin(usuario, clave);

  // mismo mensaje en ambos casos
  if (!adminId) {
    return res.status(401).json({ error: "Usuario o clave incorrectos." });
  }

  const token = await auth.crearSesion(adminId);

  res.cookie(auth.NOMBRE_COOKIE, token, { ...auth.opcionesCookie(), maxAge: auth.DURACION_SESION_MS });
  res.json({ ok: true });
});

router.post("/logout", async (req, res) => {
  await auth.cerrarSesion(req);
  res.clearCookie(auth.NOMBRE_COOKIE, auth.opcionesCookie());
  res.json({ ok: true });
});

router.get("/yo", auth.requiereAdmin, (req, res) => {
  res.json({ usuario: req.admin.usuario });
});

router.get("/citas", auth.requiereAdmin, async (req, res) => {
  const hoy = reglas.inicioDelDiaColombia();

  // historial: últimas 100 citas pasadas
  const sql =
    req.query.vista === "historial"
      ? `SELECT ${COLUMNAS_CITA} FROM citas WHERE fin < $1 ORDER BY inicio DESC LIMIT 100`
      : `SELECT ${COLUMNAS_CITA} FROM citas WHERE fin >= $1 ORDER BY inicio`;

  const { rows } = await pool.query(sql, [hoy]);

  res.json({ citas: rows.map(aJson) });
});

router.patch("/citas/:id", auth.requiereAdmin, async (req, res) => {
  const nuevo = req.body?.estado;

  if (!/^\d{1,9}$/.test(req.params.id) || !Object.hasOwn(DESDE, nuevo)) {
    return res.status(400).json({ error: "Solicitud no válida." });
  }

  const { rows } = await pool.query(
    `UPDATE citas SET estado = $1 WHERE id = $2 AND estado = ANY($3)
     RETURNING ${COLUMNAS_CITA}`,
    [nuevo, Number(req.params.id), DESDE[nuevo]]
  );

  if (rows[0]) {
    return res.json({ cita: aJson(rows[0]) });
  }

  // ¿no existe o ya estaba en otro estado?
  const existe = await pool.query("SELECT estado FROM citas WHERE id = $1", [Number(req.params.id)]);

  if (!existe.rows[0]) {
    return res.status(404).json({ error: "Esa cita no existe." });
  }

  res.status(409).json({ error: `No se puede: la cita está ${existe.rows[0].estado}.` });
});

router.get("/citas/:id/fotos/:zona", auth.requiereAdmin, async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id) || !["manos", "pies"].includes(req.params.zona)) {
    return res.status(400).json({ error: "Solicitud no válida." });
  }

  const { rows } = await pool.query(
    "SELECT imagen FROM citas_fotos WHERE cita_id = $1 AND zona = $2",
    [Number(req.params.id), req.params.zona]
  );

  if (!rows[0]) return res.status(404).json({ error: "Esa foto no existe." });

  // "private": sin caché compartida
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=600" });
  res.send(rows[0].imagen);
});

const DIA_MS = 24 * 60 * 60 * 1000;

function bloqueoAJson(fila) {
  const inicio = reglas.partesColombia(fila.inicio);
  const ultimoInstante = reglas.partesColombia(new Date(fila.fin.getTime() - 1));

  return {
    id: fila.id,
    fecha: inicio.fecha,
    fechaFin: ultimoInstante.fecha,
    todoElDia: inicio.minutos === 0 && (fila.fin - fila.inicio) % DIA_MS === 0,
    desde: reglas.etiqueta(inicio.minutos),
    hasta: reglas.etiqueta(reglas.partesColombia(fila.fin).minutos),
    motivo: fila.motivo || ""
  };
}

function diasEntre(desde, hasta) {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return (Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / DIA_MS;
}

router.get("/bloqueos", auth.requiereAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, inicio, fin, motivo FROM bloqueos WHERE fin > now() ORDER BY inicio"
  );

  res.json({ bloqueos: rows.map(bloqueoAJson) });
});

router.post("/bloqueos", auth.requiereAdmin, async (req, res) => {
  const { fecha, tipo, desde, hasta, hastaFecha, motivo } = req.body ?? {};
  const malo = (campo) => res.status(400).json({ error: "Revisa los datos del bloqueo.", campo });

  if (!reglas.fechaValida(fecha)) return malo("fecha");
  if (fecha < reglas.partesColombia(new Date()).fecha) return malo("fecha");
  if (tipo !== "dia" && tipo !== "horas") return malo("tipo");

  const motivoLimpio = typeof motivo === "string" ? motivo.trim() : "";
  if (motivo !== undefined && typeof motivo !== "string") return malo("motivo");
  if (motivoLimpio.length > 80) return malo("motivo");

  let inicio;
  let fin;

  if (tipo === "dia") {
    // uno o varios días completos (máximo 60)
    const ultimo = hastaFecha ? hastaFecha : fecha;
    if (!reglas.fechaValida(ultimo)) return malo("hastaFecha");

    const dias = diasEntre(fecha, ultimo);
    if (dias < 0 || dias > 59) return malo("hastaFecha");

    inicio = reglas.inicioDe(fecha, 0);
    fin = new Date(inicio.getTime() + (dias + 1) * DIA_MS);
  } else {
    const bueno = (n) => Number.isInteger(n) && n % reglas.PASO_MIN === 0;
    if (!bueno(desde) || !bueno(hasta) || desde < 0 || hasta > 24 * 60 || desde >= hasta) {
      return malo("horas");
    }

    inicio = reglas.inicioDe(fecha, desde);
    fin = new Date(inicio.getTime() + (hasta - desde) * 60 * 1000);
  }

  const { rows } = await pool.query(
    "INSERT INTO bloqueos (inicio, fin, motivo) VALUES ($1, $2, $3) RETURNING id, inicio, fin, motivo",
    [inicio, fin, motivoLimpio || null]
  );

  // si hay citas en ese horario no se cancelan solas: se devuelven como conflictos
  const choques = await pool.query(
    `SELECT ${COLUMNAS_CITA}
       FROM citas WHERE estado <> 'cancelada' AND tstzrange(inicio, fin) && tstzrange($1, $2)
      ORDER BY inicio`,
    [inicio, fin]
  );

  res.status(201).json({ bloqueo: bloqueoAJson(rows[0]), conflictos: choques.rows.map(aJson) });
});

router.delete("/bloqueos/:id", auth.requiereAdmin, async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) {
    return res.status(400).json({ error: "Solicitud no válida." });
  }

  const { rowCount } = await pool.query("DELETE FROM bloqueos WHERE id = $1", [Number(req.params.id)]);

  if (!rowCount) return res.status(404).json({ error: "Ese bloqueo no existe." });
  res.json({ ok: true });
});

const MAX_FOTOS = 40;
const FORMATOS = ["jpeg", "png", "webp"];

// archivo directo (no formulario); la sesión se valida antes de leer el cuerpo
router.post(
  "/fotos",
  auth.requiereAdmin,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "15mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(415).json({ error: "Sube una foto en formato JPG, PNG o WebP." });
    }

    const descripcion = String(req.query.descripcion || "").trim().slice(0, 200) ||
      "Diseño de uñas de Queens Be Alejandra";

    const { rows: cuenta } = await pool.query("SELECT count(*)::int AS total FROM fotos");
    if (cuenta[0].total >= MAX_FOTOS) {
      return res.status(409).json({ error: `Ya hay ${MAX_FOTOS} fotos. Quita alguna para subir otra.` });
    }

    let grande;
    let mini;

    try {
      // el formato se mira en el contenido
      const meta = await sharp(req.body, { limitInputPixels: 60_000_000 }).metadata();
      if (!FORMATOS.includes(meta.format)) throw new Error("formato");

      // rotate() aplica la orientación; recodificar a JPEG borra EXIF y GPS; flatten da fondo blanco a PNG
      const base = sharp(req.body, { limitInputPixels: 60_000_000 }).rotate().flatten({ background: "#ffffff" });

      grande = await base
        .clone()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });

      mini = await base
        .clone()
        .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
    } catch {
      return res.status(400).json({ error: "No se pudo leer la foto. Prueba con otra (JPG, PNG o WebP)." });
    }

    const { rows } = await pool.query(
      `INSERT INTO fotos (grande, mini, ancho, alto, descripcion)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [grande.data, mini, grande.info.width, grande.info.height, descripcion]
    );

    res.status(201).json({ ok: true, id: rows[0].id });
  }
);

router.delete("/fotos/:id", auth.requiereAdmin, async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) {
    return res.status(400).json({ error: "Solicitud no válida." });
  }

  const { rowCount } = await pool.query("DELETE FROM fotos WHERE id = $1", [Number(req.params.id)]);

  if (!rowCount) return res.status(404).json({ error: "Esa foto no existe." });
  res.json({ ok: true });
});

module.exports = router;
