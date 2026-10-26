// Mantenimiento de datos personales:
//   limpiar          fotos de citas de hace más de 30 días y citas de hace más de 12 meses
//   borrar <celular> todas las citas de ese número

require("dotenv").config();

const pool = require("../src/db");
const { explicarErrorBD } = require("../src/configBD");

const MESES_GUARDADO = 12;
const DIAS_FOTOS = 30;

async function limpiar() {
  // las fotos se borran antes que la cita
  const fotos = await pool.query(
    `DELETE FROM citas_fotos
      WHERE cita_id IN (SELECT id FROM citas WHERE fin < now() - make_interval(days => $1))`,
    [DIAS_FOTOS]
  );
  console.log(`Listo: ${fotos.rowCount} foto(s) de referencia de hace más de ${DIAS_FOTOS} días borrada(s).`);

  const { rowCount } = await pool.query(
    `DELETE FROM citas WHERE fin < now() - make_interval(months => $1)`,
    [MESES_GUARDADO]
  );
  console.log(`Listo: ${rowCount} cita(s) de hace más de ${MESES_GUARDADO} meses borrada(s).`);
}

async function borrar(telefono) {
  if (!/^3\d{9}$/.test(telefono || "")) {
    throw new Error('Escribe el celular de 10 dígitos. Ejemplo:  npm run datos:borrar -- 3001234567');
  }

  const { rowCount } = await pool.query("DELETE FROM citas WHERE cliente_telefono = $1", [telefono]);
  console.log(`Listo: ${rowCount} cita(s) de ese celular borrada(s).`);
}

const [modo, telefono] = process.argv.slice(2);

(modo === "borrar" ? borrar(telefono) : limpiar())
  .catch((err) => {
    console.error("No se pudo: " + explicarErrorBD(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
