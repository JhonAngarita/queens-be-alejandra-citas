// Pruebas de las reglas de horario (sin base de datos)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const reglas = require("../src/reglas");

// Fechas de ejemplo (2030-01-07 es lunes)
const LUNES = "2030-01-07";
const SABADO = "2030-01-05";
const DOMINGO = "2030-01-06";
const ANTES = new Date("2030-01-01T08:00:00-05:00"); // "hoy" está lejos: todas las horas son futuras

test("fechaValida acepta fechas reales y rechaza las inventadas", () => {
  assert.equal(reglas.fechaValida("2030-01-07"), true);
  assert.equal(reglas.fechaValida("2030-02-31"), false);
  assert.equal(reglas.fechaValida("07/01/2030"), false);
  assert.equal(reglas.fechaValida(""), false);
  assert.equal(reglas.fechaValida(undefined), false);
});

test("diaDeSemana calcula bien el día", () => {
  assert.equal(reglas.diaDeSemana(LUNES), 1);
  assert.equal(reglas.diaDeSemana(SABADO), 6);
  assert.equal(reglas.diaDeSemana(DOMINGO), 0);
});

test("lunes, solo manos: de 1:30 p. m. a 4:00 p. m. cada 30 minutos", () => {
  const horas = reglas.horasDelDia(LUNES, "manos", ANTES);
  assert.equal(horas.length, 6);
  assert.equal(horas[0], 13 * 60 + 30);
  assert.equal(horas.at(-1), 16 * 60); // 4:00 + 2 h = cierra a las 6:00
});

test("lunes, manos y pies (4 h): solo caben 1:30 y 2:00 p. m.", () => {
  assert.deepEqual(reglas.horasDelDia(LUNES, "manos y pies", ANTES), [810, 840]);
});

test("sábado: abre 7:00 a. m. y cierra 7:00 p. m.", () => {
  const manos = reglas.horasDelDia(SABADO, "manos", ANTES);
  assert.equal(manos.length, 21);
  assert.equal(manos[0], 7 * 60);
  assert.equal(manos.at(-1), 17 * 60); // 5:00 + 2 h = cierra a las 7:00

  const conPies = reglas.horasDelDia(SABADO, "manos y pies", ANTES);
  assert.equal(conPies.length, 17);
  assert.equal(conPies.at(-1), 15 * 60);
});

test("domingo está cerrado", () => {
  assert.equal(reglas.estaCerrado(DOMINGO), true);
  assert.deepEqual(reglas.horasDelDia(DOMINGO, "manos", ANTES), []);
});

test("una zona inválida no devuelve horas (ni con trucos como __proto__)", () => {
  assert.deepEqual(reglas.horasDelDia(LUNES, "pestañas", ANTES), []);
  assert.deepEqual(reglas.horasDelDia(LUNES, "__proto__", ANTES), []);
  assert.equal(reglas.alcanceValido("constructor"), false);
});

test("hoy no se ofrecen horas que ya pasaron", () => {
  const ahora = new Date("2030-01-07T14:10:00-05:00");
  const horas = reglas.horasDelDia(LUNES, "manos", ahora);
  assert.equal(horas[0], 14 * 60 + 30); // la de las 2:00 ya pasó
  assert.equal(reglas.horasDelDia(LUNES, "manos", new Date("2030-01-07T18:30:00-05:00")).length, 0);
});

test("seSolapan: cruzadas sí, una detrás de otra no", () => {
  const h = (hora) => new Date(`2030-01-07T${hora}:00-05:00`);
  assert.equal(reglas.seSolapan(h("13:30"), h("15:00"), h("14:30"), h("16:00")), true);
  assert.equal(reglas.seSolapan(h("13:30"), h("15:00"), h("15:00"), h("16:30")), false);
  assert.equal(reglas.seSolapan(h("13:30"), h("15:00"), h("12:00"), h("13:30")), false);
});

test("inicioDe usa la hora de Colombia (UTC-5)", () => {
  assert.equal(reglas.inicioDe(LUNES, 13 * 60 + 30).toISOString(), "2030-01-07T18:30:00.000Z");
});

test("etiqueta escribe la hora en formato colombiano", () => {
  assert.equal(reglas.etiqueta(13 * 60 + 30), "1:30 p. m.");
  assert.equal(reglas.etiqueta(7 * 60), "7:00 a. m.");
  assert.equal(reglas.etiqueta(12 * 60), "12:00 p. m.");
});
