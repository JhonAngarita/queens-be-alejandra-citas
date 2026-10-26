// Galería pública: lista y archivos de las fotos

const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db");

const limite = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const api = express.Router();
const media = express.Router();

api.get("/", limite, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, descripcion, ancho, alto FROM fotos ORDER BY id DESC"
  );

  res.set("Cache-Control", "no-cache");
  res.json({ fotos: rows });
});

media.get("/:id/:tam", limite, async (req, res) => {
  const { id, tam } = req.params;

  if (!/^\d{1,9}$/.test(id) || (tam !== "mini" && tam !== "grande")) {
    return res.status(404).end();
  }

  // tam ya está validado (mini o grande)
  const { rows } = await pool.query(`SELECT ${tam} AS archivo FROM fotos WHERE id = $1`, [Number(id)]);

  if (!rows[0]) return res.status(404).end();

  // la foto no cambia (reemplazar = id nuevo): se puede cachear
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type("image/jpeg").send(rows[0].archivo);
});

module.exports = { api, media };
