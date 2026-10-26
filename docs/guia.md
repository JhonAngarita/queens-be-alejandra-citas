# Guía de uso y publicación

Página web con reservas: cuando una clienta toma una hora, queda bloqueada para las demás.
Las citas quedan **pendientes** hasta que Alejandra las confirme. WhatsApp se abre con el mensaje
listo, pero **la clienta lo envía ella** (nada se envía automáticamente).

## Requisitos (Windows)
- Node.js 20 o superior (https://nodejs.org, versión LTS)
- PostgreSQL (ya lo tienes instalado)

## Pasos
1. Abre una terminal dentro de esta carpeta (en el Explorador: clic en la barra de dirección, escribe `cmd`, Enter).
2. `npm install`
3. `copy .env.example .env` y abre `.env` para poner la contraseña de tu PostgreSQL en `DB_PASSWORD`.
4. `npm run db:preparar`  (crea la base de datos y la tabla)
5. `npm start`
6. Abre http://localhost:3000 en el navegador (no abras index.html con doble clic).
7. `npm test` para correr las pruebas.

## Panel de Alejandra
1. Crea su usuario (una sola vez): `npm run admin:crear`. Te pide usuario y clave (mínimo 10 caracteres); la clave no se ve al escribirla ni queda guardada en ningún archivo. Si la olvida, se vuelve a correr el mismo comando y queda la clave nueva.
2. Entra a http://localhost:3000/admin
3. El panel tiene 3 secciones (barra de abajo):
   - **Citas:** pendientes, confirmadas, canceladas e historial. Confirma o cancela y abre WhatsApp con el mensaje listo (ella lo envía).
   - **Bloquear:** cierra un día, varios días (vacaciones) o unas horas (almuerzo, permisos). Si ya había citas en ese horario, se le avisa pero no se cancelan solas.
   - **Fotos:** sube y quita fotos de la galería. Se reducen y se les borra la ubicación y otros datos ocultos.
4. Con el panel abierto, avisa de las solicitudes nuevas (cada 30 segundos y al volver a la pestaña): banner, número en el menú y en el título de la pestaña, y vibración en el celular. No avisa con el panel cerrado.

## Avisos por Telegram (cuando llega una solicitud nueva)
Alejandra recibe en su celular un mensaje como: "Nueva solicitud de cita: lunes, 2 de noviembre, 2:00 p. m. · Semipermanente (solo manos)". No lleva el nombre ni el celular de la clienta. Si Telegram falla, la cita se guarda igual.

Configuración (una sola vez):
1. En Telegram, busca `@BotFather`, escríbele `/newbot`, elige un nombre y un usuario que termine en `bot`. Te entrega un **token** (una clave larga). Es secreto: quien lo tenga controla el bot. No lo publiques ni lo subas a GitHub.
2. Alejandra abre el bot en su Telegram, toca **Iniciar (Start)** y escribe "hola".
3. En tu `.env` agrega `TELEGRAM_BOT_TOKEN=el_token` y corre `npm run telegram:chat`. Te muestra el número de chat de Alejandra.
4. Agrega `TELEGRAM_CHAT_ID=ese_numero` al `.env`.
5. `npm run telegram:probar` envía un mensaje de prueba. Reinicia el servidor (`Ctrl + C` y `npm start`).
Si el token se filtra: en BotFather usa `/revoke` para cambiarlo.

## Galería inicial
Después de `npm run db:preparar`, corre una vez `npm run fotos:importar` para cargar las 5 fotos iniciales. Desde ahí todo se maneja en el panel.

## Copias de seguridad
- `npm run copia` crea un archivo en la carpeta `copias/` (citas, bloqueos, fotos y usuarios). Hazla seguido y guarda el archivo también fuera del computador (USB o nube privada). Tiene datos personales: nunca la subas a GitHub (la carpeta ya está en `.gitignore`).
- Para restaurar en una base de datos vacía: crea la base (por ejemplo `queens_restaurada`) y corre
  `psql -U postgres -d queens_restaurada -f copias/NOMBRE_DEL_ARCHIVO.sql`
  (en pgAdmin: clic derecho en la base → *Restore*).

## Cuando se publique en un hosting
En las variables de entorno del servidor (no en archivos): `NODE_ENV=production`, `TRUST_PROXY=1`, y `DATABASE_URL` (o los `DB_*`) con `DB_SSL=true` si la base de datos exige conexión cifrada. Ver el final de `.env.example`.

## Estructura
- `public/` lo que ve la clienta (HTML, CSS, JS, fotos)
- `src/reglas.js` horarios, duraciones y validaciones
- `src/routes/citas.js` la API de la clienta
- `src/routes/admin.js` y `src/auth.js` el panel y su login seguro
- `src/routes/fotos.js` la galería pública
- `public/admin/` la página del panel
- `scripts/crearAdmin.js` crea la usuaria del panel
- `src/avisos.js` y `scripts/telegram.js` los avisos por Telegram
- `scripts/copia.js` hace la copia de seguridad
- `scripts/importarFotos.js` carga las fotos iniciales (de `db/semilla/`, que no se sube a GitHub; si falta, las fotos se suben desde el panel)
- `db/schema.sql` tablas y la regla anti-cruce de horarios
- `tests/` pruebas

## Seguridad
- `.env` nunca se sube a GitHub (está en `.gitignore`).
- Consultas parametrizadas, validación en servidor, límite de solicitudes y cabeceras con helmet.
- El cruce de horarios lo impide la propia base de datos.

- Clave con scrypt, sesión en cookie httpOnly + SameSite=Strict, límite de intentos de login, rechazo de solicitudes de otros sitios.

- Fotos: se revisa el contenido real (no el nombre), máximo 15 MB y 40 fotos, solo JPG/PNG/WebP, y siempre se vuelven a guardar como JPEG.
- Un horario bloqueado lo rechaza también la base de datos.

Pendiente: política de privacidad (Ley 1581), publicación en internet con https, avisos con el panel cerrado (requiere publicar la página).

## Foto de referencia en la cita

Al pedir la cita, la clienta puede adjuntar una foto del diseño (una de manos y, con "manos y pies", otra de pies). Es opcional.

- La página la reduce en el celular; el servidor la revisa de nuevo, la endereza, la reduce a máximo 1280 px y la guarda como JPEG nuevo (así se pierden los datos ocultos, como la ubicación).
- Se guarda en la tabla `citas_fotos`, ligada a la cita. Si se borra la cita, se borra la foto.
- A Alejandra le llega por Telegram justo después del aviso, y también la ve en el panel dentro de la cita.
- Para no llenar la base de datos, las fotos se borran 30 días después de la cita y las citas a los 12 meses. Corre de vez en cuando:

```
npm run datos:limpiar
```

- Cuando una clienta pida borrar sus datos: `npm run datos:borrar -- 3001234567`
- Hay que ejecutar `npm run db:preparar` una vez para crear la tabla nueva.

## Publicar gratis (Render + Neon)

Sirve para probar y para empezar con pocas clientas. El plan gratis de Render se duerme tras 15 minutos sin visitas (tarda ~1 minuto en despertar) y la base gratis de Neon guarda solo 6 horas de historial, así que hay que hacer copias (`npm run copia`) con frecuencia.

1. **Base de datos (Neon):** crear un proyecto en neon.com y copiar la "connection string". Con ella, desde tu PC (solo en esa terminal):
   ```
   $env:DATABASE_URL="la_connection_string"; $env:DB_SSL="true"
   npm run db:preparar
   npm run admin:crear
   ```
2. **Servidor (Render):** New > Web Service, conectar este repositorio. Build `npm install`, Start `npm start`, plan Free, Health Check Path `/api/vivo`.
3. **Variables en Render:** `NODE_ENV=production`, `TRUST_PROXY=1`, `DB_SSL=true`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` y `PUBLIC_URL` (la dirección que dé Render).
4. **Que no se duerma:** un monitor gratis (UptimeRobot) que visite `https://TU-APP.onrender.com/api/vivo` cada 5 minutos. Ese endpoint no usa la base de datos, así Neon sí puede suspenderse y no gasta sus horas gratis.
5. **Copias:** con `DATABASE_URL` puesto en la terminal, `npm run copia` guarda la base de producción en `copias/`.
