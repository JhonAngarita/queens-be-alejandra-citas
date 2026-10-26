-- Tablas de Queens Be Alejandra (se puede ejecutar varias veces)

CREATE TABLE IF NOT EXISTS citas (
  id                SERIAL PRIMARY KEY,
  servicio          TEXT        NOT NULL,
  alcance           TEXT        NOT NULL CHECK (alcance IN ('manos', 'manos y pies')),
  cliente_nombre    TEXT        NOT NULL,
  cliente_telefono  TEXT        NOT NULL CHECK (cliente_telefono ~ '^3[0-9]{9}$'),
  inicio            TIMESTAMPTZ NOT NULL,
  fin               TIMESTAMPTZ NOT NULL,
  estado            TEXT        NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'confirmada', 'cancelada')),
  -- aceptación del tratamiento de datos (Ley 1581)
  consentimiento_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  creada_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (fin > inicio),

  -- dos citas no canceladas no pueden cruzarse (el rango [) permite una cita pegada a otra)
  CONSTRAINT citas_sin_solapamiento
    EXCLUDE USING gist (tstzrange(inicio, fin) WITH &&)
    WHERE (estado <> 'cancelada')
);

-- consulta por día
CREATE INDEX IF NOT EXISTS citas_inicio_idx ON citas (inicio);

-- la clave se guarda como hash
CREATE TABLE IF NOT EXISTS admins (
  id         SERIAL PRIMARY KEY,
  usuario    TEXT NOT NULL UNIQUE,
  clave_hash TEXT NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sesiones: se guarda el hash del token
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  creada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en  TIMESTAMPTZ NOT NULL
);

-- bloqueos: rangos sin reservas (vacaciones, almuerzo)
CREATE TABLE IF NOT EXISTS bloqueos (
  id        SERIAL PRIMARY KEY,
  inicio    TIMESTAMPTZ NOT NULL,
  fin       TIMESTAMPTZ NOT NULL,
  motivo    TEXT CHECK (char_length(motivo) <= 80),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fin > inicio)
);

CREATE INDEX IF NOT EXISTS bloqueos_inicio_idx ON bloqueos (inicio);

-- también impide citas dentro de un bloqueo
CREATE OR REPLACE FUNCTION impedir_cita_en_bloqueo() RETURNS trigger AS $$
BEGIN
  IF NEW.estado <> 'cancelada' AND EXISTS (
    SELECT 1 FROM bloqueos b
     WHERE tstzrange(b.inicio, b.fin) && tstzrange(NEW.inicio, NEW.fin)
  ) THEN
    RAISE EXCEPTION 'Ese horario está bloqueado' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS citas_no_en_bloqueo ON citas;
CREATE TRIGGER citas_no_en_bloqueo
  BEFORE INSERT ON citas
  FOR EACH ROW EXECUTE FUNCTION impedir_cita_en_bloqueo();

-- fotos de la galería, guardadas en la BD
CREATE TABLE IF NOT EXISTS fotos (
  id          SERIAL PRIMARY KEY,
  grande      BYTEA NOT NULL,
  mini        BYTEA NOT NULL,
  ancho       INTEGER NOT NULL,
  alto        INTEGER NOT NULL,
  descripcion TEXT NOT NULL CHECK (char_length(descripcion) BETWEEN 1 AND 200),
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- fotos de referencia de las citas; se borran con la cita o 30 días después (npm run datos:limpiar)
CREATE TABLE IF NOT EXISTS citas_fotos (
  id        SERIAL PRIMARY KEY,
  cita_id   INTEGER NOT NULL REFERENCES citas(id) ON DELETE CASCADE,
  zona      TEXT    NOT NULL CHECK (zona IN ('manos', 'pies')),
  imagen    BYTEA   NOT NULL,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cita_id, zona)
);
