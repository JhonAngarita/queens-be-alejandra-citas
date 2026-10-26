// App Express, separada de server.js para poder probarla

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const pool = require("./db");
const citas = require("./routes/citas");
const admin = require("./routes/admin");
const fotos = require("./routes/fotos");

const app = express();

// detrás de un proxy (hosting) la IP real viene en las cabeceras
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

// en local (http) se quita upgrade-insecure-requests
const directivas = {};
if (process.env.NODE_ENV !== "production") {
  directivas["upgrade-insecure-requests"] = null;
}

app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: directivas } }));

// el panel no se indexa
app.use("/admin", (req, res, next) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
});

app.use("/media/fotos", fotos.media);

app.use(express.static(path.join(__dirname, "..", "public")));

// para monitores y health checks: no toca la base de datos (así no la despierta)
app.get("/api/vivo", (req, res) => res.json({ ok: true }));

app.get("/api/salud", async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});

app.use("/api/fotos", fotos.api);
app.use("/api/admin", express.json({ limit: "2kb" }), admin);
// esta ruta recibe fotos en base64: el rate limit va antes de leer el cuerpo
app.post("/api/citas", citas.limiteCrear, express.json({ limit: "3mb" }));
app.use("/api", express.json({ limit: "10kb" }), citas);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Esa ruta no existe." });
});

// el detalle del error solo va a la consola
app.use((err, req, res, next) => {
  const estado = err.status || err.statusCode || 500;

  if (estado === 413) {
    const esCita = req.originalUrl.startsWith("/api/citas");
    return res.status(413).json({
      error: esCita ? "Las fotos pesan demasiado. Prueba con otras más pequeñas." : "El archivo es muy pesado (máximo 15 MB)."
    });
  }

  if (estado < 500) {
    return res.status(estado).json({ error: "Solicitud no válida." });
  }

  console.error(err);
  res.status(500).json({ error: "Ocurrió un error. Intenta de nuevo en un momento." });
});

module.exports = app;
