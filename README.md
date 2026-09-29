# PPAM Entre Ríos

Página para las campañas de **predicación pública metropolitana** de Entre Ríos: cualquiera mira
las campañas, los puntos (carritos y stands) y los horarios; para pedir un turno se inicia sesión
con Google y se dejan nombre, apellido, congregación y celular. Los coordinadores de cada campaña
confirman los pedidos, ven qué turnos faltan cubrir y comparten las listas por WhatsApp.

## Partes

| Archivo | Qué es |
|---|---|
| `index.html`, `app.js`, `app.css` | La página (una sola app: publicadores, coordinadores y administración). |
| `firebase-config.js` | Los datos del proyecto de Firebase (no son secretos). |
| `service-worker.js`, `manifest.json`, `icon-*.png` | Para instalarla en el celular. |
| `firebase/firestore.rules` | Reglas de seguridad: quién ve y cambia qué. |
| `firebase/pruebas-reglas/` | Pruebas de esas reglas con el emulador (`npm install` una vez, `npm test`). |
| `tests/app.test.js` | Pruebas de la página con un Firestore simulado (`node tests/app.test.js`). |

## Roles

- **Administrador técnico:** hugoescalda@gmail.com (fijo en las reglas, para no quedar nunca afuera).
- **Administradores:** crean campañas, eligen coordinadores y cargan la lista de congregaciones (Coordinación → Administración).
- **Coordinadores:** configuran su campaña (puntos, turnos), confirman pedidos, ven la cobertura y comparten listas.
- **Publicadores:** miran libremente; con sesión piden turnos y ven "Mis turnos".

## Datos (Firestore)

- `campanas/{id}`: nombre, ciudad, fechas, puntos (tipo y cupo) y turnos (horario y días). Público.
- `cupos/{campaña}__{fecha}__{turno}`: quién ocupa cada lugar, solo con el id de la cuenta (sin datos personales). Público.
- `pedidos/{…}__{uid}`: nombre, apellido, congregación y celular. Solo los ven quien pidió y los coordinadores de esa campaña.
- `coordinadores/{id}`, `roles/{email}`, `config/admins`, `config/publico` (lista de congregaciones).

## Publicar

- Página: GitHub Pages (rama `main`, carpeta raíz).
- Reglas: desde `firebase/`, primero `cd pruebas-reglas && npm test`, después `firebase deploy --only firestore:rules`.
