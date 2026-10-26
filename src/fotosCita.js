// Foto de referencia de la cita. Se revisa y se recodifica aquí (se pierden EXIF y GPS).

const sharp = require("sharp");

const FORMATOS = ["jpeg", "png", "webp"];

// base64 máximo (~1,2 MB)
const MAX_BASE64 = 1_600_000;
const LADO_MAX = 1280;
const PIXELES_MAX = 40_000_000;

async function procesar(base64) {
  if (
    typeof base64 !== "string" ||
    base64.length === 0 ||
    base64.length > MAX_BASE64 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  ) {
    throw new Error("foto no válida");
  }

  const bytes = Buffer.from(base64, "base64");
  const opciones = { limitInputPixels: PIXELES_MAX };

  // el formato se mira en el contenido, no en lo que declare el cliente
  const meta = await sharp(bytes, opciones).metadata();
  if (!FORMATOS.includes(meta.format)) throw new Error("formato no permitido");

  return sharp(bytes, opciones)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

module.exports = { procesar, MAX_BASE64 };
