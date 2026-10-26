"use strict";

// Panel de Alejandra. Solo muestra y pide acciones: el servidor valida todo.

const $ = (id) => document.getElementById(id);

const vistaLogin = $("vistaLogin");
const vistaPanel = $("vistaPanel");

let citas = [];
let historial = [];
let pestana = "pendiente";
let seccion = "citas";

// ids de pendientes ya vistas (para avisar las nuevas)
let pendientesConocidas = null;

const TITULOS = { citas: "Mis citas", bloqueos: "Bloquear", fotos: "Galería de fotos" };

// siempre textContent, nunca innerHTML con datos de clientas (XSS)
function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`/api/admin${ruta}`, {
    headers: { "Content-Type": "application/json" },
    ...opciones
  });

  const datos = await respuesta.json().catch(() => ({}));

  if (respuesta.status === 401 && ruta !== "/login") {
    mostrarLogin(); // sesión vencida
  }

  if (!respuesta.ok) {
    const error = new Error(datos.error || "Ocurrió un error. Intenta de nuevo.");
    error.estado = respuesta.status;
    throw error;
  }

  return datos;
}

let temporizadorAviso;
function avisar(texto) {
  const aviso = $("aviso");
  aviso.textContent = texto;
  aviso.classList.add("is-on");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove("is-on"), 3500);
}

function fechaLarga(fecha) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString("es-CO", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
  });
}

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// pide una segunda pulsación para acciones irreversibles
function armar(boton, textoNormal, textoArmado, accion) {
  let armado = false;
  let reloj;

  boton.addEventListener("click", () => {
    if (!armado) {
      armado = true;
      boton.classList.add("is-armed");
      boton.textContent = textoArmado;
      reloj = setTimeout(() => {
        armado = false;
        boton.classList.remove("is-armed");
        boton.textContent = textoNormal;
      }, 4000);
      return;
    }

    clearTimeout(reloj);
    accion(boton);
  });
}

// mensajes de WhatsApp (se abren listos; los envía ella)

function enlaceWhatsApp(cita) {
  const cuando = `${fechaLarga(cita.fecha)} a las ${cita.hora}`;
  let texto;

  if (cita.estado === "confirmada") {
    texto =
      `Hola, ${cita.nombre}. Soy Alejandra, de Queens Be. Tu cita de ${cita.servicio} quedó CONFIRMADA para el ${cuando}.\n\n` +
      `Te espero en la Calle 6 # 8-02, San Rafael. ¡Gracias!`;
  } else if (cita.estado === "cancelada") {
    texto =
      `Hola, ${cita.nombre}. Soy Alejandra, de Queens Be. Lamento avisarte que tuve que cancelar tu cita del ${cuando}. ` +
      `¿Quieres que busquemos otra hora?`;
  } else {
    texto =
      `Hola, ${cita.nombre}. Soy Alejandra, de Queens Be. Recibí tu solicitud de cita para el ${cuando}. ` +
      `Te escribo para confirmarla.`;
  }

  return `https://wa.me/57${cita.telefono}?text=${encodeURIComponent(texto)}`;
}

function mostrarLogin() {
  vistaPanel.hidden = true;
  vistaLogin.hidden = false;
  $("clave").value = "";
}

function mostrarPanel() {
  vistaLogin.hidden = true;
  vistaPanel.hidden = false;
}

function irA(nueva) {
  seccion = nueva;

  for (const nombre of ["citas", "bloqueos", "fotos"]) {
    $(`v-${nombre}`).hidden = nombre !== nueva;
  }

  document.querySelectorAll(".bottom__btn").forEach((boton) => {
    const activo = boton.dataset.vista === nueva;
    boton.classList.toggle("is-active", activo);
    if (activo) boton.setAttribute("aria-current", "page");
    else boton.removeAttribute("aria-current");
  });

  $("titulo").textContent = TITULOS[nueva];
  $("bannerNuevo").hidden = true; // se quita al cambiar de pantalla
  window.scrollTo({ top: 0 });
  cargarSeccion();
}

function cargarSeccion() {
  if (seccion === "citas") return pestana === "historial" ? cargarHistorial() : cargarCitas();
  if (seccion === "bloqueos") return cargarBloqueos();
  return cargarFotos();
}

function dibujar() {
  for (const estado of ["pendiente", "confirmada", "cancelada"]) {
    $(`n-${estado}`).textContent = citas.filter((c) => c.estado === estado).length;
  }

  const lista = $("lista");
  const esHistorial = pestana === "historial";
  const visibles = esHistorial ? historial : citas.filter((c) => c.estado === pestana);
  lista.replaceChildren();

  if (visibles.length === 0) {
    const textos = {
      pendiente: "No tienes solicitudes pendientes.",
      confirmada: "Todavía no hay citas confirmadas.",
      cancelada: "No hay citas canceladas.",
      historial: "Aún no hay citas de días anteriores."
    };
    lista.append(el("p", "vacio", textos[pestana]));
    return;
  }

  if (esHistorial) {
    lista.append(el("p", "ayuda", "Las últimas 100 citas de días anteriores."));
  }

  let diaActual = "";
  visibles.forEach((cita, i) => {
    if (cita.fecha !== diaActual) {
      diaActual = cita.fecha;
      lista.append(el("h2", "dia", fechaLarga(cita.fecha)));
    }

    lista.append(tarjeta(cita, i, esHistorial));
  });
}

function tarjeta(cita, i, soloLectura) {
  const caja = el("article", "cita");
  caja.style.animationDelay = `${Math.min(i, 8) * 50}ms`;

  const hora = el("div", "cita__hora", cita.hora + " ");
  hora.append(el("small", "", `a ${cita.horaFin}`));

  const nombre = el("p", "cita__nombre", cita.nombre);
  if (soloLectura) {
    nombre.append(el("span", `insignia insignia--${cita.estado}`, cita.estado));
  }

  const detalle = el("p", "cita__detalle", `${cita.servicio} · ${cita.alcance === "manos" ? "Solo manos" : "Manos y pies"}`);

  const tel = el("p", "cita__detalle");
  const enlaceTel = el("a", "cita__tel", cita.telefono);
  enlaceTel.href = `tel:+57${cita.telefono}`;
  tel.append("Celular: ", enlaceTel);

  caja.append(hora, nombre, detalle, tel);

  // fotos de referencia
  if (cita.fotos && cita.fotos.length) {
    const fila = el("div", "cita__fotos");

    for (const zona of cita.fotos) {
      const direccion = `/api/admin/citas/${cita.id}/fotos/${zona}`;
      const enlace = el("a", "cita__foto");
      const img = el("img");

      enlace.href = direccion;
      enlace.target = "_blank";
      enlace.rel = "noopener noreferrer";
      enlace.setAttribute("aria-label", `Ver foto de referencia de ${zona}`);
      img.src = direccion;
      img.alt = `Foto de referencia: ${zona}`;
      img.loading = "lazy";
      enlace.append(img, el("span", "", zona));
      fila.append(enlace);
    }

    caja.append(fila);
  }

  // el historial es de solo lectura
  if (!soloLectura) {
    const acciones = el("div", "cita__acciones");

    if (cita.estado === "pendiente") {
      const confirmar = el("button", "btn btn--ok", "Confirmar");
      confirmar.type = "button";
      confirmar.addEventListener("click", () => cambiarEstado(cita, "confirmada", confirmar));
      acciones.append(confirmar);
    }

    const wa = el("a", "btn btn--wa", cita.estado === "cancelada" ? "Avisar por WhatsApp" : "WhatsApp");
    wa.href = enlaceWhatsApp(cita);
    wa.target = "_blank";
    wa.rel = "noopener noreferrer";
    acciones.append(wa);

    if (cita.estado !== "cancelada") {
      const cancelar = el("button", "btn btn--danger", "Cancelar");
      cancelar.type = "button";
      armar(cancelar, "Cancelar", "Toca otra vez para cancelar", (b) => cambiarEstado(cita, "cancelada", b));
      acciones.append(cancelar);
    }

    caja.append(acciones);
  }

  return caja;
}

async function cambiarEstado(cita, estado, boton) {
  boton.disabled = true;

  try {
    const datos = await api(`/citas/${cita.id}`, {
      method: "PATCH",
      body: JSON.stringify({ estado })
    });

    citas = citas.map((c) => (c.id === cita.id ? datos.cita : c));
    dibujar();
    avisar(
      estado === "confirmada"
        ? "Cita confirmada. Toca WhatsApp para avisarle a la clienta."
        : "Cita cancelada. La hora quedó libre. Toca WhatsApp para avisarle."
    );
  } catch (error) {
    avisar(error.message);
    await cargarCitas(); // muestra lo real
  }
}

// avisa si hay pendientes nuevas
function revisarNuevas() {
  const ahora = citas.filter((c) => c.estado === "pendiente");

  // contador en la barra y en el título
  const marca = $("n-nav");
  marca.textContent = ahora.length;
  marca.hidden = ahora.length === 0;
  document.title = (ahora.length ? `(${ahora.length}) ` : "") + "Panel · Queens Be Alejandra";

  if (pendientesConocidas) {
    const nuevas = ahora.filter((c) => !pendientesConocidas.has(c.id));

    if (nuevas.length) {
      const texto = nuevas.length === 1
        ? `Nueva solicitud de ${nuevas[0].nombre} para el ${fechaLarga(nuevas[0].fecha)} a las ${nuevas[0].hora}`
        : `Tienes ${nuevas.length} solicitudes nuevas.`;

      const banner = $("bannerNuevo");
      banner.textContent = texto;
      banner.hidden = false;
      avisar(texto);

      try { navigator.vibrate?.([200, 100, 200]); } catch {}
    }
  }

  pendientesConocidas = new Set(ahora.map((c) => c.id));
}

async function cargarCitas() {
  try {
    const datos = await api("/citas");
    citas = datos.citas;
    revisarNuevas();
    if (seccion === "citas" && pestana !== "historial") dibujar();
  } catch (error) {
    if (error.estado !== 401) avisar(error.message);
  }
}

async function cargarHistorial() {
  try {
    historial = (await api("/citas?vista=historial")).citas;
    dibujar();
  } catch (error) {
    if (error.estado !== 401) avisar(error.message);
  }
}

const MIN_PASO = 30;

function llenarHoras() {
  const desde = $("bDesde");
  const hasta = $("bHasta");

  // 6:00 a. m. a 8:00 p. m., cada 30 minutos
  for (let min = 6 * 60; min <= 20 * 60; min += MIN_PASO) {
    const horas24 = Math.floor(min / 60);
    const texto = `${horas24 % 12 || 12}:${String(min % 60).padStart(2, "0")} ${horas24 < 12 ? "a. m." : "p. m."}`;

    if (min < 20 * 60) desde.add(new Option(texto, String(min)));
    if (min > 6 * 60) hasta.add(new Option(texto, String(min)));
  }

  desde.value = String(12 * 60);
  hasta.value = String(13 * 60);
}

function textoBloqueo(b) {
  if (!b.todoElDia) return `${fechaLarga(b.fecha)} · de ${b.desde} a ${b.hasta}`;
  if (b.fecha === b.fechaFin) return `${fechaLarga(b.fecha)} · todo el día`;
  return `Del ${fechaLarga(b.fecha)} al ${fechaLarga(b.fechaFin)}`;
}

function dibujarBloqueos(lista) {
  const caja = $("listaBloqueos");
  caja.replaceChildren();

  if (lista.length === 0) {
    caja.append(el("p", "vacio", "No tienes bloqueos activos."));
    return;
  }

  lista.forEach((b, i) => {
    const fila = el("article", "bloqueo");
    fila.style.animationDelay = `${Math.min(i, 8) * 50}ms`;

    const texto = el("div");
    texto.append(el("p", "bloqueo__titulo", textoBloqueo(b)));
    if (b.motivo) texto.append(el("p", "bloqueo__detalle", b.motivo));

    const quitar = el("button", "btn btn--danger", "Quitar");
    quitar.type = "button";
    armar(quitar, "Quitar", "¿Seguro?", () => quitarBloqueo(b, quitar));

    fila.append(texto, quitar);
    caja.append(fila);
  });
}

async function cargarBloqueos() {
  try {
    dibujarBloqueos((await api("/bloqueos")).bloqueos);
  } catch (error) {
    if (error.estado !== 401) avisar(error.message);
  }
}

async function quitarBloqueo(bloqueo, boton) {
  boton.disabled = true;

  try {
    await api(`/bloqueos/${bloqueo.id}`, { method: "DELETE" });
    avisar("Bloqueo quitado. Ese horario vuelve a estar disponible.");
  } catch (error) {
    avisar(error.message);
  }

  cargarBloqueos();
}

function mostrarConflictos(conflictos) {
  const caja = $("avisoConflicto");
  caja.replaceChildren();

  if (conflictos.length === 0) {
    caja.hidden = true;
    return;
  }

  caja.append(
    el("strong", "", `Ojo: ya tienes ${conflictos.length === 1 ? "1 cita" : conflictos.length + " citas"} en ese horario.`),
    el("span", "", "No se cancelaron solas. Ve a Citas para cancelarlas o avisarles por WhatsApp:")
  );

  const ul = el("ul");
  conflictos.forEach((c) => {
    ul.append(el("li", "", `${c.nombre} · ${fechaLarga(c.fecha)} a las ${c.hora} (${c.estado})`));
  });

  caja.append(ul);
  caja.hidden = false;
}

function tipoBloqueo() {
  return document.querySelector('input[name="bTipo"]:checked').value;
}

document.querySelectorAll('input[name="bTipo"]').forEach((opcion) => {
  opcion.addEventListener("change", () => {
    $("bDias").hidden = tipoBloqueo() !== "dia";
    $("bHoras").hidden = tipoBloqueo() !== "horas";
  });
});

$("formBloqueo").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const error = $("errBloqueo");
  const boton = $("btnBloquear");
  error.hidden = true;
  mostrarConflictos([]);

  const tipo = tipoBloqueo();
  const cuerpo = { fecha: $("bFecha").value, tipo, motivo: $("bMotivo").value.trim() };

  if (!cuerpo.fecha) {
    error.textContent = "Elige el día.";
    error.hidden = false;
    return;
  }

  if (tipo === "dia") {
    if ($("bHastaFecha").value) cuerpo.hastaFecha = $("bHastaFecha").value;
  } else {
    cuerpo.desde = Number($("bDesde").value);
    cuerpo.hasta = Number($("bHasta").value);

    if (cuerpo.desde >= cuerpo.hasta) {
      error.textContent = "La hora de inicio debe ser antes que la de fin.";
      error.hidden = false;
      return;
    }
  }

  boton.disabled = true;

  try {
    const datos = await api("/bloqueos", { method: "POST", body: JSON.stringify(cuerpo) });

    $("formBloqueo").reset();
    $("bDias").hidden = false;
    $("bHoras").hidden = true;
    $("bDesde").value = String(12 * 60);
    $("bHasta").value = String(13 * 60);

    mostrarConflictos(datos.conflictos);
    avisar("Listo. Ese horario ya no se puede reservar.");
    cargarBloqueos();
  } catch (fallo) {
    error.textContent = fallo.estado === 400 ? "Revisa las fechas y horas (el día no puede ser pasado)." : fallo.message;
    error.hidden = false;
  } finally {
    boton.disabled = false;
  }
});

const MAX_BYTES = 15 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];

function dibujarFotos(lista) {
  const caja = $("listaFotos");
  caja.replaceChildren();
  $("n-fotos").textContent = lista.length;

  if (lista.length === 0) {
    caja.append(el("p", "vacio", "La galería está vacía. Sube la primera foto."));
    return;
  }

  lista.forEach((f, i) => {
    const tarjetaFoto = el("article", "fotoadm");
    tarjetaFoto.style.animationDelay = `${Math.min(i, 8) * 40}ms`;

    const img = document.createElement("img");
    img.src = `/media/fotos/${f.id}/mini`;
    img.alt = f.descripcion;
    img.loading = "lazy";

    const quitar = el("button", "btn btn--danger", "Quitar");
    quitar.type = "button";
    armar(quitar, "Quitar", "¿Seguro?", () => quitarFoto(f, quitar));

    tarjetaFoto.append(img, el("p", "", f.descripcion), quitar);
    caja.append(tarjetaFoto);
  });
}

async function cargarFotos() {
  try {
    const respuesta = await fetch("/api/fotos");
    dibujarFotos((await respuesta.json()).fotos);
  } catch {
    avisar("No pudimos cargar las fotos.");
  }
}

async function quitarFoto(foto, boton) {
  boton.disabled = true;

  try {
    await api(`/fotos/${foto.id}`, { method: "DELETE" });
    avisar("Foto quitada de la galería.");
  } catch (error) {
    avisar(error.message);
  }

  cargarFotos();
}

$("formFoto").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const error = $("errFoto");
  const boton = $("btnFoto");
  const archivo = $("fArchivo").files[0];
  error.hidden = true;

  const fallar = (texto) => {
    error.textContent = texto;
    error.hidden = false;
  };

  if (!archivo) return fallar("Elige una foto.");
  if (!TIPOS.includes(archivo.type)) return fallar("La foto debe ser JPG, PNG o WebP.");
  if (archivo.size > MAX_BYTES) return fallar("La foto pesa más de 15 MB. Elige una más liviana.");

  const descripcion = $("fDesc").value.trim();
  if (descripcion.length < 3) return fallar("Escribe una descripción corta de la foto.");

  boton.disabled = true;
  boton.textContent = "Subiendo…";

  try {
    // el servidor revisa, reduce y borra EXIF
    const respuesta = await fetch(`/api/admin/fotos?descripcion=${encodeURIComponent(descripcion)}`, {
      method: "POST",
      headers: { "Content-Type": archivo.type },
      body: archivo
    });

    const datos = await respuesta.json().catch(() => ({}));

    if (respuesta.status === 401) mostrarLogin();
    if (!respuesta.ok) throw new Error(datos.error || "No se pudo subir la foto.");

    $("formFoto").reset();
    avisar("Foto subida. Ya aparece en la página.");
    cargarFotos();
  } catch (fallo) {
    fallar(fallo.message);
  } finally {
    boton.disabled = false;
    boton.textContent = "Subir foto";
  }
});

document.querySelectorAll(".bottom__btn").forEach((boton) => {
  boton.addEventListener("click", () => irA(boton.dataset.vista));
});

document.querySelectorAll(".tab").forEach((boton) => {
  boton.addEventListener("click", () => {
    pestana = boton.dataset.estado;

    document.querySelectorAll(".tab").forEach((otro) => {
      const activa = otro === boton;
      otro.classList.toggle("is-active", activa);
      otro.setAttribute("aria-selected", String(activa));
    });

    $("bannerNuevo").hidden = true;

    if (pestana === "historial") cargarHistorial();
    else dibujar();
  });
});

// el aviso lleva a Pendientes
$("bannerNuevo").addEventListener("click", () => {
  $("bannerNuevo").hidden = true;
  irA("citas");
  document.querySelector('.tab[data-estado="pendiente"]').click();
});

$("btnRefrescar").addEventListener("click", async () => {
  await cargarSeccion();
  avisar("Actualizado.");
});

$("btnSalir").addEventListener("click", async () => {
  try {
    await api("/logout", { method: "POST" });
  } catch {}

  citas = [];
  historial = [];
  pendientesConocidas = null;
  document.title = "Panel · Queens Be Alejandra";
  mostrarLogin();
});

$("formLogin").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const error = $("errLogin");
  const boton = $("btnLogin");
  error.hidden = true;
  boton.disabled = true;
  boton.textContent = "Entrando…";

  try {
    await api("/login", {
      method: "POST",
      body: JSON.stringify({ usuario: $("usuario").value.trim(), clave: $("clave").value })
    });

    mostrarPanel();
    irA("citas");
  } catch (fallo) {
    error.textContent = fallo.message;
    error.hidden = false;
  } finally {
    boton.disabled = false;
    boton.textContent = "Entrar";
  }
});

llenarHoras();
$("bFecha").min = hoyLocal();
$("bHastaFecha").min = hoyLocal();

(async () => {
  try {
    await api("/yo");
    mostrarPanel();
    irA("citas");
  } catch {
    mostrarLogin();
  }
})();

// revisa cada 30 s si llegó algo nuevo
setInterval(async () => {
  if (vistaPanel.hidden || document.hidden) return;
  await cargarCitas();
}, 30000);

// al volver a la pestaña
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !vistaPanel.hidden) cargarCitas();
});
