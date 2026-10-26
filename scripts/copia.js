// Copia de seguridad con pg_dump en copias/ (no se sube a GitHub: tiene datos personales)

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// en Windows pg_dump suele no estar en el PATH: se busca en la carpeta de PostgreSQL
function buscarPgDump() {
  if (spawnSync("pg_dump", ["--version"]).status === 0) return "pg_dump";

  if (process.platform === "win32") {
    const raiz = process.env.ProgramFiles || "C:\\Program Files";
    const carpeta = path.join(raiz, "PostgreSQL");

    if (fs.existsSync(carpeta)) {
      // versión más nueva primero
      const versiones = fs.readdirSync(carpeta).sort((a, b) => Number(b) - Number(a));

      for (const version of versiones) {
        const ruta = path.join(carpeta, version, "bin", "pg_dump.exe");
        if (fs.existsSync(ruta)) return ruta;
      }
    }
  }

  return null;
}

const pgDump = buscarPgDump();

if (!pgDump) {
  console.error("No encontré pg_dump. Está en la carpeta bin de PostgreSQL (por ejemplo C:\\Program Files\\PostgreSQL\\18\\bin).");
  process.exit(1);
}

const ahora = new Date(Date.now() - 5 * 60 * 60 * 1000); // hora de Colombia
const marca = ahora.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "");
const carpeta = path.join(__dirname, "..", "copias");
fs.mkdirSync(carpeta, { recursive: true });

const archivo = path.join(carpeta, `queens_${marca}.sql`);
// primero a un temporal, para no perder la última copia buena si falla
const temporal = `${archivo}.parcial`;

// la clave va por PGPASSWORD, no en la línea de comandos
const argumentos = process.env.DATABASE_URL
  ? ["--dbname", process.env.DATABASE_URL]
  : [
      "--host", process.env.DB_HOST || "localhost",
      "--port", String(process.env.DB_PORT || 5432),
      "--username", process.env.DB_USER || "postgres",
      process.env.DB_NAME || "queens_be_alejandra"
    ];

const resultado = spawnSync(pgDump, ["--no-owner", "--file", temporal, ...argumentos], {
  env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || "" },
  encoding: "utf8"
});

if (resultado.status !== 0) {
  fs.rmSync(temporal, { force: true });
  console.error("No se pudo hacer la copia:\n" + (resultado.stderr || resultado.error));
  process.exit(1);
}

fs.renameSync(temporal, archivo);
const kb = Math.round(fs.statSync(archivo).size / 1024);
console.log(`Copia lista: copias/${path.basename(archivo)} (${kb} KB)`);
console.log("Guárdala también fuera del computador (USB o nube privada). No la subas a GitHub.");
