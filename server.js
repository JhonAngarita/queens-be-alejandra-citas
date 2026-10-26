
require("dotenv").config();

const app = require("./src/app");
const pool = require("./src/db");
const { explicarErrorBD } = require("./src/configBD");

const PORT = Number(process.env.PORT) || 3000;

const servidor = app.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);

  pool
    .query("SELECT 1 FROM citas LIMIT 1")
    .then(() => console.log("Base de datos conectada."))
    .catch((err) => {
      console.error("\nAVISO: no se pudo usar la base de datos.");
      console.error(explicarErrorBD(err));
    });
});

servidor.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`El puerto ${PORT} ya está en uso. Cierra el otro servidor o cambia PORT en el .env`);
  } else {
    console.error(err);
  }

  process.exit(1);
});

function cerrar() {
  console.log("\nCerrando...");
  servidor.close(() => pool.end().then(() => process.exit(0)));
}

process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
