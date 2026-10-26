// Crea la base de datos (si no existe) y las tablas

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { configuracionBD, explicarErrorBD } = require("../src/configBD");

async function preparar(nombreBD = process.env.DB_NAME || "queens_be_alejandra") {
  // el nombre va dentro de SQL: solo caracteres seguros
  if (!/^[a-z0-9_]+$/i.test(nombreBD)) {
    throw new Error("DB_NAME solo puede tener letras, números y guion bajo (_).");
  }

  // crea la base si no existe
  if (!process.env.DATABASE_URL) {
    const admin = new Client(configuracionBD("postgres"));
    await admin.connect();

    try {
      const { rows } = await admin.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [nombreBD]
      );

      if (rows.length === 0) {
        await admin.query(`CREATE DATABASE "${nombreBD}"`);
        console.log(`Base de datos "${nombreBD}" creada.`);
      } else {
        console.log(`La base de datos "${nombreBD}" ya existía.`);
      }
    } finally {
      await admin.end();
    }
  }

  // tablas
  const cliente = new Client(configuracionBD(nombreBD));
  await cliente.connect();

  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await cliente.query(sql);
    console.log("Tablas listas.");
  } finally {
    await cliente.end();
  }
}

module.exports = { preparar };

// al ejecutarlo directo
if (require.main === module) {
  preparar().catch((err) => {
    console.error("\nNo se pudo preparar la base de datos.");
    console.error(explicarErrorBD(err));
    process.exit(1);
  });
}
