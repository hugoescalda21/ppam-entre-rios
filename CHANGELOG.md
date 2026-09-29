# Registro de cambios — PPAM Entre Ríos

## Diseño cálido, fotos y ubicación — 29 sep 2026 (caché ppam-v2)

- Nuevo diseño "Cálido" (terracota, verde y crema, títulos con letra de revista), también en modo oscuro. Arreglado el título que se montaba sobre "Iniciar sesión" en celulares angostos.
- Inicio: cada campaña con su foto de portada (o su color con la ilustración) y cuántos lugares faltan cubrir en la primera semana.
- Campaña: la portada como banner; los días marcan si hay lugar, quedan pocos o está completo; los turnos se agrupan por punto.
- Cada punto puede tener dirección, ubicación en el mapa ("Usar mi ubicación actual" o pegando el link de Google Maps), hasta 3 fotos, "Cómo encontrarlo" y "Retiro del carrito/stand".
- "Ver lugar": fotos, mapa (OpenStreetMap), "Cómo llegar" (abre Google Maps con el recorrido) y "Copiar dirección". "Mis turnos" muestra el turno con su foto y "Cómo llegar".
- Las fotos se achican en el celular antes de subirse y se guardan en `fotos/` (sin plan Blaze). Reglas nuevas para `fotos/`: 53 pruebas de reglas; la página con 61 pruebas.

## Etapa A — 29 sep 2026 (caché ppam-v1)

- Campañas por ciudad, con sus puntos (carrito, stand u otro, con cupo por turno) y turnos que se repiten en los días marcados entre las fechas de la campaña.
- Publicadores: miran sin iniciar sesión; para pedir un turno inician sesión con Google y dejan nombre, apellido, congregación y celular (con aceptación del uso de los datos). "Mis turnos" con estado (pendiente, confirmado) y cancelar.
- Coordinadores: pedidos por confirmar (con WhatsApp directo), cobertura por punto y día, "Pedir voluntarios" y "Lista del día" por WhatsApp, y configurar la campaña (puntos, turnos en serie).
- Administración: crear campañas, nombrar coordinadores, lista de congregaciones y administradores.
- Reglas de seguridad con 41 pruebas en el emulador; la página con 38 pruebas.
