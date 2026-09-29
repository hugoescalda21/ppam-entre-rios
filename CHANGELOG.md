# Registro de cambios — PPAM Entre Ríos

## Mis turnos más completa — 29 sep 2026 (caché ppam-v9)

- Resumen del mes (turnos, horas y por confirmar), secciones Hoy · Próximos · Realizados y hojita de calendario en cada turno, con la miniatura de la foto del lugar si tiene.
- Se mantienen el nombre completo con la ciudad y los botones Cómo llegar, Detalle y Cancelar.
- Corregido: un turno de hoy que ya terminó pasa solo a "Realizados" con "✓ Hecho".
- Agradecimiento por los turnos hechos en el mes y botón "Anotarme en otro turno".
- Cancelar pide confirmación con una explicación clara. 78 pruebas de la página.

## Detalles del rediseño — 29 sep 2026 (caché ppam-v8)

- Sin emojis: íconos de línea en la configuración de puntos (carrito, stand, ubicación, fotos), en "Estoy acá", "Buscar en el mapa", "Pegar link", en los botones de WhatsApp y en el buscador del mapa.
- Administración con el mismo estilo: cada campaña con sus botones abajo, sin textos apretados.
- 74 pruebas de la página.

## Rediseño premium — 29 sep 2026 (caché ppam-v7)

- Diseño nuevo desde cero: fondo marfil, verde petróleo con detalle dorado, letra Inter, íconos de línea y barra fija abajo (Inicio · Mis turnos · Coordinar).
- Inicio según cada caso: bienvenida con lugares libres de la semana (sin sesión o sin turnos), tu próximo turno como un pase (esperando confirmación, confirmado, "Hoy · en 1 h 20" con Cómo llegar grande), "Tenés N turnos más" y, para coordinadores, la franja de pedidos por confirmar.
- Campaña: la foto como encabezado, calendario con barra de cobertura por día, turnos agrupados por punto con lugares en cuadraditos y el botón "Anotarme".
- Anotarse: resumen (día, horario, lugar y lugares que quedan) y un solo botón.
- Nueva pantalla "Tu turno": mapa, estado paso a paso (Pedido, Confirmado, El día) y acciones Llegar, Agendar (archivo de calendario con aviso 1 h antes), Compartir y Cancelar.
- Coordinación: números clave, pedidos como tarjetas con WhatsApp directo y botones Confirmar / No confirmar.
- Se quitaron los momentos del día del encabezado. 74 pruebas de la página.

## Vuelta al diseño original (azul) — 29 sep 2026 (caché ppam-v6)

- Vuelve el diseño azul de la primera versión (encabezado azul marino, fondo gris azulado, acento azul, letra del sistema), sin perder nada de lo agregado: fotos, ubicación, "Ver lugar", "Cómo llegar", el mapa para marcar puntos y la cobertura.
- Los cuatro momentos del día pasan a tonos azules: amanecer celeste rosado, día azul marino (el original), atardecer violeta anaranjado y noche con luna y ventanas.
- Corregidos los detalles del azul: el título ya no se monta sobre "Iniciar sesión" y los turnos no se parten en tres renglones.

## Momentos del día — 29 sep 2026 (caché ppam-v5)

- El encabezado cambia con la hora: amanecer (durazno), día (terracota), atardecer (rojo y violeta) y noche (azul, con luna, estrellas y ventanas encendidas). El sol recorre el cielo de derecha a izquierda.
- Los horarios siguen la salida y la puesta del sol reales en Entre Ríos (se calculan en el celular, sin internet) y se actualizan solos cada 5 minutos. También cambia el color de la barra del navegador.
- La campaña con foto o color propio queda igual. 74 pruebas de la página.

## Marcar el punto en el mapa — 29 sep 2026 (caché ppam-v4)

- Al editar un punto hay un mapa (Leaflet + OpenStreetMap): se toca donde va el carrito o el stand y el pin se puede arrastrar. Arranca en la ciudad de la campaña o en otro punto ya marcado.
- "Buscar en el mapa": pantalla completa con buscador de lugares y direcciones de Entre Ríos (Nominatim, gratis).
- La dirección escrita se completa sola al marcar el punto (y se puede corregir). "Estoy acá" (GPS) y "Pegar link" siguen disponibles.
- 68 pruebas de la página.

## Diseño cálido, fotos y ubicación — 29 sep 2026 (caché ppam-v3)

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
