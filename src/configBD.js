// Conexión a PostgreSQL (datos del .env o DATABASE_URL)

function configuracionBD(baseDeDatos = process.env.DB_NAME || "queens_be_alejandra") {
  // los hostings suelen dar una sola URL
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ...ssl() };
  }

  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
    database: baseDeDatos,
    ...ssl()
  };
}

// DB_SSL=true para bases de datos en hosting
function ssl() {
  return process.env.DB_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {};
}

function explicarErrorBD(err) {
  if (err.code === "ECONNREFUSED") {
    return "No se pudo conectar a PostgreSQL. ¿Está encendido? ¿DB_PORT es el correcto? (por defecto 5432)";
  }

  if (err.code === "28P01") {
    return "PostgreSQL rechazó la contraseña. Revisa DB_USER y DB_PASSWORD en tu archivo .env";
  }

  if (/password must be a string/i.test(err.message)) {
    return "Falta DB_PASSWORD en tu archivo .env";
  }

  if (err.code === "3D000") {
    return "La base de datos no existe todavía. Ejecuta:  npm run db:preparar";
  }

  if (err.code === "42P01") {
    return "Falta la tabla de citas. Ejecuta:  npm run db:preparar";
  }

  return err.message;
}

module.exports = { configuracionBD, explicarErrorBD };
