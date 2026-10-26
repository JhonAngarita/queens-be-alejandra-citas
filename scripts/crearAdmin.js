// Crea la usuaria del panel o cambia su clave (la pide por terminal)

require("dotenv").config();

const readline = require("node:readline");
const pool = require("../src/db");
const { crearAdmin } = require("../src/auth");
const { explicarErrorBD } = require("../src/configBD");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let oculto = false;

// no muestra la clave mientras se escribe
rl._writeToOutput = (texto) => {
  if (!oculto || texto.includes("\n") || texto.includes("\r")) rl.output.write(texto);
};

const preguntar = (texto, esClave = false) =>
  new Promise((resolver) => {
    oculto = false;
    rl.question(texto, (respuesta) => {
      oculto = false;
      resolver(respuesta.trim());
    });
    oculto = esClave;
  });

(async () => {
  try {
    const usuario = await preguntar("Usuario (ej: alejandra): ");
    const clave = await preguntar("Clave (mínimo 10 caracteres): ", true);
    const repetida = await preguntar("Repite la clave: ", true);

    if (clave !== repetida) throw new Error("Las claves no coinciden.");

    await crearAdmin(usuario, clave);
    console.log(`\nListo. Ya puedes entrar a http://localhost:3000/admin con el usuario "${usuario.toLowerCase()}".`);
  } catch (err) {
    console.error("\nNo se pudo crear: " + explicarErrorBD(err));
    process.exitCode = 1;
  } finally {
    rl.close();
    await pool.end();
  }
})();
