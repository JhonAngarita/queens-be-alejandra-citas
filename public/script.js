"use strict";

const WHATSAPP_NUMBER = "573043211968";

// celular colombiano: 10 dígitos, empieza por 3
const LARGO_CELULAR = 10;

const $ = (id) => document.getElementById(id);
const pad = (numero) => String(numero).padStart(2, "0");

// menú móvil
const menuBtn = $("menuBtn");
const nav = $("nav");

if (menuBtn && nav) {
  menuBtn.addEventListener("click", () => {
    const abierto = nav.classList.toggle("is-open");

    menuBtn.setAttribute("aria-expanded", String(abierto));
    menuBtn.textContent = abierto ? "Cerrar" : "Menú";
  });

  nav.querySelectorAll("a").forEach((enlace) => {
    enlace.addEventListener("click", () => {
      nav.classList.remove("is-open");
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.textContent = "Menú";
    });
  });
}

// sombra del encabezado
const header = $("header");

if (header) {
  const marcarScroll = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 10);
  };

  marcarScroll();
  window.addEventListener("scroll", marcarScroll, { passive: true });
}

// año del pie
const year = $("year");

if (year) {
  year.textContent = new Date().getFullYear();
}

// enlace a WhatsApp
const waLink = $("waLink");

if (waLink) {
  waLink.href = `https://wa.me/${WHATSAPP_NUMBER}`;
  waLink.target = "_blank";
  waLink.rel = "noopener noreferrer";
}

// animaciones al hacer scroll
const elementosAnimados = document.querySelectorAll(
  ".section h2, .section .lead, .service, .gallery li, .steps li, #bookingForm, .contact__list li"
);

const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// revelar(): anima un elemento al entrar en pantalla (también la usa la galería)
let revelar = null;

if ("IntersectionObserver" in window && !reducirMovimiento) {
  const observador = new IntersectionObserver(
    (entradas, observer) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
          entrada.target.classList.add("is-visible");
          observer.unobserve(entrada.target);
        }
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -40px 0px"
    }
  );

  // escalonado dentro de cada grupo
  const posiciones = new Map();

  revelar = (elemento) => {
    const grupo = elemento.parentElement;
    const posicion = posiciones.get(grupo) || 0;

    posiciones.set(grupo, posicion + 1);
    elemento.style.setProperty("--d", Math.min(posicion, 5));
    elemento.classList.add("reveal");
    observador.observe(elemento);
  };

  elementosAnimados.forEach(revelar);
}

// formulario de reservas: el servidor decide qué horas hay
const form = $("bookingForm");
const estado = $("status");
const fecha = $("fecha");
const horasBox = $("horas");
const botonEnviar = form ? form.querySelector('button[type="submit"]') : null;

// minutos por zona, vienen de /api/config
let duraciones = null;

function obtenerFechaLocal() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
}

function textoDuracion(minutos) {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;

  if (horas && resto) return `${horas} h ${resto} min`;
  if (horas) return `${horas} h`;
  return `${resto} min`;
}

function alcanceElegido() {
  const opcion = form.querySelector('input[name="alcance"]:checked');
  return opcion ? opcion.value : "manos";
}

function mostrarDuracion() {
  const ayuda = $("duracionAyuda");

  if (!duraciones || !duraciones[alcanceElegido()]) {
    ayuda.textContent = "";
    return;
  }

  ayuda.textContent =
    `Duración estimada: ${textoDuracion(duraciones[alcanceElegido()])}. ` +
    `Las horas ya tienen en cuenta ese tiempo.`;
}

function mostrarMensajeHoras(texto) {
  horasBox.innerHTML = `<p class="slots__msg">${texto}</p>`;
}

function mostrarErrorFecha(ok, motivo = "") {
  const errorFecha = $("err-fecha");

  errorFecha.textContent = motivo;
  errorFecha.hidden = ok;
  fecha.classList.toggle("invalid", !ok);
  fecha.setAttribute("aria-invalid", String(!ok));
}

// revisión rápida; el servidor revisa de nuevo
function revisarFecha(valor) {
  if (!valor) {
    return { ok: false, motivo: "Elige una fecha." };
  }

  if (valor < obtenerFechaLocal()) {
    return { ok: false, motivo: "Esa fecha ya pasó. Elige otra." };
  }

  return { ok: true, motivo: "" };
}

// descarta respuestas viejas si el usuario cambió de fecha
let numeroConsulta = 0;

async function actualizarHoras() {
  const numero = ++numeroConsulta;
  const seleccion = fecha.value;

  mostrarDuracion();
  $("err-hora").hidden = true;

  if (!seleccion) {
    mostrarErrorFecha(true);
    mostrarMensajeHoras("Elige primero la fecha.");
    return;
  }

  const revision = revisarFecha(seleccion);
  mostrarErrorFecha(revision.ok, revision.motivo);

  if (!revision.ok) {
    mostrarMensajeHoras("Elige un día en el que podamos atenderte.");
    return;
  }

  // conserva la hora elegida si sigue libre
  const previa = form.querySelector('input[name="hora"]:checked');
  const horaPrevia = previa ? previa.value : null;

  mostrarMensajeHoras("Cargando horarios…");

  try {
    const respuesta = await fetch(
      `/api/disponibilidad?fecha=${encodeURIComponent(seleccion)}&alcance=${encodeURIComponent(alcanceElegido())}`
    );
    const datos = await respuesta.json();

    if (numero !== numeroConsulta) return; // respuesta vieja

    if (!respuesta.ok) throw new Error(datos.error);

    if (datos.cerrado) {
      mostrarErrorFecha(false, "Los domingos estamos cerrados. Elige otro día.");
      mostrarMensajeHoras("Elige un día en el que podamos atenderte.");
      return;
    }

    if (datos.horas.length === 0) {
      mostrarMensajeHoras("No quedan horarios para este día. Elige otro día.");
      return;
    }

    if (!datos.horas.some((h) => h.disponible)) {
      mostrarMensajeHoras("Este día ya está completo. Elige otro día.");
      return;
    }

    horasBox.innerHTML = datos.horas
      .map((h, i) => {
        const marcada = h.disponible && String(h.minutos) === horaPrevia ? " checked" : "";
        const ocupada = h.disponible
          ? ""
          : '<span class="sr"> (ocupada)</span>';

        return (
          `<label class="slot${h.disponible ? "" : " slot--off"}" style="--i:${i}">` +
          `<input type="radio" name="hora" value="${h.minutos}" data-etiqueta="${h.etiqueta}"` +
          `${h.disponible ? "" : " disabled"}${marcada}>` +
          `<span>${h.etiqueta}${ocupada}</span>` +
          `</label>`
        );
      })
      .join("");
  } catch {
    if (numero === numeroConsulta) {
      mostrarMensajeHoras("No pudimos cargar los horarios. Revisa tu conexión e intenta de nuevo.");
    }
  }
}

if (form && fecha) {
  fecha.min = obtenerFechaLocal();
  fecha.addEventListener("change", actualizarHoras);

  // cambiar de zona cambia las horas
  form.querySelectorAll('input[name="alcance"]').forEach((opcion) => {
    opcion.addEventListener("change", actualizarHoras);
  });

  horasBox.addEventListener("change", () => {
    $("err-hora").hidden = true;
  });

  // duraciones desde el servidor
  fetch("/api/config")
    .then((respuesta) => respuesta.json())
    .then((datos) => {
      duraciones = datos.duraciones;
      mostrarDuracion();
    })
    .catch(() => {});
}

// celular
const telefono = $("telefono");
const contador = $("telefonoCount");

// solo dígitos; quita el 57 si pegan "+57 ..."
function limpiarCelular(valor) {
  let digitos = valor.replace(/\D/g, "");

  if (digitos.length === LARGO_CELULAR + 2 && digitos.startsWith("57")) {
    digitos = digitos.slice(2);
  }

  return digitos.slice(0, LARGO_CELULAR);
}

function celularValido(digitos) {
  return /^3\d{9}$/.test(digitos);
}

function actualizarContador(largo) {
  contador.textContent = `${largo}/${LARGO_CELULAR}`;
  contador.classList.toggle("is-full", largo === LARGO_CELULAR);
}

if (telefono && contador) {
  telefono.addEventListener("input", () => {
    const limpio = limpiarCelular(telefono.value);

    if (telefono.value !== limpio) {
      telefono.value = limpio;
    }

    actualizarContador(limpio.length);

    // corrige en vivo si ya estaba marcado
    if (telefono.classList.contains("invalid")) {
      marcar(telefono, celularValido(limpio), "err-telefono");
    }
  });
}

// validación
function marcar(campo, esValido, idError) {
  const mensaje = $(idError);

  campo.classList.toggle("invalid", !esValido);
  campo.setAttribute("aria-invalid", String(!esValido));

  if (mensaje) {
    mensaje.hidden = esValido;
  }

  return esValido;
}

// foto de referencia: se reduce en el celular antes de enviarla; el servidor la revisa igual
const LADO_FOTO = 1280;
const MAX_ORIGINAL = 25 * 1024 * 1024;

const fotosListas = { manos: null, pies: null }; // base64 listo para enviar
const fotosEnProceso = { manos: null, pies: null };

function leerComoTexto(archivo) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result);
    lector.onerror = () => rechazar(new Error("lectura"));
    lector.readAsDataURL(archivo);
  });
}

function cargarImagen(direccion) {
  return new Promise((resolver, rechazar) => {
    const imagen = new Image();
    imagen.onload = () => resolver(imagen);
    imagen.onerror = () => rechazar(new Error("imagen"));
    imagen.src = direccion;
  });
}

// devuelve un data URL JPEG reducido
async function reducirFoto(archivo) {
  if (archivo.size > MAX_ORIGINAL) {
    throw new Error("Esa foto pesa demasiado (máximo 25 MB). Elige otra.");
  }

  let imagen;

  try {
    imagen = await cargarImagen(await leerComoTexto(archivo));
  } catch {
    throw new Error("No pudimos leer esa foto. Prueba con otra en formato JPG o PNG.");
  }

  const escala = Math.min(1, LADO_FOTO / Math.max(imagen.naturalWidth, imagen.naturalHeight));
  const ancho = Math.max(1, Math.round(imagen.naturalWidth * escala));
  const alto = Math.max(1, Math.round(imagen.naturalHeight * escala));

  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;

  const pincel = lienzo.getContext("2d");
  pincel.fillStyle = "#ffffff"; // fondo blanco (PNG transparente)
  pincel.fillRect(0, 0, ancho, alto);
  pincel.drawImage(imagen, 0, 0, ancho, alto);

  return lienzo.toDataURL("image/jpeg", 0.8);
}

function limpiarFoto(zona) {
  const campo = $(zona === "manos" ? "fotoManos" : "fotoPies");
  const previa = $(zona === "manos" ? "previaManos" : "previaPies");

  fotosListas[zona] = null;
  fotosEnProceso[zona] = null;
  campo.value = "";
  previa.hidden = true;
  previa.removeAttribute("src");
  $(zona === "manos" ? "err-fotoManos" : "err-fotoPies").hidden = true;
}

async function elegirFoto(zona) {
  const campo = $(zona === "manos" ? "fotoManos" : "fotoPies");
  const previa = $(zona === "manos" ? "previaManos" : "previaPies");
  const error = $(zona === "manos" ? "err-fotoManos" : "err-fotoPies");
  const archivo = campo.files && campo.files[0];

  fotosListas[zona] = null;
  previa.hidden = true;
  error.hidden = true;

  if (!archivo) return;

  const tarea = reducirFoto(archivo)
    .then((dataUrl) => {
      fotosListas[zona] = dataUrl.slice(dataUrl.indexOf(",") + 1); // solo el base64
      previa.src = dataUrl;
      previa.hidden = false;
    })
    .catch((fallo) => {
      campo.value = "";
      error.textContent = fallo.message;
      error.hidden = false;
    });

  fotosEnProceso[zona] = tarea;
  await tarea;
}

if (form) {
  $("fotoManos").addEventListener("change", () => elegirFoto("manos"));
  $("fotoPies").addEventListener("change", () => elegirFoto("pies"));

  // el campo de pies solo aparece con manos y pies
  const actualizarCampoPies = () => {
    const conPies = alcanceElegido() === "manos y pies";

    $("campoFotoPies").hidden = !conPies;
    if (!conPies) limpiarFoto("pies");
  };

  form.querySelectorAll('input[name="alcance"]').forEach((opcion) => {
    opcion.addEventListener("change", actualizarCampoPies);
  });
}

// envío
if (form) {
  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    const campos = form.elements;
    const servicio = campos.servicio.value;
    const nombre = campos.nombre.value.trim();
    const celular = limpiarCelular(campos.telefono.value);
    const revisionFecha = revisarFecha(campos.fecha.value);
    const horaElegida = form.querySelector('input[name="hora"]:checked');

    mostrarErrorFecha(revisionFecha.ok, revisionFecha.motivo);

    const horaOk = revisionFecha.ok && Boolean(horaElegida);
    $("err-hora").hidden = horaOk || !revisionFecha.ok;

    const resultados = [
      marcar(campos.servicio, servicio !== "", "err-servicio"),
      revisionFecha.ok,
      horaOk,
      marcar(campos.nombre, nombre.length >= 2, "err-nombre"),
      marcar(campos.telefono, celularValido(celular), "err-telefono"),
      marcar(campos.consent, campos.consent.checked, "err-consent")
    ];

    estado.className = "status";

    if (resultados.includes(false)) {
      estado.textContent = "Revisa los campos marcados e inténtalo de nuevo.";
      return;
    }

    estado.textContent = "";
    botonEnviar.disabled = true;
    botonEnviar.textContent = "Enviando…";

    const alcance = alcanceElegido();

    // espera si aún se está reduciendo una foto
    await Promise.all([fotosEnProceso.manos, fotosEnProceso.pies]);

    try {
      const respuesta = await fetch("/api/citas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicio,
          alcance,
          fecha: campos.fecha.value,
          minutos: Number(horaElegida.value),
          nombre,
          telefono: celular,
          consentimiento: campos.consent.checked,
          fotoManos: fotosListas.manos || undefined,
          fotoPies: alcance === "manos y pies" ? fotosListas.pies || undefined : undefined
        })
      });

      const datos = await respuesta.json().catch(() => ({}));

      if (!respuesta.ok) {
        estado.textContent = datos.error || "No pudimos guardar tu solicitud. Intenta de nuevo.";

        // otra clienta tomó la hora: se refrescan
        if (respuesta.status === 409) {
          actualizarHoras();
        }

        return;
      }

      // guardada como pendiente; el mensaje de WhatsApp lo envía la clienta con el botón
      const [anio, mes, dia] = campos.fecha.value.split("-");
      const duracion = duraciones && duraciones[alcance]
        ? `Duración estimada: ${textoDuracion(duraciones[alcance])}\n`
        : "";

      const mensaje =
        `Hola, Alejandra. Espero que estés muy bien.\n\n` +
        `Acabo de solicitar una cita en la página de Queens Be Alejandra.\n\n` +
        `DATOS DE LA CITA\n` +
        `------------------------------\n` +
        `Servicio: ${servicio}\n` +
        `Zona: ${alcance === "manos" ? "Solo manos" : "Manos y pies"}\n` +
        `Fecha: ${dia}/${mes}/${anio}\n` +
        `Hora: ${horaElegida.dataset.etiqueta}\n` +
        duracion +
        `Nombre: ${nombre}\n` +
        `Teléfono: ${celular}\n` +
        `------------------------------\n\n` +
        `La cita queda pendiente hasta recibir tu confirmación.\n\n` +
        `Muchas gracias por tu atención. 💗`;

      $("waBtn").href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`;

      // limpia el formulario (el celular no queda en pantalla)
      form.reset();
      limpiarFoto("manos");
      limpiarFoto("pies");
      $("campoFotoPies").hidden = true;
      actualizarContador(0);
      mostrarMensajeHoras("Elige primero la fecha.");
      mostrarDuracion();

      $("formBody").hidden = true;

      const exito = $("exito");
      exito.hidden = false;
      exito.focus();
    } catch {
      estado.textContent = "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.";
    } finally {
      botonEnviar.disabled = false;
      botonEnviar.textContent = "Solicitar cita";
    }
  });

  $("volver").addEventListener("click", () => {
    $("exito").hidden = true;
    $("formBody").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// galería
const visor = $("visor");
const listaFotos = $("galeriaLista");
let fotos = [];
let fotoActual = 0;

function mostrarFoto(indice) {
  fotoActual = (indice + fotos.length) % fotos.length;

  const grande = $("visorImg");

  grande.src = fotos[fotoActual].grande;
  grande.alt = fotos[fotoActual].descripcion;
  $("visorTxt").textContent = fotos[fotoActual].descripcion;

  // reinicia la animación
  grande.classList.remove("cambia");
  void grande.offsetWidth;
  grande.classList.add("cambia");
}

function abrirVisor(indice) {
  // sin <dialog>: se abre en otra pestaña
  if (typeof visor.showModal !== "function") {
    window.open(fotos[indice].grande, "_blank", "noopener,noreferrer");
    return;
  }

  mostrarFoto(indice);
  visor.showModal();
}

// createElement y textContent: nada de la BD se interpreta como HTML
function dibujarGaleria(lista) {
  fotos = lista.map((f) => ({
    grande: `/media/fotos/${f.id}/grande`,
    descripcion: f.descripcion
  }));

  listaFotos.replaceChildren();
  $("galeriaVacia").hidden = lista.length > 0;

  lista.forEach((f, indice) => {
    const item = document.createElement("li");
    const boton = document.createElement("button");
    const img = document.createElement("img");
    const lupa = document.createElement("span");

    // proporción limitada entre 3:4 y 4:3
    const forma = Math.min(Math.max(f.ancho / f.alto, 0.75), 1.3333);

    boton.type = "button";
    boton.className = "foto";
    boton.style.setProperty("--r", forma.toFixed(4));
    boton.setAttribute("aria-haspopup", "dialog");

    img.src = `/media/fotos/${f.id}/mini`;
    img.alt = f.descripcion;
    img.width = f.ancho;
    img.height = f.alto;
    img.loading = "lazy";
    img.decoding = "async";

    lupa.className = "foto__zoom";
    lupa.setAttribute("aria-hidden", "true");

    boton.append(img, lupa);
    boton.addEventListener("click", () => abrirVisor(indice));
    item.append(boton);
    listaFotos.append(item);

    if (revelar) revelar(item);
  });
}

if (listaFotos) {
  fetch("/api/fotos")
    .then((respuesta) => (respuesta.ok ? respuesta.json() : Promise.reject()))
    .then((datos) => dibujarGaleria(datos.fotos))
    .catch(() => {
      $("galeriaVacia").textContent = "No pudimos cargar la galería en este momento.";
      $("galeriaVacia").hidden = false;
    });
}

if (visor) {
  $("visorCerrar").addEventListener("click", () => visor.close());
  $("visorPrev").addEventListener("click", () => mostrarFoto(fotoActual - 1));
  $("visorNext").addEventListener("click", () => mostrarFoto(fotoActual + 1));

  // clic en el fondo cierra el visor
  visor.addEventListener("click", (evento) => {
    if (evento.target === visor) visor.close();
  });

  // las flechas cambian de foto
  visor.addEventListener("keydown", (evento) => {
    if (evento.key === "ArrowLeft") mostrarFoto(fotoActual - 1);
    if (evento.key === "ArrowRight") mostrarFoto(fotoActual + 1);
  });
}
