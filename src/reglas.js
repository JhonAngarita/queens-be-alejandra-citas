// Reglas del negocio: qué horas se pueden reservar (siempre se validan en el servidor)

const SERVICIOS = [
  "Manicura tradicional",
  "Semipermanente",
  "Uñas acrílicas",
  "Polygel",
  "Soft Gel",
  "Recubrimiento",
  "Recubrimiento en gel",
  "Dipiin",
  "Otro / diseño (lo converso por WhatsApp)"
];

// duración en minutos (provisional, por confirmar con Alejandra)
const DURACIONES = {
  manos: 120,
  "manos y pies": 240
};

// horario en minutos desde la medianoche; 0 = domingo, null = cerrado
const HORARIO = {
  0: null,
  1: [13 * 60 + 30, 18 * 60],
  2: [13 * 60 + 30, 18 * 60],
  3: [13 * 60 + 30, 18 * 60],
  4: [13 * 60 + 30, 18 * 60],
  5: [13 * 60 + 30, 18 * 60],
  6: [7 * 60, 19 * 60]
};

// inicios cada 30 minutos
const PASO_MIN = 30;

// Colombia: UTC-5 todo el año
const ZONA = "-05:00";

const pad = (numero) => String(numero).padStart(2, "0");

function servicioValido(servicio) {
  return SERVICIOS.includes(servicio);
}

// hasOwn evita alcance = "__proto__"
function alcanceValido(alcance) {
  return typeof alcance === "string" && Object.hasOwn(DURACIONES, alcance);
}

function fechaValida(texto) {
  if (typeof texto !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return false;
  }

  const [anio, mes, dia] = texto.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

function diaDeSemana(texto) {
  const [anio, mes, dia] = texto.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

function estaCerrado(fecha) {
  return !HORARIO[diaDeSemana(fecha)];
}

function inicioDe(fecha, minutos) {
  return new Date(`${fecha}T${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}:00${ZONA}`);
}

function etiqueta(minutos) {
  const horas24 = Math.floor(minutos / 60);
  const horas12 = horas24 % 12 || 12;
  return `${horas12}:${pad(minutos % 60)} ${horas24 < 12 ? "a. m." : "p. m."}`;
}

// horas de inicio del día que caben antes del cierre y que no han pasado
function horasDelDia(fecha, alcance, ahora = new Date()) {
  if (!fechaValida(fecha) || !alcanceValido(alcance)) {
    return [];
  }

  const rango = HORARIO[diaDeSemana(fecha)];

  if (!rango) {
    return [];
  }

  const duracion = DURACIONES[alcance];
  const horas = [];

  for (let minutos = rango[0]; minutos + duracion <= rango[1]; minutos += PASO_MIN) {
    if (inicioDe(fecha, minutos) > ahora) {
      horas.push(minutos);
    }
  }

  return horas;
}

// se cruzan si cada una empieza antes de que termine la otra
function seSolapan(inicioA, finA, inicioB, finB) {
  return inicioA < finB && finA > inicioB;
}

module.exports = {
  SERVICIOS,
  DURACIONES,
  HORARIO,
  PASO_MIN,
  servicioValido,
  alcanceValido,
  fechaValida,
  diaDeSemana,
  estaCerrado,
  inicioDe,
  etiqueta,
  horasDelDia,
  seSolapan
};

function partesColombia(instante) {
  const d = new Date(instante.getTime() - 5 * 60 * 60 * 1000);
  return {
    fecha: d.toISOString().slice(0, 10),
    minutos: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

function inicioDelDiaColombia(ahora = new Date()) {
  return inicioDe(partesColombia(ahora).fecha, 0);
}

module.exports.partesColombia = partesColombia;
module.exports.inicioDelDiaColombia = inicioDelDiaColombia;
