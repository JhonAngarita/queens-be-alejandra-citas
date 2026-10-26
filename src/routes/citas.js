// API pública: config, disponibilidad y creación de citas

const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const reglas = require("../reglas");
const avisos = require("../avisos");
const fotosCita = require("../fotosCita");

const router = express.Router();

// límite por IP (LIMITE_SOLICITUDES en .env)
const limiteCrear = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LIMITE_SOLICITUDES) || 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Hiciste muchas solicitudes seguidas. Intenta de nuevo en unos minutos." }
});

const limiteConsultar = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiadas consultas seguidas. Intenta de nuevo en unos minutos." }
});

router.get("/config", (req, res) => {
  res.json({ duraciones: reglas.DURACIONES });
});

router.get("/disponibilidad", limiteConsultar, async (req, res) => {
  const { fecha, alcance } = req.query;

  if (!reglas.fechaValida(fecha) || !reglas.alcanceValido(alcance)) {
    return res.status(400).json({ error: "Fecha o zona no válidas." });
  }

  const duracionMin = reglas.DURACIONES[alcance];
  const horas = reglas.horasDelDia(fecha, alcance);

  const desde = reglas.inicioDe(fecha, 0);
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);

  // las citas y los bloqueos ocupan horario
  const { rows: citas } = await pool.query(
    `SELECT inicio, fin FROM citas
      WHERE estado <> 'cancelada' AND fin > $1 AND inicio < $2
     UNION ALL
     SELECT inicio, fin FROM bloqueos
      WHERE fin > $1 AND inicio < $2`,
    [desde, hasta]
  );

  res.json({
    cerrado: reglas.estaCerrado(fecha),
    duracionMin,
    horas: horas.map((minutos) => {
      const inicio = reglas.inicioDe(fecha, minutos);
      const fin = new Date(inicio.getTime() + duracionMin * 60 * 1000);
      const ocupada = citas.some((c) => reglas.seSolapan(inicio, fin, c.inicio, c.fin));

      return { minutos, etiqueta: reglas.etiqueta(minutos), disponible: !ocupada };
    })
  });
});

router.post("/citas", async (req, res) => {
  const { servicio, alcance, fecha, minutos, nombre, telefono, consentimiento, fotoManos, fotoPies } = req.body ?? {};

  const nombreLimpio = typeof nombre === "string" ? nombre.trim().replace(/\s+/g, " ") : "";

  // validación en el servidor
  const problema =
    (!reglas.servicioValido(servicio) && "servicio") ||
    (!reglas.alcanceValido(alcance) && "alcance") ||
    (!reglas.fechaValida(fecha) && "fecha") ||
    (nombreLimpio.length < 2 || nombreLimpio.length > 60 ? "nombre" : null) ||
    (!/^3\d{9}$/.test(typeof telefono === "string" ? telefono : "") && "telefono") ||
    (consentimiento !== true && "consentimiento") ||
    null;

  if (problema) {
    return res.status(400).json({ error: "Revisa los datos e intenta de nuevo.", campo: problema });
  }

  // la hora debe estar entre las que ofrece el servidor
  if (!Number.isInteger(minutos) || !reglas.horasDelDia(fecha, alcance).includes(minutos)) {
    return res.status(400).json({ error: "Esa hora no está disponible. Elige otra.", campo: "hora" });
  }

  const inicio = reglas.inicioDe(fecha, minutos);
  const fin = new Date(inicio.getTime() + reglas.DURACIONES[alcance] * 60 * 1000);

  // fotos opcionales: manos y, con manos y pies, pies
  const quiere = (valor) => valor !== undefined && valor !== null && valor !== "";
  const fotos = [];

  if (quiere(fotoPies) && alcance !== "manos y pies") {
    return res.status(400).json({ error: "La foto de pies solo va con la opción manos y pies.", campo: "fotoPies" });
  }

  for (const [zona, valor] of [["manos", fotoManos], ["pies", fotoPies]]) {
    if (!quiere(valor)) continue;

    try {
      fotos.push({ zona, imagen: await fotosCita.procesar(valor) });
    } catch {
      return res.status(400).json({
        error: `No pudimos leer la foto de ${zona}. Prueba con otra (JPG, PNG o WebP) o envía la solicitud sin foto.`,
        campo: zona === "manos" ? "fotoManos" : "fotoPies"
      });
    }
  }

  // cita y fotos en una sola transacción
  const conexion = await pool.connect();

  try {
    await conexion.query("BEGIN");

    const { rows } = await conexion.query(
      `INSERT INTO citas (servicio, alcance, cliente_nombre, cliente_telefono, inicio, fin)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [servicio, alcance, nombreLimpio, telefono, inicio, fin]
    );

    for (const foto of fotos) {
      await conexion.query(
        "INSERT INTO citas_fotos (cita_id, zona, imagen) VALUES ($1, $2, $3)",
        [rows[0].id, foto.zona, foto.imagen]
      );
    }

    await conexion.query("COMMIT");
  } catch (err) {
    await conexion.query("ROLLBACK").catch(() => {});

    // 23P01: se cruza con otra cita o con un bloqueo
    if (err.code === "23P01") {
      return res
        .status(409)
        .json({ error: "Esa hora ya no está disponible. Elige otra." });
    }

    throw err;
  } finally {
    conexion.release();
  }

  // aviso sin esperar; si falla, la cita ya quedó guardada
  avisos.nuevaCita({ servicio, alcance, inicio, fotos });

  return res.status(201).json({ ok: true, estado: "pendiente" });
});

router.limiteCrear = limiteCrear;

module.exports = router;
