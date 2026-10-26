// Importa las fotos iniciales de db/semilla/fotos (solo si la galería está vacía)

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const pool = require("../src/db");
const { explicarErrorBD } = require("../src/configBD");

const FOTOS = [
  ["foto-1", "Uñas largas cuadradas con diseños dibujados a mano: un burrito azul, un moño rosado y rayas rosadas y azules con una estrella negra"],
  ["foto-2", "Uñas cuadradas con cerezas rojas con brillo dibujadas a mano, una francesa roja y una uña color vino"],
  ["foto-3", "Uñas de los pies con francesa blanca y mariposas con florecitas en los dedos gordos"],
  ["foto-4", "Uñas largas en punta con azul degradado, flores azules, estrellas doradas y pedrería dorada"],
  ["foto-5", "Uñas almendradas con francesa roja y dorada, moños y estrellas doradas y uñas rojo brillante"]
];

async function importar() {
  const carpeta = path.join(__dirname, "..", "db", "semilla", "fotos");

  if (!fs.existsSync(carpeta)) {
    console.log("No hay fotos iniciales en db/semilla/fotos. Sube las fotos desde el panel (sección Fotos).");
    return;
  }

  const { rows } = await pool.query("SELECT count(*)::int AS total FROM fotos");

  if (rows[0].total > 0) {
    console.log("La galería ya tiene fotos. No se importó nada.");
    return;
  }

  // de la más vieja a la más nueva
  for (const [nombre, descripcion] of [...FOTOS].reverse()) {
    const archivo = fs.readFileSync(path.join(carpeta, `${nombre}-grande.jpg`));
    const base = sharp(archivo).rotate();

    const grande = await base
      .clone()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    const mini = await base
      .clone()
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();

    await pool.query(
      "INSERT INTO fotos (grande, mini, ancho, alto, descripcion) VALUES ($1, $2, $3, $4, $5)",
      [grande.data, mini, grande.info.width, grande.info.height, descripcion]
    );
  }

  console.log("Listo: 5 fotos importadas a la galería.");
}

importar()
  .catch((err) => {
    console.error("No se pudo importar: " + explicarErrorBD(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
