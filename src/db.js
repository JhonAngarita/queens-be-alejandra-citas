// Pool de conexiones a PostgreSQL

const { Pool } = require("pg");
const { configuracionBD } = require("./configBD");

const pool = new Pool({ ...configuracionBD(), max: 5, connectionTimeoutMillis: 10000 });

// una conexión inactiva puede caerse (p. ej. la BD del hosting se suspende); sin este handler el proceso se cierra
pool.on("error", (err) => console.error("Conexión inactiva con error:", err.message));

module.exports = pool;
