# Registro de cambios — PPAM Entre Ríos

## "+ Turno" desde el hermano, varios turnos y con quién va — 13 oct 2026 (caché ppam-v27)

- Lupa: cada hermano tiene "+ Turno": lista de lugares libres por día y carrito; se pueden marcar varios. Reusa sus datos (mismo id si ya fue cargado por coordinador).
- Un solo aviso por WhatsApp con la lista de turnos. "Anotarlo en otro turno" después de cualquier anotación.
- "+ Anotar" en el atajo "Faltan hoy / mañana" de la lupa.
- Con quién va: cada lugar libre dice quién ya está ("Con: …"), y el formulario de anotar muestra "Ya va: …"; si coincide el apellido se marca "mismo apellido".
- Versión 25. 198 pruebas de la página.

## Anotar más rápido: hermanos conocidos — 13 oct 2026 (caché ppam-v26)

- Al anotar a un hermano, escribiendo 2 letras aparecen los que ya se anotaron en las campañas que coordina (con congregación y celular); un toque completa todo.
- Después de anotar (y del aviso por WhatsApp), queda en "Del día" en ese turno, resaltado.
- Versión 24. 189 pruebas de la página.

## El coordinador anota a un hermano — 13 oct 2026 (caché ppam-v25)

- Coordinación › Del día: "+ Anotar" en cada lugar libre, para quien no puede usar la app. Nombre, apellido, congregación, celular (opcional) y nota; queda confirmado y marcado "cargado por coordinador".
- Al guardar: "Avisarle por WhatsApp" con el día, horario, punto y cómo llegar (o "Copiar el mensaje" si no tiene celular).
- Reglas: el coordinador de esa campaña puede crear un pedido de otra persona (uid "m-…", confirmado, manual, con su email en "por"). 11 pruebas de reglas nuevas.
- Versión 23. 185 pruebas de la página.

## Lupa de coordinación — 13 oct 2026 (caché ppam-v24)

- Lupa arriba, al lado del avatar, en todas las pantallas (solo coordinadores y administradores). Busca en las campañas que coordina: hermanos (nombre o celular, con sus turnos y WhatsApp), campañas, puntos y turnos por hora ("8:30") o día ("sábado", "mañana").
- Atajos antes de escribir: Por confirmar, Faltan hoy, Faltan mañana; y las últimas búsquedas.
- Tocar un turno abre "Del día" en ese turno, resaltado; tocar un punto lo abre en Ajustes.
- Se saca el buscador de arriba de las pestañas (lo reemplaza la lupa). Sin cambios en las reglas.
- Versión 22. 179 pruebas de la página.

## Coordinación: buscar un hermano — 13 oct 2026 (caché ppam-v23)

- Buscador arriba de las pestañas ("nombre o celular", sin tildes): muestra cada hermano con su congregación, celular, WhatsApp y todos sus turnos de la campaña con su estado. Tocar un turno abre "Del día" en ese turno.
- Versión 21. 172 pruebas de la página.

## Coordinación: quiénes van en cada carrito — 13 oct 2026 (caché ppam-v22)

- "Del día" agrupado por punto: cada horario muestra quiénes van (✓ confirmados; por confirmar con Confirmar / No ahí mismo y su nota), WhatsApp de cada uno, y cuántos lugares quedan.
- Resumen del día ("10 confirmados · 3 por confirmar · faltan 13") y filtro **Todos | Faltan**.
- Cobertura: tocar una casilla abre ese día y turno en "Del día", resaltado.
- Versión 20. 169 pruebas de la página.

## Ajustes ordenados por punto y días de la campaña — 13 oct 2026 (caché ppam-v21)

- Coordinación > Ajustes en dos pestañas: **Campaña** (portada, nombre, fechas, visibilidad) y **Puntos y turnos** (se abre primero).
- Cada punto es una tarjeta con sus turnos adentro (como botones; los días se dicen una vez si son iguales), su estado en el mapa y sus avisos.
- "+ Turno" en cada punto: viene con ese punto elegido y propone el horario siguiente al último, con los mismos días.
- "Copiar los horarios de otro punto" en los puntos sin turnos.
- Campañas de menos de una semana: al crear o editar un turno se ven solo los días que tiene la campaña, con su fecha ("Vie 6, Sáb 7"). Si un turno tiene días fuera (por ejemplo, porque se acortaron las fechas), se avisa en su punto y al guardarlo se quitan. Al copiar horarios no se copian esos días.
- Versión 19. 166 pruebas de la página.

## Día de campaña más corto y aviso de turno repetido — 13 oct 2026 (caché ppam-v20)

- Al elegir un día, arriba se ve el resumen ("4 carritos · 16 lugares libres") y un filtro **Todos | Con lugar** que oculta los horarios completos.
- Cada carrito o stand es una tarjeta con sus horarios como botones, uno al lado del otro: verde hay lugar, dorado falta poco, gris completo, oscuro tu turno. Los puntitos muestran confirmados y pedidos. Tocar un horario abre el formulario de siempre.
- Tocando el nombre del carrito se pliega y queda solo con cuántos lugares le quedan.
- Coordinación > Ajustes: aviso cuando un punto tiene dos turnos con el mismo horario y día, y los marca como "Repetido".
- Versión 18. 157 pruebas de la página.

## Foto de cada carrito en el mapa y actualización al instante — 13 oct 2026 (caché ppam-v19)

- Al tocar un carrito o stand en el mapa se muestra **su** foto (la primera de las que cargó el coordinador; si no tiene, la portada de la campaña), su nombre, el tipo y la dirección, con **Ver lugar** (todas sus fotos, mapa y "Cómo llegar") y **Ver turnos**.
- Los carritos de la campaña elegida se pueden tocar uno por uno; reemplazan al pin de la campaña.
- Actualización: la página pregunta siempre al servidor si hay algo nuevo y, cuando llega una versión, se recarga sola una vez. Ya no hay que esperar ni cerrar la app.
- Versión 17. 151 pruebas de la página.

## Mapa: arranca sobre las campañas y más limpio — 13 oct 2026 (caché ppam-v17)

- El mapa arranca encuadrado sobre las campañas (sus puntos), no sobre toda la provincia; si se filtra por ciudad, se vuelve a encuadrar. El botón de encuadrar vuelve a mostrar todas.
- Botones chicos y redondos abajo a la derecha (+, −, Cerca mío, Ver todas), que se esconden cuando sube la tarjeta de una campaña. La leyenda de colores pasa debajo del mapa, con "Tocá un pin para ver la campaña".
- En modo Mapa no se muestra la tarjeta "Sumate a un turno / ¿Te sumás esta semana?": el mapa queda arriba y más alto. "Tu próximo turno" y la franja de Coordinación siguen.
- Versión 16. 150 pruebas de la página.

## Los carritos de la campaña en el mapa — 13 oct 2026 (caché ppam-v16)

- Al tocar una campaña en el mapa se ven también sus puntos (carritos y stands) con su nombre, y el mapa se encuadra sobre ellos.
- Si la campaña tiene puntos sin marcar en el mapa, la tarjeta lo dice ("Los puntos de esta campaña todavía no están marcados en el mapa: aparece en el centro de Crespo").
- Coordinación → Ajustes → Puntos: cada punto dice "Marcado en el mapa", "Con dirección, sin marcar en el mapa" o "Sin marcar en el mapa", y arriba un aviso con cuántos faltan y cómo marcarlos.
- Versión 15. 146 pruebas de la página.

## Mapa con zoom real y calles — 13 oct 2026 (caché ppam-v15)

- El mapa del Inicio pasa a ser un mapa real (Leaflet + OpenStreetMap, el mismo de "Ver lugar"), con Entre Ríos resaltada y lo de afuera velado.
- **Zoom de verdad**: pellizcar, doble toque o los botones + / −; se arrastra. "Todo" vuelve a la provincia.
- **Nombres en los pines**: de lejos, la localidad ("Paraná · 3"); al acercarse, el nombre de cada campaña; muy de cerca, un pin por punto (carrito o stand) con su nombre.
- Tocar un grupo acerca hasta separarlo. Tocar una campaña o un punto: onda dorada, el pin se vuelve su foto de portada y sube la tarjeta con "Ver turnos" (la página se acomoda para que se vea).
- El mapa se arma una sola vez: al volver al Inicio o cuando se actualizan los datos no se pierde el zoom.
- "Cerca mío", el interruptor de Administración y "Sin ubicación en el mapa" siguen igual.
- La demo sigue en `demo-mapa.html` (página aparte, no la usa la app).
- Versión 14. 144 pruebas de la página.

## Mapa de Entre Ríos en el Inicio — 13 oct 2026 (caché ppam-v14)

- Debajo de "Campañas", **Lista | Mapa**. La lista sigue siendo lo primero; la página recuerda lo que eligió cada uno. El filtro por ciudad funciona en los dos.
- El mapa lo dibuja la página (contorno de Entre Ríos y sus departamentos en `mapa-er.js`, que se carga recién al abrir el mapa): no usa mapas de internet ni gasta lecturas.
- Un pin por ciudad con campañas: verde si hay lugar esta semana, dorado si quedan pocos, gris si está completo; con el número si hay más de una. La ubicación sale de los puntos marcados; si no hay, del centro de la ciudad.
- Al tocar un pin: onda dorada, el pin se vuelve las fotos de portada de sus campañas, el mapa se acerca y sube una tarjeta con cada campaña, cuántos lugares faltan y "Ver turnos". Tocando fuera vuelve. Sin animaciones si el celular tiene "reducir movimiento".
- **"Cerca mío"**: con permiso del GPS, marca dónde está y abre la ciudad más cercana.
- Las campañas que no se pueden ubicar aparecen debajo del mapa ("Sin ubicación en el mapa").
- Administración → Inicio: **"Mostrar el mapa en el Inicio"** (prendido). Si se apaga, todos ven solo la lista.
- Versión 13. 140 pruebas de la página.

## Logo del encabezado igual al ícono — 13 oct 2026 (caché ppam-v13)

- El logo de arriba a la izquierda pasa del pin de ubicación a "PPAM" con la línea dorada, igual que el ícono de la app.
- **Vista previa al compartir el enlace** (WhatsApp, Facebook, Telegram): imagen con el logo y "Sumate a un turno", título y descripción (`og-image.jpg`).

## Ícono nuevo e "Instalá la app" — 13 oct 2026 (caché ppam-v12)

- **Ícono nuevo** con los colores de la página: "PPAM" en marfil, línea dorada y "ENTRE RÍOS" sobre verde petróleo. Versión adaptable para Android (no se recorta en círculo), ícono propio de iPhone (180 px) y uno simplificado para la pestaña del navegador.
- **"Instalá la app PPAM"** arriba del Inicio: en Android abre el aviso del celular y queda instalada con un toque; en iPhone muestra los dos pasos (Compartir → Agregar a inicio). No aparece si ya está instalada ni en computadoras. La ✕ lo cierra por 30 días; "No mostrar más" o instalarla, para siempre.
- "Instalar la app" también en el menú de la cuenta.
- Versión 12. 128 pruebas de la página.

## Reportar un problema y equipo de soporte — 13 oct 2026 (caché ppam-v11)

- Al pie de todas las pantallas: **"Reportar un problema"** y la **versión** de la página (Versión 11).
- El reporte: se elige qué pasó (No me deja anotarme, No carga, Un dato está mal, No veo un botón, Otro), se cuenta con palabras propias y, si quiere, deja su celular. La página agrega sola la pantalla, el celular y navegador, la versión y el último error. Funciona sin haber iniciado sesión; con sesión lleva su cuenta y su nombre para responderle. Hasta 5 reportes por día por celular.
- **Errores automáticos**: cuando algo falla (un error de la página o un aviso "No se pudo…"), se anota el mensaje, la pantalla, el celular y la versión, sin datos personales. Hasta 30 por día por celular.
- **Rol Soporte** (Administración → Equipo de soporte): ve "Reportes y errores" desde Coordinar; no cambia campañas ni ve los pedidos. Los administradores lo ven arriba de Administración.
- "Reportes y errores": resumen de los errores de las últimas 24 h (los más repetidos y dónde), "Ver detalle", y los reportes en Nuevos, Vistos y Resueltos, con WhatsApp o Email a quien reportó, "Marcar visto", "Resuelto" y "Volver a abrir".
- Limpieza sola: los reportes resueltos hace más de 60 días y los errores de más de 30 se borran al abrir la sección.
- "Cómo se usan tus datos" explica los reportes y los errores.
- Reglas nuevas (`reportes`, `errores`, `config/soporte`): hay que publicarlas con `firebase deploy --only firestore:rules`.
- 118 pruebas de la página; 22 pruebas nuevas de reglas.

## Nota para el coordinador — 12 oct 2026 (caché ppam-v10)

- Al pedir un turno hay una **nota opcional para el coordinador** (hasta 200 letras), con atajos de un toque: "Voy con mi esposa/o", "Puedo llevar el carrito", "Es mi primera vez" y "Llego unos minutos tarde" (se tocan de nuevo para sacarlos).
- El coordinador la ve en el pedido (recuadro amarillo, antes de Confirmar) y en la lista del día, debajo del turno. No va en la lista que se comparte por WhatsApp.
- Es privada como el celular: se guarda solo en el pedido y se borra si se cancela el turno. No queda guardada para el próximo pedido.
- En "Tu turno" se puede agregar, cambiar o borrar.
- Reglas: el pedido acepta `nota` (texto de 1 a 200 letras) y quien pidió puede cambiar solo su nota. Hay que publicarlas: desde `firebase/`, `firebase deploy --only firestore:rules`.
- 93 pruebas de la página.

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
