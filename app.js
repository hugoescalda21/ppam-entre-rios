/* =====================================================================
   PPAM Entre Ríos — campañas de predicación pública metropolitana
   ---------------------------------------------------------------------
   Datos (Firestore):
     campanas/{cid}        nombre, ciudad, lugar, desde, hasta, activa, portada (id de foto),
                           puntos {pid: {nombre, tipo, cupo, detalle, direccion, lat, lng, mapsUrl,
                                         indicaciones, retiro, fotos [ids]}},
                           turnos {tid: {punto, desde, hasta, dias[0-6]}}   ← público
     cupos/{cid}__{fecha}__{tid}   {cid, fecha, tid, ocupados {uid: 'p'|'c'}}  ← público, sin datos personales
     pedidos/{cid}__{fecha}__{tid}__{uid}   datos de quien pide (solo lo ven él y los coordinadores)
     coordinadores/{cid}   {emails}          roles/{email}  {campanas: [cid]}
     config/publico        {congregaciones: ['Nombre (Ciudad)'], ciudades: [...]}
     config/admins         {emails}
     fotos/{cid}__{id}     {cid, data (imagen JPEG achicada, data:…), creado}   ← público
   Mirar es libre; para pedir un turno hay que iniciar sesión con Google.
   ===================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const DOW_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const TIPOS = { carrito: ['cart', 'Carrito'], stand: ['stand', 'Stand'], otro: ['pin', 'Punto'] };
  const COLORES = ['linear-gradient(160deg,#1C5C56,#0F3A36)', 'linear-gradient(160deg,#5E7F8C,#34505C)', 'linear-gradient(160deg,#C2A060,#8A6A2E)', 'linear-gradient(160deg,#7C8C62,#4E5E3C)', 'linear-gradient(160deg,#86677A,#5A3F50)', 'linear-gradient(160deg,#557593,#2F4B66)'];

  /* ---------- Fechas (hora local del celular) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hoy = () => isoOf(new Date());
  const parseIso = (s) => new Date(s + 'T12:00:00');
  const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return isoOf(d); };
  const dowOf = (s) => parseIso(s).getDay();
  const fmtDia = (s) => { const d = parseIso(s); return `${DOW_L[d.getDay()]} ${d.getDate()} de ${MES[d.getMonth()]}`; };
  const fmtCorto = (s) => { const d = parseIso(s); return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
  const fmtHora = (h) => String(h || '').replace(/^0(\d)/, '$1').replace(/:00$/, '');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const I = (n, st) => `<svg class="ic"${st ? ` style="${st}"` : ''} aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const iniciales = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map(x => x.charAt(0).toUpperCase()).join('') || '·';

  /* ---------- Estado ---------- */
  const S = {
    db: null, auth: null, user: null, isAdmin: false, coordDe: [],
    campanas: {}, loaded: false, publico: { congregaciones: [], ciudades: [] },
    ciudad: 'todas', route: { name: 'home' }, dia: null,
    cc: {}, ccUnsub: {}, fotos: {},
    mis: {}, misUnsub: null,
    coord: { cid: null, tab: 'pedidos', pedidos: {}, cupos: {}, unsub: [] , semana: null },
    admins: [], coordEmails: {}, pend: {}, pendUnsub: {},
    isSoporte: false, soporteEmails: [], sop: { reportes: {}, errores: {}, unsub: [], filtro: 'nuevo', detalle: false, limpio: false }, ultimoError: null
  };
  const VERSION = '41';
  window.__ppam = S;   // para las pruebas

  function toast(msg) { if (/^No se pudo/.test(msg)) registrarError('aviso', msg); const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
  // Datos del formulario recordados en este celular, separados por cuenta (en un celular compartido nadie ve los del otro)
  const perfilKey = () => (S.user ? 'ppam-perfil:' + S.user.uid : '');
  try { localStorage.removeItem('ppam-perfil'); } catch (e) { /* el formato viejo no sabía de quién era: se descarta */ }
  function perfil() { const k = perfilKey(); if (!k) return {}; try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } }
  function guardarPerfil(p) { const k = perfilKey(); if (!k) return; try { localStorage.setItem(k, JSON.stringify(p)); } catch (e) { /* nada */ } }
  // Cerrar sesión también borra la copia local de Firebase (pedidos con nombres y celulares que vio un coordinador).
  async function cerrarSesion() {
    try { localStorage.removeItem('ppam-bus-rec'); } catch (e) { /* nada */ }
    await S.auth.signOut();
    if (window.__ppamMock) { go('#/'); return; }
    try { await S.db.terminate(); await S.db.clearPersistence(); } catch (e) { /* otra pestaña abierta: se borra la próxima vez */ }
    location.replace(location.pathname + '#/'); location.reload();
  }
  function borrarDatosLocales() { try { Object.keys(localStorage).filter(k => k.startsWith('ppam-perfil') || k === 'ppam-bus-rec').forEach(k => localStorage.removeItem(k)); } catch (e) { /* nada */ } }

  /* ---------- Firebase ---------- */
  function init() {
    if (window.__ppamMock) { S.db = window.__ppamMock.db; S.auth = window.__ppamMock.auth; }
    else {
      if (!window.PPAM_FIREBASE || !window.PPAM_FIREBASE.apiKey) { $('app').innerHTML = '<div class="empty">Falta configurar Firebase (firebase-config.js).</div>'; return; }
      firebase.initializeApp(window.PPAM_FIREBASE);
      // App Check: solo la app de verdad puede escribir (se activa cuando firebase-config.js trae appCheckKey)
      if (window.PPAM_FIREBASE.appCheckKey && firebase.appCheck) { try { firebase.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(window.PPAM_FIREBASE.appCheckKey), true); } catch (e) { console.error('App Check', e); } }
      S.db = firebase.firestore(); S.auth = firebase.auth();
    }
    // Copia local de lo leído: abre más rápido, se ve sin señal y al volver pide solo lo que cambió (menos lecturas)
    try { if (S.db.enablePersistence) S.db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) { /* navegador sin soporte */ }
    S.db.collection('campanas').onSnapshot((qs) => {
      const o = {}; qs.forEach(d => { o[d.id] = Object.assign({ id: d.id }, d.data()); }); S.campanas = o; const primera = !S.loaded; S.loaded = true; window.__ppamOk = true; $('app').removeAttribute('aria-busy'); if (primera) { render(); setTimeout(() => { if (S.route.name === 'home') bienvenida(); }, 400); } else refrescar(render);
    }, (e) => { console.error(e); if (S.loaded) return; window.__ppamOk = true; $('app').removeAttribute('aria-busy'); $('app').innerHTML = '<div class="empty carga-err"><b>No pudimos cargar las campañas.</b><br>Revisá la conexión y probá de nuevo.</div><button type="button" class="btn" id="reintentar">Reintentar</button>'; $('reintentar').addEventListener('click', () => location.reload()); });
    S.db.doc('config/publico').onSnapshot((d) => { S.publico = Object.assign({ congregaciones: [], ciudades: [] }, d.exists ? d.data() : {}); if (S.route.name === 'admin' || (S.route.name === 'home' && S.loaded)) render(); }, () => {});
    S.auth.onAuthStateChanged(onUser);
    setInterval(() => { if (S.route.name === 'home') renderHome(); }, 60000);
    window.addEventListener('hashchange', () => { S.sucio = false; S.pendRender = false; readRoute(); if (S.route.name !== 'coord' && S.coord.unsub.length) { S.coord.unsub.forEach(f => f()); S.coord.unsub = []; S.coord.cid = null; S.coord.pedidos = {}; S.coord.cupos = {}; S.coord.aud = {}; } render(); });
    readRoute();
  }
  async function onUser(u) {
    S.user = u || null; S.isAdmin = false; S.coordDe = []; S.isSoporte = false;
    S.sop.unsub.forEach(f => f()); S.sop.unsub = []; S.sop.on = false; S.sop.okR = S.sop.okE = false; S.sop.reportes = {}; S.sop.errores = {};
    if (S.misUnsub) { S.misUnsub(); S.misUnsub = null; } S.mis = {};
    // lo que vio la cuenta anterior no queda en memoria
    S.coord.unsub.forEach(f => f()); S.coord.unsub = []; S.coord.cid = null; S.coord.pedidos = {}; S.coord.cupos = {}; S.coord.aud = {};
    Object.keys(S.pendUnsub).forEach(k => { if (typeof S.pendUnsub[k] === 'function') S.pendUnsub[k](); }); S.pendUnsub = {}; S.pend = {};
    S.bus = { t: 0, peds: {}, cupos: {}, cargando: null };
    if (u) {
      S.misUnsub = S.db.collection('pedidos').where('uid', '==', u.uid).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.mis = o; S.misErr = false; refrescar(render); }, (e) => { console.error(e); registrarError('aviso', 'Mis turnos: ' + (e.code || e.message || e)); S.misErr = true; if (S.route.name === 'mis' || S.route.name === 'home') render(); });
      try { const r = await S.db.doc('roles/' + u.email.toLowerCase()).get(); S.coordDe = (r.exists && r.data().campanas) || []; } catch (e) { /* sin rol */ }
      try { const a = await S.db.doc('config/admins').get(); S.isAdmin = true; S.admins = (a.exists && a.data().emails) || []; } catch (e) { S.isAdmin = false; }
      try { const so = await S.db.doc('config/soporte').get(); S.soporteEmails = (so.exists && so.data().emails) || []; S.isSoporte = S.soporteEmails.includes(u.email.toLowerCase()); } catch (e) { S.isSoporte = false; }
    }
    renderTop(); render();
  }
  async function login() {
    if (window.__ppamMock) return window.__ppamMock.login();
    const prov = new firebase.auth.GoogleAuthProvider();
    try { await S.auth.signInWithPopup(prov); }
    catch (e) {
      const code = (e && e.code) || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return;   // la persona cerró la ventana: se queda donde estaba
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') { await S.auth.signInWithRedirect(prov); return; }
      toast('No se pudo iniciar sesión. Probá de nuevo.');
    }
  }

  /* ---------- Rutas: #/ · #/c/{cid} · #/t/{pedido} · #/mis · #/coord/{cid} · #/admin ---------- */
  function readRoute() {
    const h = (location.hash || '#/').slice(1).split('/').filter(Boolean);
    if (h[0] === 'c' && h[1]) S.route = h[2] && h[3] ? { name: 'camp', cid: h[1], fecha: h[2], tid: decodeURIComponent(h[3]) } : { name: 'camp', cid: h[1] };
    else if (h[0] === 't' && h[1]) S.route = { name: 'turno', pid: decodeURIComponent(h[1]) };
    else if (h[0] === 'mis') S.route = { name: 'mis' };
    else if (h[0] === 'coord') S.route = { name: 'coord', cid: h[1] || null };
    else if (h[0] === 'admin') S.route = { name: 'admin' };
    else if (h[0] === 'soporte') S.route = { name: 'soporte' };
    else if (h[0] === 'ayuda') S.route = { name: 'ayuda', q: h[1] || '' };
    else S.route = { name: 'home' };
    window.scrollTo(0, 0);
  }
  const go = (h) => { if (location.hash === h) { readRoute(); render(); } else location.hash = h; };

  function renderTop() {
    const r = S.route, c = r.cid && S.campanas[r.cid];
    document.body.className = 'r-' + r.name;
    const esCoord = !!(S.user && (S.isAdmin || S.coordDe.length || S.isSoporte));
    const atras = r.name === 'camp' || r.name === 'turno' || r.name === 'ayuda' || r.name === 'admin' || (r.name === 'soporte' && (S.isAdmin || S.coordDe.length)) || (r.name === 'coord' && r.cid && (S.isAdmin || S.coordDe.length > 1));
    $('backBtn').classList.toggle('hidden', !atras);
    $('brand').classList.toggle('hidden', r.name !== 'home' && S.loaded);
    $('shareBtn').classList.toggle('hidden', r.name !== 'camp' || !c);
    const ub = $('userBtn');
    ub.className = S.user ? 'av' : 'login';
    ub.textContent = S.user ? iniciales(S.user.displayName || S.user.email) : 'Ingresar';
    ub.setAttribute('aria-label', S.user ? 'Mi cuenta' : 'Ingresar');
    $('coordBtn').classList.toggle('hidden', !esCoord);
    $('busBtn').classList.toggle('hidden', !S.user);
    [['tabHome', ['home', 'camp']], ['tabMis', ['mis', 'turno']], ['tabAyuda', ['ayuda']], ['coordBtn', ['coord', 'admin', 'soporte']]].forEach(([id, rs]) => $(id).classList.toggle('on', rs.includes(r.name)));
    let k = '', t = '', s = '';
    if (r.name === 'camp' && c) { k = c.ciudad || ''; t = c.nombre; s = campRango(c); }
    else if (r.name === 'mis') { t = 'Mis turnos'; s = 'Tus turnos, su estado y cómo llegar.'; }
    else if (r.name === 'turno') { t = 'Tu turno'; }
    else if (r.name === 'coord') { k = 'Coordinación'; t = c ? c.nombre : 'Tus campañas'; s = c ? (c.ciudad || '') + ' · ' + campRango(c) : ''; }
    else if (r.name === 'admin') { k = 'Administración'; t = 'Campañas y equipo'; }
    else if (r.name === 'ayuda') { k = 'Ayuda'; t = 'Preguntas frecuentes'; s = 'Cómo anotarte, tus turnos y tus datos.'; }
    else if (r.name === 'soporte') { k = 'Soporte'; t = 'Reportes y errores'; s = 'Lo que avisan los hermanos y lo que la página anota sola.'; }
    $('tbKicker').textContent = k; $('tbTitle').textContent = t; $('tbSub').textContent = s;
    $('tbExtra').innerHTML = '';
    // En la campaña, la foto de portada (o su color) como encabezado grande
    const tb = $('tb'), fk = r.name === 'camp' && c && c.portada ? fotoKey(c.id, c.portada) : '';
    tb.dataset.foto = fk; tb.classList.remove('foto');
    tb.style.backgroundImage = r.name === 'camp' && c ? colorDe(c) : '';
    if (fk) { pedirFoto(fk); if (S.fotos[fk]) { tb.style.backgroundImage = `url("${S.fotos[fk]}")`; tb.classList.add('foto'); } }
  }
  function campRango(c) {
    if (!c.desde || !c.hasta) return c.lugar || '';
    const a = parseIso(c.desde), b = parseIso(c.hasta);
    const r = a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} de ${MES[b.getMonth()]}` : `${a.getDate()} de ${MES[a.getMonth()]} al ${b.getDate()} de ${MES[b.getMonth()]}`;
    return r + (c.lugar ? ' · ' + c.lugar : '');
  }
  function rangoCorto(c) {
    if (!c.desde || !c.hasta) return '';
    const a = parseIso(c.desde), b = parseIso(c.hasta), m = (d) => MES[d.getMonth()].slice(0, 3);
    return a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} ${m(b)}` : `${a.getDate()} ${m(a)} al ${b.getDate()} ${m(b)}`;
  }
  function colorDe(c) { const ids = Object.keys(S.campanas).sort(); return COLORES[Math.max(0, ids.indexOf(c.id)) % COLORES.length]; }

  /* ---------- Fotos: se guardan achicadas en fotos/{cid}__{id} y se piden una sola vez ---------- */
  const fotoKey = (cid, fid) => cid + '__' + fid;
  // Fotos: cada una tiene un id que no cambia nunca, así que se guardan en el celular y se bajan una sola vez
  const FOTOS_CACHE = 'ppam-fotos-1', fotoUrl = (k) => 'https://ppam.fotos/' + encodeURIComponent(k);
  async function fotoGuardada(k) { try { if (!window.caches) return ''; const c = await caches.open(FOTOS_CACHE), r = await c.match(fotoUrl(k)); return r ? await r.text() : ''; } catch (e) { return ''; } }
  function guardarFoto(k, u) { try { if (window.caches && u) caches.open(FOTOS_CACHE).then(c => c.put(fotoUrl(k), new Response(u))).catch(() => {}); } catch (e) { /* nada */ } }
  function pedirFoto(k) {
    if (k in S.fotos) return;
    S.fotos[k] = '';
    fotoGuardada(k).then((g) => {
      if (g) { S.fotos[k] = g; aplicarFoto(k); return; }
      S.db.doc('fotos/' + k).get().then((d) => { const u = (d.exists && d.data().data) || ''; S.fotos[k] = u; if (u) { aplicarFoto(k); guardarFoto(k, u); } }).catch(() => {});
    });
  }
  function aplicarFoto(k) {
    const u = S.fotos[k];
    document.querySelectorAll('[data-foto]').forEach((el) => { if (el.dataset.foto === k) { el.style.backgroundImage = `url("${u}")`; if (el.id === 'tb') el.classList.add('foto'); } });
  }
  // Atributos para un elemento que muestra una foto de fondo (se completa sola cuando llega).
  function fotoAttr(cid, fid, base) {
    if (!fid) return base ? ` style="${base}"` : '';
    const k = fotoKey(cid, fid); pedirFoto(k);
    const u = S.fotos[k];
    return ` data-foto="${esc(k)}" style="${base || ''}${u ? `background-image:url('${u}');` : ''}"`;
  }
  function achicar(file, max) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight; const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
        let q = 0.8, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 380000 && q > 0.35) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        if (out.length > 440000) rej(new Error('grande')); else res(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagen')); };
      img.src = url;
    });
  }

  /* ---------- Ubicación ---------- */
  function parseMapsLink(txt) {
    let s = String(txt || '').trim(); try { s = decodeURIComponent(s); } catch (e) { /* tal cual */ }
    const m = s.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) || s.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) ||
      s.match(/[?&](?:q|query|destination|daddr|ll|center)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || s.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    if (!m) return null;
    const lat = +m[1], lng = +m[2];
    return Math.abs(lat) > 90 || Math.abs(lng) > 180 ? null : { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  }
  const tieneUbic = (p) => p.lat != null || !!p.direccion || !!p.mapsUrl;
  const tieneLugar = (p) => tieneUbic(p) || !!(p.fotos || []).length || !!p.indicaciones || !!p.retiro;
  function comoLlegarUrl(p, c) {
    if (p.lat != null && p.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    if (p.mapsUrl && /^https:\/\/[^\s"'<>]+$/.test(p.mapsUrl)) return p.mapsUrl;
    if (p.direccion) return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.direccion + (c && c.ciudad ? ', ' + c.ciudad : '') + ', Entre Ríos');
    return '';
  }
  const hayWebGL = (() => { let r = null; return () => { if (r !== null) return r; try { const cv = document.createElement('canvas'); r = !!(cv.getContext('webgl') || cv.getContext('experimental-webgl')); } catch (e) { r = false; } return r; }; })();
  // Mapa del lugar: el de OpenStreetMap necesita WebGL; si el celular no lo tiene, una tarjeta con la dirección y el botón para abrir el mapa
  function mapaLugar(p, c, cls, alt) {
    if (p.lat == null) return '';
    if (!hayWebGL() || window.__sinWebGL) { const url = comoLlegarUrl(p, c || {}); return `<div class="mapa ${cls || ''} sinmapa"${alt || ''}><div class="smi">${I('pin', 'width:22px;height:22px')}<b>${esc(p.nombre || 'Lugar')}</b>${p.direccion ? `<span>${esc(p.direccion)}</span>` : ''}${url ? `<a class="sbtn" href="${esc(url)}" target="_blank" rel="noopener">${I('nav', 'width:15px;height:15px')}Abrir en el mapa</a>` : ''}<small>Este celular no puede mostrar el mapa acá.</small></div></div>`; }
    return `<div class="mapa ${cls || ''}"><iframe loading="lazy" title="Mapa de ${esc(p.nombre || '')}" src="${esc(mapaUrl(p))}"></iframe></div>`;
  }
  function mapaUrl(p) { const d = 0.0035; return `https://www.openstreetmap.org/export/embed.html?bbox=${p.lng - d},${p.lat - d * 0.6},${p.lng + d},${p.lat + d * 0.6}&layer=mapnik&marker=${p.lat},${p.lng}`; }
  const retiroLabel = (p) => 'Retiro del ' + (p.tipo === 'stand' ? 'stand' : p.tipo === 'carrito' ? 'carrito' : 'material');

  // Varias novedades juntas (por ejemplo, los lugares de cada campaña) se dibujan una sola vez.
  // Mientras alguien escribe en un formulario de la pantalla (p. ej. Datos de la campaña), los cambios que llegan
  // no redibujan: se guardan para después, así no se pierde lo escrito.
  function ocupado() { const f = document.querySelector('#app [data-editable]'); if (!f) { S.sucio = false; return false; } const a = document.activeElement; return !!S.sucio || (f.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'file'); }
  function refrescar(fn) { if (ocupado()) { S.pendRender = true; return; } fn(); }
  function refrescarPend() { if (S.pendRender && !ocupado()) { S.pendRender = false; render(); } }
  document.addEventListener('input', (e) => { if (e.target.type !== 'file' && e.target.closest && e.target.closest('#app [data-editable]')) S.sucio = true; });
  document.addEventListener('focusout', () => setTimeout(refrescarPend, 0));
  function luego() { if (luego.t) return; luego.t = setTimeout(() => { luego.t = 0; refrescar(render); }, 0); }
  function render() {
    renderTop();
    const r = S.route;
    if (!S.loaded) { $('app').innerHTML = '<div class="empty">Cargando…</div>'; return; }
    if (r.name === 'camp') return renderCamp();
    if (r.name === 'mis') return renderMis();
    if (r.name === 'turno') return renderTurno();
    if (r.name === 'coord') return renderCoord();
    if (r.name === 'admin') return renderAdmin();
    if (r.name === 'soporte') return renderSoporte();
    if (r.name === 'ayuda') return renderAyuda();
    renderHome();
  }

  /* ---------- Días y turnos de una campaña ---------- */
  // Campaña de menos de una semana: los días que realmente tiene ([{ d: día de la semana, n: número de día }]); si dura 7 días o más, null
  function diasCorta(c) {
    if (!c.desde || !c.hasta || c.hasta < c.desde) return null;
    const a = parseIso(c.desde), b = parseIso(c.hasta), r = [];
    for (let x = new Date(a); x <= b && r.length < 8; x.setDate(x.getDate() + 1)) r.push({ d: x.getDay(), n: x.getDate() });
    return r.length < 7 ? r : null;
  }
  function diasDe(c, max) {
    const out = [], turnos = Object.values(c.turnos || {});
    if (!c.desde || !c.hasta || !turnos.length) return out;
    let d = c.desde < hoy() ? hoy() : c.desde;
    while (d <= c.hasta && out.length < (max || 60)) { const w = dowOf(d); if (turnos.some(t => (t.dias || []).includes(w))) out.push(d); d = addDays(d, 1); }
    return out;
  }
  function turnosDelDia(c, fecha) {
    const w = dowOf(fecha);
    return Object.keys(c.turnos || {}).map(id => Object.assign({ id }, c.turnos[id])).filter(t => (t.dias || []).includes(w) && c.puntos && c.puntos[t.punto])
      .sort((a, b) => (a.desde || '').localeCompare(b.desde || '') || String((c.puntos[a.punto] || {}).nombre).localeCompare(String((c.puntos[b.punto] || {}).nombre)));
  }
  const cupoId = (cid, fecha, tid) => `${cid}__${fecha}__${tid}`;
  const cupoDe = (c, t) => Math.max(1, parseInt((c.puntos[t.punto] || {}).cupo, 10) || 2);

  /* ---------- Lugares ocupados (todos los días de una campaña; público y sin datos personales) ---------- */
  // Cupos de una campaña: solo de hoy en adelante (los días pasados no se leen). Si falta el índice en Firebase, lee todos.
  function cuposQuery(cid, desde) { const b = S.db.collection('cupos').where('cid', '==', cid); return desde ? b.where('fecha', '>=', desde) : b; }
  S.sinIndice = false;
  function listenCC(cid) {
    if (S.ccUnsub[cid]) return;
    S.cc[cid] = S.cc[cid] || {}; S.ccUnsub[cid] = true;
    S.ccOk = S.ccOk || {}; S.ccErr = S.ccErr || {};
    const escuchar = (conFecha) => cuposQuery(cid, conFecha ? hoy() : '').onSnapshot({ includeMetadataChanges: true }, (qs) => {
      const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.cc[cid] = o;
      const delServidor = !(qs.metadata && qs.metadata.fromCache);
      if (delServidor) { S.ccOk[cid] = true; S.ccErr[cid] = false; }
      if (S.route.name === 'home' || (S.route.name === 'camp' && S.route.cid === cid)) luego();
    }, (e) => {
      if (conFecha && e && e.code === 'failed-precondition') { if (!S.sinIndice) registrarError('aviso', 'Cupos: falta el índice cid+fecha en Firebase (se leen todos)'); S.sinIndice = true; S.ccUnsub[cid] = escuchar(false); return; }
      console.error(e); registrarError('aviso', 'Cupos: ' + (e.code || e.message || e)); S.ccErr[cid] = true; S.ccUnsub[cid] = null; if (S.route.name === 'camp' && S.route.cid === cid) luego();
    });
    S.ccUnsub[cid] = escuchar(!S.sinIndice);
  }
  const ocupDe = (cid, fecha, tid) => ((S.cc[cid] || {})[cupoId(cid, fecha, tid)] || {}).ocupados || {};
  function cobertura(c, dias) {
    let total = 0, ocup = 0;
    dias.forEach(d => turnosDelDia(c, d).filter(t => !yaEmpezo(d, t)).forEach(t => { const n = cupoDe(c, t); total += n; ocup += Math.min(n, Object.keys(ocupDe(c.id, d, t.id)).length); }));
    return { total, ocup, faltan: total - ocup };
  }

  /* ---------- Pedidos por confirmar (para la franja del coordinador en el inicio) ---------- */
  function listenPend(cid) {
    if (S.pendUnsub[cid]) return;
    S.pendUnsub[cid] = true;
    S.pendUnsub[cid] = S.db.collection('pedidos').where('cid', '==', cid).onSnapshot((qs) => {
      let n = 0; qs.forEach(d => { const x = d.data(); if (x.estado === 'pendiente' && x.fecha >= hoy()) n++; });
      S.pend[cid] = n; if (S.route.name === 'home') luego();
    }, (e) => { console.error(e); S.pendUnsub[cid] = null; });
  }

  /* ---------- Inicio ---------- */
  // Un turno de hoy que ya empezó no se puede pedir (hora de Argentina, la del celular)
  const yaEmpezo = (fecha, t) => { if (fecha !== hoy()) return fecha < hoy(); const n = new Date(); return minutos(t.desde) <= n.getHours() * 60 + n.getMinutes(); };
  const ordenPuntos = (c) => Object.keys(c.puntos || {}).sort((a, b) => String(c.puntos[a].nombre || '').localeCompare(String(c.puntos[b].nombre || ''), 'es', { numeric: true, sensitivity: 'base' }));
  const minutos = (hhmm) => { const [a, b] = String(hhmm || '0:0').split(':'); return (+a) * 60 + (+b || 0); };
  function misProximos() {
    const ahora = new Date(), m = ahora.getHours() * 60 + ahora.getMinutes();
    return Object.keys(S.mis).map(id => Object.assign({ id }, S.mis[id]))
      .filter(p => p.estado !== 'rechazado' && (p.fecha > hoy() || (p.fecha === hoy() && minutos(p.hasta) > m)))
      .sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
  }
  function cuandoTexto(p) {
    const dias = Math.round((parseIso(p.fecha) - parseIso(hoy())) / 864e5);
    if (dias > 1) return `Faltan ${dias} días`;
    if (dias === 1) return 'Mañana';
    const ahora = new Date(), falta = minutos(p.desde) - (ahora.getHours() * 60 + ahora.getMinutes());
    if (falta <= 0) return 'Ahora';
    return 'Hoy · en ' + (falta >= 60 ? `${Math.floor(falta / 60)} h${falta % 60 ? ' ' + (falta % 60) + ' min' : ''}` : `${falta} min`);
  }
  function ticket(p) {
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, conf = p.estado === 'confirmado';
    const esHoy = p.fecha === hoy(), url = pt.nombre ? comoLlegarUrl(pt, c) : '', cuando = cuandoTexto(p);
    const pill = conf ? '<span class="pill g"><i></i>Confirmado</span>' : '<span class="pill w"><i></i>Esperando confirmación</span>';
    const top = esHoy ? `<span class="today">${I('clock', 'width:13px;height:13px')}${esc(cuando)}</span>${pill}` : `<span class="d">${esc(DOW[parseIso(p.fecha).getDay()] + ' ' + parseIso(p.fecha).getDate() + ' de ' + MES[parseIso(p.fecha).getMonth()])}</span>${pill}`;
    let hint = '';
    if (!conf) hint = '<div class="hint">Un coordinador lo revisa y te confirma. Lo vas a ver acá y en Mis turnos.</div>';
    else if (esHoy && pt.retiro) hint = `<div class="hint">${esc(retiroLabel(pt))}: ${esc(pt.retiro)}</div>`;
    let acts;
    if (!conf) acts = `<button type="button" class="btn gh" data-go="#/t/${esc(p.id)}">Ver detalle</button><button type="button" class="btn gh sm" data-cancelar="${esc(p.id)}">Cancelar</button>`;
    else if (esHoy && url) acts = `<a class="btn w big2" href="${esc(url)}" target="_blank" rel="noopener">${I('nav')}Cómo llegar</a><button type="button" class="btn gh sm" data-go="#/t/${esc(p.id)}">Detalle</button>`;
    else acts = (url ? `<a class="btn w" href="${esc(url)}" target="_blank" rel="noopener">${I('nav')}Cómo llegar</a>` : '') + `<button type="button" class="btn gh" data-go="#/t/${esc(p.id)}">Ver detalle</button>`;
    return `<div class="ticket${conf ? '' : ' pend'}"><div class="top">${top}</div><div class="t num">${esc(p.desde)} – ${esc(p.hasta)}</div>${esHoy ? '' : `<div class="cuando">${esc(cuando)}</div>`}<div class="p">${I('pin')}${esc(c.nombre || '')}${pt.nombre ? ' · ' + esc(pt.nombre) : ''}</div>${hint}<div class="sep"></div><div class="acts">${acts}</div></div>`;
  }
  function libresSemana(cs) {
    let n = 0, mejor = null, max = 0;
    cs.forEach(c => { const ds = diasDe(c).filter(d => d <= addDays(hoy(), 6)); if (!ds.length) return; listenCC(c.id); const k = cobertura(c, ds); n += k.faltan; if (k.faltan > max) { max = k.faltan; mejor = c; } });
    return { n, mejor };
  }
  /* ---------- Bienvenida: 3 pasos, solo la primera vez (se vuelve a ver con "¿Cómo funciona?") ---------- */
  const PASOS = [
    { t: 'Elegí una campaña', d: 'En el inicio están las campañas de toda la provincia. Tocá la de tu ciudad.' },
    { t: 'Elegí día y horario', d: 'Tocá un día y después un horario que tenga lugar.' },
    { t: 'Anotate con tu cuenta de Google', d: 'Dejás tu nombre, congregación y celular. Solo los ven los coordinadores de esa campaña.' },
    { t: 'Un coordinador te confirma', d: 'Lo ves en Mis turnos. Desde ahí lo agendás, ves cómo llegar o lo cancelás si no podés ir.' }
  ];
  function bienvenida(forzar) {
    if (!forzar) { try { if (localStorage.getItem('ppam-bienvenida')) return; } catch (e) { return; } }
    let i = 0;
    const ov = sheet(`<div class="bv"><h3 class="sr">Cómo funciona</h3><div class="bvs" aria-live="polite"></div><div class="bvd" aria-hidden="true">${PASOS.map(() => '<i></i>').join('')}</div><button type="button" class="btn" id="bvSig">Siguiente</button><button type="button" class="btn alt" id="bvSal">Saltear</button></div>`);
    ov.classList.add('ovbv');
    const marcar = () => { try { localStorage.setItem('ppam-bienvenida', '1'); } catch (e) { /* nada */ } };
    const pintar = () => {
      const p = PASOS[i];
      // animación corta hecha con capturas reales de la app; con "reducir movimiento" se muestra la imagen fija
      ov.querySelector('.bvs').innerHTML = `<picture class="bvan"><source media="(prefers-reduced-motion: reduce)" srcset="img/bienvenida/paso${i + 1}-fijo.webp"><img src="img/bienvenida/paso${i + 1}.webp" width="390" height="560" alt=""></picture><small>Paso ${i + 1} de ${PASOS.length}</small><b>${esc(p.t)}</b><p>${esc(p.d)}</p>`;
      ov.querySelectorAll('.bvd i').forEach((d, k) => d.classList.toggle('on', k === i));
      ov.querySelector('#bvSig').textContent = i === PASOS.length - 1 ? 'Empezar' : 'Siguiente';
      ov.querySelector('#bvSal').classList.toggle('oculto', i === PASOS.length - 1);
    };
    const cerrar = () => { marcar(); ov.remove(); };
    ov.querySelector('#bvSig').addEventListener('click', () => { if (i < PASOS.length - 1) { i++; pintar(); } else cerrar(); });
    ov.querySelector('#bvSal').addEventListener('click', cerrar);
    let x0 = null; const box = ov.querySelector('.bv');
    box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (dx < -40 && i < PASOS.length - 1) { i++; pintar(); } else if (dx > 40 && i > 0) { i--; pintar(); } });
    ov.addEventListener('click', (e) => { if (e.target === ov) marcar(); });
    pintar();
    PASOS.forEach((_, k) => { if (k) { const im = new Image(); im.src = `img/bienvenida/paso${k + 1}.webp`; } });   // precarga los pasos siguientes
  }
  function guiaCoord() {
    try { if (localStorage.getItem('ppam-guia-coord')) return ''; } catch (e) { return ''; }
    return `<div class="cguia"><b>${I('star', 'width:16px;height:16px')}Cómo se usa Coordinación</b><ul><li><b>Pedidos:</b> confirmá o no a quien se anotó. Con el botón verde le escribís por WhatsApp.</li><li><b>Del día:</b> quién va a cada punto, y la lista para compartir con el grupo.</li><li><b>La lupa</b> (arriba): buscá un hermano, un punto o un turno, y anotá a alguien que no usa la app.</li></ul><button type="button" class="sbtn" data-cguia>Entendido</button></div>`;
  }
  /* ---------- Ayuda: preguntas frecuentes (texto fijo, sin lecturas a Firebase) ---------- */
  const AYUDA = [
    { g: 'Anotarme', qs: [
      ['google', '¿Por qué tengo que entrar con Google?', 'Para saber que sos vos: así nadie puede anotarse a tu nombre y podés ver tus turnos desde cualquier celular. Usamos tu cuenta solo para eso; no vemos tus correos ni tus contactos.'],
      ['espera', 'Mi turno dice "Esperando confirmación", ¿qué significa?', 'Que tu pedido llegó bien y un coordinador de la campaña lo tiene que confirmar. Mientras tanto el lugar queda guardado para vos. Cuando lo confirme, en Mis turnos va a decir "Confirmado".'],
      ['completo', 'Un horario dice "Completo", ¿qué hago?', 'Elegí otro horario u otro día: los que tienen lugar dicen "Faltan" y cuántos. Con el filtro "Con lugar" ves solo esos, y con la lupa de arriba buscás lugares libres para hoy o mañana en toda la provincia.'],
      ['acompanado', '¿Puedo anotarme con mi esposa o con otro hermano?', 'Sí. Cada uno se anota con su propia cuenta en el mismo horario. Al anotarte podés dejar una nota para el coordinador, por ejemplo "Voy con mi esposa". Desde tu turno, "Invitar a alguien a este turno" le manda el enlace por WhatsApp.'],
      ['varios', '¿Puedo anotarme en más de un turno?', 'Sí, en los que quieras. Si dos turnos se superponen en el horario, la app te avisa antes de confirmar.']
    ] },
    { g: 'Mis turnos', qs: [
      ['confirmado', '¿Cómo sé si me confirmaron?', 'Entrá a Mis turnos: cada turno dice "Esperando confirmación" o "Confirmado". También lo ves en el inicio. La app no manda notificaciones; si hace falta, el coordinador te escribe por WhatsApp.'],
      ['llegar', '¿Cómo llego al lugar?', 'En tu turno, "Llegar" abre Google Maps con el lugar marcado. En la campaña, "Ver lugar" muestra fotos e indicaciones del punto.'],
      ['agendar', '¿Cómo lo agendo en el calendario del celular?', 'En tu turno tocá "Agendar": se descarga un archivo que tu celular abre con el calendario, con el día, el horario y el lugar.'],
      ['cancelar', 'No puedo ir, ¿cómo cancelo?', 'Entrá a Mis turnos, tocá el turno y después "Cancelar". El lugar se libera enseguida para otro hermano. Avisá con tiempo: así el coordinador puede cubrirlo.']
    ] },
    { g: 'Mis datos y la app', qs: [
      ['datos', '¿Quién ve mis datos?', 'Solo los coordinadores de la campaña en la que te anotaste, para organizar los turnos. Los demás hermanos ven cuántos lugares quedan, pero nunca quién está anotado.'],
      ['borrar', '¿Cómo borro mis datos de este celular?', 'Tocá tu inicial arriba a la derecha y después "Borrar mis datos de este celular". Se borran tu nombre, celular y búsquedas guardadas; tus turnos no se tocan. Al cerrar sesión también se borra lo guardado.'],
      ['instalar', '¿Cómo instalo la app en el celular?', 'Tocá tu inicial arriba a la derecha y después "Instalar la app". En iPhone: en Safari, tocá Compartir y "Agregar a inicio". Queda como un ícono más y abre más rápido.'],
      ['senal', 'No me carga o tengo poca señal, ¿qué hago?', 'La app guarda en el celular lo último que cargó, así que podés ver campañas y turnos con poca señal. Si te anotás o cancelás sin conexión, se manda solo cuando vuelve. Si no carga nada, cerrala y volvé a abrirla; si sigue igual, usá "Reportar un problema".']
    ] },
    { g: 'Para coordinadores', coord: true, qs: [
      ['anotar', '¿Cómo anoto a un hermano que no usa la app?', 'En Del día, tocá "Anotar" en el horario, o buscalo con la lupa de arriba. Queda confirmado y podés avisarle por WhatsApp con un solo mensaje.'],
      ['lista', '¿Cómo paso la lista del día al grupo de WhatsApp?', 'En Del día, elegí el día y tocá "Compartir la lista por WhatsApp" al final: arma el mensaje con cada punto, horario y quiénes van.'],
      ['recuperar', 'Borré algo por error, ¿se puede recuperar?', 'En Ajustes › Historial ves quién cambió qué y cuándo; los puntos y turnos borrados se pueden volver con "Restaurar". Para cualquier otra cosa, avisale al administrador: hay copias de seguridad diarias.']
    ] }
  ];
  function renderAyuda() {
    const esCoord = !!(S.user && (S.isAdmin || S.coordDe.length));
    let h = `<button type="button" class="btn alt" id="ayBv" style="margin:4px 0 6px">${I('star', 'width:18px;height:18px')}Ver la bienvenida otra vez</button>`;
    AYUDA.filter(g => !g.coord || esCoord).forEach(g => {
      h += `<div class="sec">${esc(g.g)}</div><div class="card faq">${g.qs.map(([id, q, a]) => `<details name="faq" id="faq-${id}"${S.route.q === id ? ' open' : ''}><summary>${esc(q)}${I('chev', 'width:16px;height:16px')}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
    });
    h += `<div class="card" style="padding:14px 16px;margin-top:14px"><b>¿No encontraste tu respuesta?</b><p class="hint" style="margin:4px 0 10px">Contanos qué pasó y te ayuda el equipo de soporte.</p><button type="button" class="sbtn" id="ayRep">${I('alert', 'width:15px;height:15px')}Reportar un problema</button></div>`;
    $('app').innerHTML = h;
    $('ayBv').addEventListener('click', () => bienvenida(true));
    $('ayRep').addEventListener('click', () => reportar());
    if (S.route.q) { const d = $('faq-' + S.route.q); if (d) setTimeout(() => d.scrollIntoView({ block: 'center' }), 50); }
  }
  function renderHome() {
    const list = Object.values(S.campanas).filter(c => c.activa !== false && (!c.hasta || c.hasta >= hoy()))
      .sort((a, b) => String(a.desde || '').localeCompare(String(b.desde || '')) || String(a.nombre).localeCompare(String(b.nombre)));
    const ciudades = [...new Set(list.map(c => c.ciudad).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    if (S.ciudad !== 'todas' && !ciudades.includes(S.ciudad)) S.ciudad = 'todas';
    const vis = list.filter(c => S.ciudad === 'todas' || c.ciudad === S.ciudad);
    const prox = S.user ? misProximos() : [];
    let h = instalarHTML();
    if (prox.length) {
      h += `<div class="lbl">${prox[0].fecha === hoy() ? 'Hoy' : 'Tu próximo turno'}</div>` + ticket(prox[0]);
      if (prox.length > 1) {
        const otros = prox.slice(1, 3).map(p => { const d = parseIso(p.fecha); return `${DOW[d.getDay()].toLowerCase()} ${d.getDate()}`; });
        h += `<button type="button" class="more" data-go="#/mis"><span><b>Tenés ${prox.length - 1} ${prox.length === 2 ? 'turno' : 'turnos'} más</b><small>${esc(cap(otros.join(' y ')))}${prox.length > 3 ? '…' : ''}</small></span><span class="lk">Ver todos${I('chev', 'width:15px;height:15px')}</span></button>`;
      }
    } else if (!(S.vista === 'mapa' && S.publico.mapa !== false && vis.length)) {   // en modo Mapa, el mapa es el protagonista
      const { n, mejor } = libresSemana(vis);
      const donde = S.ciudad !== 'todas' ? 'En ' + S.ciudad : 'En Entre Ríos';
      h += `<div class="lbl">${S.user ? 'Todavía no tenés turnos' : 'Predicación pública'}</div><div class="welcome">`;
      h += S.user ? `<h4>¿Te sumás esta semana?</h4><p>${esc(donde)} ${n === 1 ? 'falta <b>1 lugar</b>' : `faltan <b>${n} lugares</b>`} en los próximos 7 días.</p>`
        : `<h4>Sumate a un turno</h4><p>Elegí una campaña, un día y un horario. Un coordinador te confirma.</p><div class="stats"><div><b class="num">${vis.length}</b><small>${vis.length === 1 ? 'campaña activa' : 'campañas activas'}${S.ciudad !== 'todas' ? ' en ' + esc(S.ciudad) : ''}</small></div><div><b class="num">${n}</b><small>lugares libres esta semana</small></div></div>`;
      if (mejor) h += `<button type="button" class="btn p" data-go="#/c/${esc(mejor.id)}">Ver turnos libres</button>`;
      h += '</div>';
    }
    // Coordinadores: pedidos por confirmar
    if (S.user && (S.isAdmin || S.coordDe.length)) {
      const mias = list.filter(c => S.isAdmin || S.coordDe.includes(c.id));
      mias.forEach(c => listenPend(c.id));
      const n = mias.reduce((a, c) => a + (S.pend[c.id] || 0), 0);
      const dest = mias.length === 1 ? '#/coord/' + mias[0].id : '#/coord';
      h += `<button type="button" class="coordbar" data-go="${esc(dest)}"><span class="n num${n ? '' : ' cero'}">${n}</span><span class="tx">${n === 1 ? 'Pedido por confirmar' : n ? 'Pedidos por confirmar' : 'Coordinación · todo al día'}<small>${esc(mias.length === 1 ? mias[0].nombre : mias.length + ' campañas')}</small></span>${I('chev')}</button>`;
    }
    h += `<div class="sh"><b>Campañas</b>${ciudades.length > 1 ? `<label class="flt">${esc(S.ciudad === 'todas' ? 'Toda la provincia' : S.ciudad)}${I('down', 'width:14px;height:14px')}<select id="fCiudad" aria-label="Filtrar por ciudad">${['todas', ...ciudades].map(x => `<option value="${esc(x)}"${x === S.ciudad ? ' selected' : ''}>${x === 'todas' ? 'Toda la provincia' : esc(x)}</option>`).join('')}</select></label>` : ''}</div>`;
    const conMapa = S.publico.mapa !== false;   // Administración → "Mostrar el mapa en el Inicio"
    if (!conMapa && S.vista === 'mapa') S.vista = 'lista';
    if (vis.length && conMapa) h += `<div class="seg2" role="group" aria-label="Ver como"><button type="button" data-vista="lista" class="${S.vista !== 'mapa' ? 'on' : ''}">${I('list', 'width:15px;height:15px')}Lista</button><button type="button" data-vista="mapa" class="${S.vista === 'mapa' ? 'on' : ''}">${I('pin', 'width:15px;height:15px')}Mapa</button></div>`;
    if (vis.length && S.vista === 'mapa') {
      h += mapaHTML();
      // Las que no se pueden ubicar (sin puntos marcados y ciudad desconocida) siguen apareciendo, debajo del mapa.
      const fuera = fueraDelMapa(vis);
      if (fuera.length) h += `<div class="lbl" style="margin-top:4px">${fuera.length === 1 ? 'Sin ubicación en el mapa' : fuera.length + ' campañas sin ubicación en el mapa'}</div>` + fuera.map(campCard).join('');
    }
    else h += vis.length ? vis.map(campCard).join('') : '<div class="card"><div class="empty">Todavía no hay campañas publicadas.</div></div>';
    $('app').innerHTML = h;
    if (vis.length && S.vista === 'mapa') dibujarMapa(vis);
  }
  function campCard(c) {
    listenCC(c.id);
    const dias = diasDe(c), pts = Object.values(c.puntos || {});
    let cob = '<small class="falt">Todavía sin turnos cargados</small>';
    if (dias.length) {
      const k = cobertura(c, dias.filter(d => d <= addDays(dias[0], 6)));
      const pct = k.total ? Math.round(k.ocup * 100 / k.total) : 0;
      const cuando = dias[0] <= addDays(hoy(), 6) ? 'en los próximos 7 días' : 'la primera semana';
      cob = `<span class="meter"><i style="--w:${pct}%"></i><span class="num">${pct}%</span></span><small class="falt">${k.faltan > 0 ? `Faltan ${k.faltan} ${k.faltan === 1 ? 'lugar' : 'lugares'} ${cuando}` : `Todo cubierto ${cuando}`}</small>`;
    }
    return `<button type="button" class="cc camp" data-go="#/c/${esc(c.id)}"><span class="th${c.portada ? '' : ' sinf'}"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}>${c.portada ? '' : I(pts.some(p => p.tipo === 'carrito') ? 'cart' : pts.some(p => p.tipo === 'stand') ? 'stand' : 'pin', 'width:26px;height:26px')}</span><span class="tx"><b>${esc(c.nombre)}</b><small>${esc([c.ciudad, rangoCorto(c), pts.length + (pts.length === 1 ? ' punto' : ' puntos')].filter(Boolean).join(' · '))}</small>${cob}</span>${I('chev')}</button>`;
  }
  const ESTADOS = { pendiente: 'Esperando confirmación', confirmado: 'Confirmado', rechazado: 'No confirmado' };
  function pedidoRow(p) {
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, d = parseIso(p.fecha);
    return `<button type="button" class="row" data-go="#/t/${esc(p.id || '')}"><span class="dt${p.estado === 'confirmado' ? ' ok' : ''}"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b></span><span class="tx"><b>${esc(cap(fmtDia(p.fecha)))} · ${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))}</b><small>${esc(c.nombre || '')} · ${esc(pt.nombre || '')}</small></span><span class="tag ${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</span></button>`;
  }

  /* ---------- Campaña ---------- */
  function renderCamp() {
    const c = S.campanas[S.route.cid];
    if (!c) { $('app').innerHTML = '<div class="card"><div class="empty">Esa campaña no existe o ya terminó.</div></div>'; return; }
    listenCC(c.id);
    const dias = diasDe(c).filter(d => turnosDelDia(c, d).some(t => !yaEmpezo(d, t)));
    const cargando = !(S.ccOk || {})[c.id] && !(S.ccErr || {})[c.id], errCupos = !!(S.ccErr || {})[c.id];
    const enlace = S.route.fecha && S.route.tid && !S.route.hecho && dias.includes(S.route.fecha) && c.turnos && c.turnos[S.route.tid] ? S.route : null;
    if (enlace) { S.dia = enlace.fecha; S.diaCid = c.id; }
    if (S.diaCid !== c.id || !dias.includes(S.dia)) { S.dia = dias[0]; S.diaCid = c.id; }
    if (!dias.length) { $('app').innerHTML = '<div class="card"><div class="empty">No hay días con turnos por delante.</div></div>'; return; }
    const md = parseIso(S.dia);
    let h = `<div class="month"><b>${cap(MES[md.getMonth()])}</b><span class="leyenda"><i class="c"></i>confirmado<i class="p"></i>pedido<i></i>libre</span></div>`;
    h += `<div class="days">${dias.map(d => {
      const x = parseIso(d), k = cobertura(c, [d]);
      const nivel = k.faltan <= 0 ? 'lleno' : k.faltan / k.total <= 0.34 ? 'poco' : 'libre';
      const llenos = k.total ? Math.round(k.ocup * 3 / k.total) : 0;
      return `<button type="button" class="day ${nivel}${d === S.dia ? ' on' : ''}" data-dia="${d}"><small>${DOW[x.getDay()]}</small><b class="num">${x.getDate()}</b><span class="cap3">${[0, 1, 2].map(i => `<i class="${i < llenos ? 'f' : ''}"></i>`).join('')}</span></button>`;
    }).join('')}</div>`;
    const ts = turnosDelDia(c, S.dia);
    const orden = ordenPuntos(c).filter(pid => ts.some(t => t.punto === pid));
    const filas = orden.map(pid => {
      const p = c.puntos[pid], items = ts.filter(t => t.punto === pid).map(t => {
        const oc = ocupDe(c.id, S.dia, t.id), n = cupoDe(c, t), vals = Object.values(oc), conf = vals.filter(v => v === 'c').length;
        const mio = S.user && oc[S.user.uid], paso = yaEmpezo(S.dia, t), falta = paso || cargando || errCupos ? 0 : Math.max(0, n - vals.length);
        return { t, n, conf, pend: vals.length - conf, mio, falta, paso };
      });
      return { pid, p, items, libres: items.reduce((a, x) => a + x.falta, 0) };
    });
    const libresDia = filas.reduce((a, f) => a + f.libres, 0), conLugar = S.campFiltro === 'libres';
    const tipoN = filas.every(f => f.p.tipo === 'carrito') ? ['carrito', 'carritos'] : ['punto', 'puntos'];
    h += `<div class="sec">${esc(cap(fmtDia(S.dia)))}</div>`;
    if (!filas.length) h += '<div class="card"><div class="empty">No hay turnos ese día.</div></div>';
    else h += `<div class="dres"><span>${filas.length} ${tipoN[filas.length === 1 ? 0 : 1]} · <b>${cargando ? '<span class="carg">Consultando lugares…</span>' : errCupos ? 'lugares sin datos' : libresDia ? (libresDia === 1 ? '1 lugar libre' : libresDia + ' lugares libres') : 'sin lugares libres'}</b></span><div class="seg2 cf"><button type="button" data-cf="todos" class="${conLugar ? '' : 'on'}">Todos</button><button type="button" data-cf="libres" class="${conLugar ? 'on' : ''}">Con lugar</button></div></div>`;
    if (filas.length && !cargando && !errCupos && libresDia) h += `<p class="ayuda">Tocá un horario con lugar para pedir tu turno. Un coordinador lo confirma y te avisa.</p>`;
    if (errCupos) h += `<div class="aviso-mapa ccerr">${I('alert', 'width:16px;height:16px;flex-shrink:0;margin-top:2px')}<span><b>No pudimos consultar los lugares libres</b>Puede ser la señal. Los horarios se ven, pero no sabemos cuántos lugares quedan. <button type="button" class="sbtn" data-ccretry="${esc(c.id)}">Reintentar</button></span></div>`;
    S.plegados = S.plegados || {};
    let vistos = 0;
    filas.forEach(({ pid, p, items, libres }) => {
      const vis = conLugar ? items.filter(x => x.falta > 0 || x.mio) : items.filter(x => !x.paso || x.mio || items.every(y => y.paso));
      if (!vis.length) return;
      vistos++;
      const tp = TIPOS[p.tipo] || TIPOS.otro, pleg = !!S.plegados[c.id + '|' + pid];
      h += `<div class="pc${pleg ? ' pleg' : ''}"><div class="pt"><div class="th"${fotoAttr(c.id, (p.fotos || [])[0])}>${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin')}</div><button type="button" class="tx" data-plegar="${esc(pid)}" aria-expanded="${!pleg}"><b>${esc(p.nombre)}</b>${p.detalle ? `<small>${esc(p.detalle)}</small>` : ''}<span class="pl ${libres ? 'ok' : ''}">${cargando ? '…' : errCupos ? 'Sin datos' : libres ? (libres === 1 ? '1 libre' : libres + ' libres') : items.every(y => y.paso) ? 'Ya empezó' : 'Completo'}${I('chev')}</span></button>${tieneLugar(p) ? `<button type="button" class="loc" data-lugar="${esc(c.id)}|${esc(pid)}" aria-label="Ver lugar">${I('pin', 'width:15px;height:15px')}<span>Ver lugar</span></button>` : ''}</div>`;
      if (!pleg) h += `<div class="chips">${vis.map(x => {
        const est = x.mio ? 'mio' : x.paso ? 'lleno paso' : cargando || errCupos ? 'carg' : x.falta <= 0 ? 'lleno' : x.falta < x.n ? 'poco' : 'libre';
        const txt = x.mio ? (x.mio === 'c' ? 'Tu turno' : 'Pedido') : x.paso ? 'Ya empezó' : cargando ? 'Cargando' : errCupos ? 'Sin datos' : x.falta <= 0 ? 'Completo' : x.falta === 1 ? 'Falta 1' : 'Faltan ' + x.falta;
        const seats = Array.from({ length: Math.max(x.n, x.conf + x.pend) }, (_, k) => `<i class="${k < x.conf ? 'c' : k < x.conf + x.pend ? 'p' : ''}"></i>`).join('');
        return `<button type="button" class="chip ${est}" ${x.mio ? `data-mio="${esc(x.t.id)}"` : `data-pedir="${esc(x.t.id)}"`}${!x.mio && x.falta <= 0 ? ' disabled' : ''}><b class="num">${esc(x.t.desde)}</b><span class="cs"><small>a ${esc(x.t.hasta)}</small>${seats}</span><em>${txt}</em></button>`;
      }).join('')}</div>`;
      h += '</div>';
    });
    if (filas.length && !vistos) h += '<div class="card"><div class="empty">Ese día ya no quedan lugares. Probá con otro día.</div></div>';
    $('app').innerHTML = h;
    if (enlace && (S.ccOk || {})[c.id]) { enlace.hecho = true; setTimeout(() => { const oc = ocupDe(c.id, S.dia, enlace.tid); if (S.user && oc[S.user.uid]) return; if (Object.keys(oc).length >= cupoDe(c, Object.assign({ id: enlace.tid }, c.turnos[enlace.tid]))) { toast('Ese turno ya se completó. Elegí otro horario.'); return; } pedir(enlace.tid); }, 0); }
  }
  function verLugar(cid, pid) {
    const c = S.campanas[cid], p = c && c.puntos && c.puntos[pid];
    if (!p) return;
    const tp = TIPOS[p.tipo] || TIPOS.otro, url = comoLlegarUrl(p, c);
    const dir = p.direccion || (p.lat != null ? `${p.lat}, ${p.lng}` : '');
    const fotos = (p.fotos || []).map(f => `<div${fotoAttr(cid, f)}></div>`).join('');
    sheet(`${fotos ? `<div class="fotos">${fotos}</div>` : ''}<h3>${esc(p.nombre)}</h3><span class="sub">${esc(tp[1])} · ${cupoDe(c, { punto: pid })} por turno</span>
      ${mapaLugar(p, c)}
      <div class="dir">${I('pin')}<div><b>${esc(c.nombre)}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</b>${dir ? '<br>' + esc(dir) : ''}${p.detalle ? '<br>' + esc(p.detalle) : ''}</div></div>
      ${url ? `<div class="lugar-acts"><a class="go" href="${esc(url)}" target="_blank" rel="noopener">${I('nav')}Cómo llegar</a>${dir ? `<button type="button" class="sbtn" data-copiar="${esc(dir)}">${I('copy')}Copiar dirección</button>` : ''}</div>` : ''}
      ${p.indicaciones ? `<div class="info"><b>Cómo encontrarlo</b>${esc(p.indicaciones)}</div>` : ''}
      ${p.retiro ? `<div class="info"><b>${retiroLabel(p)}</b>${esc(p.retiro)}</div>` : ''}
      <button type="button" class="btn alt" data-cerrar style="margin-top:14px">Cerrar</button>`);
  }
  async function copiar(txt) {
    try { await navigator.clipboard.writeText(txt); toast('Dirección copiada'); }
    catch (e) { toast(txt); }
  }

  /* ---------- Pedir un turno ---------- */
  function sheet(html) {
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="handle"></div>${html}</div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-cerrar]')) ov.remove(); });
    modal(ov, ov.querySelector('.sheet'));
    return ov;
  }
  /* Ventanas accesibles (patrón de diálogo del W3C): el foco entra y queda adentro, Escape cierra,
     el fondo queda inerte y al cerrar el foco vuelve a donde estaba. */
  const FONDO = ['tb', 'app', 'tabbar'];
  let abiertas = [];
  function modal(ov, box) {
    const antes = document.activeElement;
    const tit = box.querySelector('h3, h4'); if (tit) { if (!tit.id) tit.id = 'dlg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); box.setAttribute('aria-labelledby', tit.id); }
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    abiertas.push(ov); fondo();
    const foco = () => { const f = box.querySelector('input:not([type=hidden]):not([disabled]), select, textarea, button:not([disabled]), a[href]'); if (f && !/^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName)) { if (tit) { tit.tabIndex = -1; tit.focus({ preventScroll: true }); return; } } (f || box).focus({ preventScroll: true }); };
    setTimeout(foco, 30);
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); ov.remove(); return; }
      if (e.key !== 'Tab') return;
      const fs = [...box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
      if (!fs.length) return;
      const a = fs[0], z = fs[fs.length - 1];
      if (e.shiftKey && (document.activeElement === a || !box.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (document.activeElement === z || !box.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
    });
    const obs = new MutationObserver(() => { if (ov.isConnected) return; obs.disconnect(); abiertas = abiertas.filter(x => x !== ov); fondo(); if (antes && antes.isConnected && !abiertas.length) antes.focus({ preventScroll: true }); });
    obs.observe(document.body, { childList: true });
  }
  function fondo() { const on = abiertas.some(x => x.isConnected); FONDO.forEach(id => { const el = $(id); if (el) { if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); } else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); } } }); const f = document.querySelector('footer'); if (f) { if (on) f.setAttribute('inert', ''); else f.removeAttribute('inert'); } }
  /* ---------- Nota para el coordinador (opcional, privada como el celular) ---------- */
  const NOTA_MAX = 200;
  /* Celular argentino: se limpia el +54, el 9, el 0 y el 15, y se guarda siempre igual (ej. 343 555-0000) */
  function normCel(s0) {
    let d = String(s0 || '').replace(/\D/g, '');
    if (!d) return { ok: false, vacio: true };
    if (d.startsWith('54') && d.length >= 12) d = d.slice(2);
    if (d.length === 11 && d[0] === '9') d = d.slice(1);
    if (d[0] === '0') d = d.slice(1);
    let area = 0;
    if (d.length === 12) { for (const a of [2, 3, 4]) if (d.substr(a, 2) === '15') { d = d.slice(0, a) + d.slice(a + 2); area = a; break; } }
    if (d.length !== 10) return { ok: false, d };
    if (!area) area = d.startsWith('11') ? 2 : 3;
    const resto = d.slice(area);
    return { ok: true, d, txt: d.slice(0, area) + ' ' + resto.slice(0, resto.length - 4) + '-' + resto.slice(-4) };
  }
  const CEL_ERR = 'Revisá el celular: característica y número, sin 0 ni 15 (por ejemplo 343 555-0000).';
  function bindCel(inp, out) {
    const f = () => { const r = normCel(inp.value); out.className = 'celok' + (r.ok ? ' ok' : r.vacio ? '' : ' mal'); out.textContent = r.ok ? (r.txt === inp.value.trim() ? '' : 'Se guarda como ' + r.txt) : r.vacio ? '' : (r.d && r.d.length < 10 ? 'Faltan números: con característica son 10 (por ejemplo 343 555-0000).' : 'Tiene números de más: sacale el 0 y el 15.'); };
    inp.addEventListener('input', f); inp.addEventListener('blur', () => { const r = normCel(inp.value); if (r.ok) { inp.value = r.txt; out.textContent = ''; out.className = 'celok'; } });
    f();
  }
  const NOTA_ATAJOS = ['Voy con mi esposa/o', 'Puedo llevar el carrito', 'Es mi primera vez', 'Llego unos minutos tarde'];
  function notaCampo(valor) {
    return `<div class="fld nota-fld"><label for="pNota">Nota para el coordinador <span class="opc">(opcional)</span><span class="nt-cnt" id="pNotaCnt">${(valor || '').length}/${NOTA_MAX}</span></label>
      <div class="nt-chips">${NOTA_ATAJOS.map(x => `<button type="button" data-atajo="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <textarea id="pNota" rows="2" maxlength="${NOTA_MAX}" placeholder="Por ejemplo: con quién vas, si podés llevar el carrito…">${esc(valor || '')}</textarea></div>`;
  }
  function bindNota(root) {
    const ta = root.querySelector('#pNota'), cnt = root.querySelector('#pNotaCnt');
    const pinta = () => {
      cnt.textContent = ta.value.length + '/' + NOTA_MAX;
      root.querySelectorAll('[data-atajo]').forEach(b => b.classList.toggle('on', ta.value.toLowerCase().includes(b.dataset.atajo.toLowerCase())));
    };
    ta.addEventListener('input', pinta);
    root.querySelectorAll('[data-atajo]').forEach(b => b.addEventListener('click', () => {
      const x = b.dataset.atajo;
      const k = ta.value.toLowerCase().indexOf(x.toLowerCase());
      if (k >= 0) ta.value = (ta.value.slice(0, k) + ta.value.slice(k + x.length).replace(/^\./, '')).replace(/\s{2,}/g, ' ').trim();
      else ta.value = (ta.value.trim() ? ta.value.trim().replace(/[.]?$/, '. ') : '') + x + '.';
      ta.value = ta.value.slice(0, NOTA_MAX);
      pinta();
    }));
    pinta();
  }
  const notaHTML = (n, cls) => n ? `<div class="${cls || 'nota'}">${I('edit', 'width:15px;height:15px')}<span><b>Nota:</b> ${esc(n)}</span></div>` : '';
  function editarNota(pid) {
    const p = S.mis[pid]; if (!p) return;
    const ov = sheet(`<h3>Nota para el coordinador</h3><p class="hint">La ven solo los coordinadores de esta campaña.</p>${notaCampo(p.nota)}
      <p class="err hidden" id="nErr"></p><button type="button" class="btn" id="nOk">Guardar nota</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    bindNota(ov);
    ov.querySelector('#nOk').addEventListener('click', async () => {
      const v = ov.querySelector('#pNota').value.trim().slice(0, NOTA_MAX);
      const b = ov.querySelector('#nOk'); b.disabled = true; b.textContent = 'Guardando…';
      try { await S.db.doc('pedidos/' + pid).update({ nota: v ? v : S.del() }); ov.remove(); toast(v ? 'Nota guardada' : 'Nota borrada'); }
      catch (e) { console.error(e); b.disabled = false; b.textContent = 'Guardar nota'; ov.querySelector('#nErr').textContent = 'No se pudo guardar. Probá de nuevo.'; ov.querySelector('#nErr').classList.remove('hidden'); }
    });
  }
  async function pedir(tid) {
    const c = S.campanas[S.route.cid], t = c && c.turnos[tid] && Object.assign({ id: tid }, c.turnos[tid]);
    if (!t) return;
    if (yaEmpezo(S.dia, t)) { toast('Ese turno ya empezó. Elegí otro horario.'); return; }
    if (!(S.ccOk || {})[c.id]) { toast('Esperá un segundo: estamos consultando los lugares libres.'); return; }
    if (!S.user) {
      const ov = sheet(`<h3>Ingresá para anotarte</h3><p class="hint">Usamos tu cuenta de Google solo para saber que sos vos: así nadie puede anotarse a tu nombre y podés ver tus turnos.</p><button type="button" class="btn" id="lgBtn">Ingresar con Google</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
      ov.querySelector('#lgBtn').addEventListener('click', async () => { await login(); ov.remove(); if (S.user) pedir(tid); });
      return;
    }
    const pf = perfil(), p = c.puntos[t.punto];
    const congs = (S.publico.congregaciones || []).slice().sort((a, b) => a.localeCompare(b, 'es'));
    const opts = congs.map(x => `<option${x === pf.congregacion ? ' selected' : ''}>${esc(x)}</option>`).join('') + `<option value="__otra"${pf.congregacion && !congs.includes(pf.congregacion) ? ' selected' : ''}>Otra…</option>`;
    const libres = cupoDe(c, t) - Object.keys(ocupDe(c.id, S.dia, t.id)).length;
    const choca = Object.values(S.mis || {}).filter(m => m.fecha === S.dia && m.estado !== 'rechazado' && !(m.cid === c.id && m.tid === t.id) && minutos(m.desde) < minutos(t.hasta) && minutos(t.desde) < minutos(m.hasta));
    const avisoChoca = choca.length ? `<div class="aviso-mapa choca">${I('alert', 'width:16px;height:16px;flex-shrink:0;margin-top:2px')}<span><b>Se superpone con otro turno tuyo</b>${choca.map(m => `${esc(m.desde)} a ${esc(m.hasta)} · ${esc((((S.campanas[m.cid] || {}).puntos || {})[m.punto] || {}).nombre || '')}`).join('; ')}. Si igual querés este, después cancelá el otro desde Mis turnos.</span></div>` : '';
    const ov = sheet(`<h3>Confirmá tu turno</h3><p class="hint">Un coordinador lo revisa y te confirma.</p>${avisoChoca}
      <div class="sum"><div>${I('cal')}${esc(cap(fmtDia(S.dia)))}</div><div>${I('clock')}<span class="num">${esc(t.desde)} – ${esc(t.hasta)}</span><small>${libres === 1 ? 'Queda 1 lugar' : `Quedan ${libres} lugares`}</small></div><div>${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin')}${esc(p.nombre)} · ${esc(c.nombre)}</div></div>
      <div class="two"><div class="fld"><label for="pNom">Nombre</label><input id="pNom" autocomplete="given-name" value="${esc(pf.nombre || (S.user.displayName || '').split(' ')[0] || '')}"></div>
      <div class="fld"><label for="pApe">Apellido</label><input id="pApe" autocomplete="family-name" value="${esc(pf.apellido || (S.user.displayName || '').split(' ').slice(1).join(' ') || '')}"></div></div>
      <div class="fld"><label for="pCong">Congregación</label><select id="pCong">${congs.length ? '<option value="">Elegí tu congregación</option>' : ''}${opts}</select></div>
      <div class="fld${pf.congregacion && !congs.includes(pf.congregacion) ? '' : ' hidden'}" id="pOtraF"><label for="pOtra">¿Cuál?</label><input id="pOtra" value="${esc(pf.congregacion && !congs.includes(pf.congregacion) ? pf.congregacion : '')}" placeholder="Nombre de tu congregación y ciudad"></div>
      <div class="fld"><label for="pCel">Celular (WhatsApp)</label><input id="pCel" type="tel" autocomplete="tel" value="${esc(pf.celular || '')}" placeholder="343 555-0000"><small class="celok" id="pCelOk"></small></div>
      ${notaCampo('')}
      <label class="ck"><input type="checkbox" id="pOk"${pf.acepto ? ' checked' : ''}> <span>Solo los coordinadores de esta campaña ven mis datos, para organizar los turnos. <a href="#" data-priv>Más info</a></span></label>
      <p class="err hidden" id="pErr"></p>
      <button type="button" class="btn" id="pGo">Anotarme en este turno</button><button type="button" class="btn alt" data-cerrar>Cancelar</button><p class="fine">Tus datos quedan guardados en este celular para la próxima vez.</p>`);
    const q = (s) => ov.querySelector(s);
    bindNota(ov);
    q('#pCong').addEventListener('change', () => q('#pOtraF').classList.toggle('hidden', q('#pCong').value !== '__otra'));
    q('[data-priv]').addEventListener('click', (e) => { e.preventDefault(); privacidad(); });
    bindCel(q('#pCel'), q('#pCelOk'));
    q('#pGo').addEventListener('click', async () => {
      const nombre = q('#pNom').value.trim(), apellido = q('#pApe').value.trim(), cel = normCel(q('#pCel').value), celular = cel.ok ? cel.txt : q('#pCel').value.trim();
      const nota = q('#pNota').value.trim().slice(0, NOTA_MAX);
      const congregacion = q('#pCong').value === '__otra' ? q('#pOtra').value.trim() : q('#pCong').value;
      const err = (m) => { q('#pErr').textContent = m; q('#pErr').classList.remove('hidden'); };
      if (!nombre || !apellido) return err('Completá tu nombre y apellido.');
      if (!congregacion) return err('Elegí tu congregación.');
      if (!cel.ok) return err(cel.vacio ? 'Escribí tu celular con característica (por ejemplo 343 555-0000).' : CEL_ERR);
      if (!q('#pOk').checked) return err('Para pedir el turno tenés que aceptar que los coordinadores vean tus datos.');
      guardarPerfil({ nombre, apellido, congregacion, celular, acepto: true });
      const b = q('#pGo'); b.disabled = true; b.textContent = 'Enviando…';
      try {
        await conTiempo(enviarPedido(c, t, S.dia, { nombre, apellido, congregacion, celular, nota }));
        ov.remove();
        const pid = cupoId(c.id, S.dia, t.id) + '__' + S.user.uid;
        sheet(`<div class="ok-big"><div class="o">${I('check', 'width:30px;height:30px;stroke-width:2.6')}</div><h3>¡Listo! Te anotaste</h3><p>${esc(cap(fmtDia(S.dia)))} · ${esc(t.desde)} a ${esc(t.hasta)} · ${esc(p.nombre)}</p><p><span class="tag pendiente">Esperando confirmación</span><br>Cuando un coordinador lo confirme lo vas a ver en el inicio y en Mis turnos.</p></div><div class="okacts"><button type="button" class="sbtn" data-ics="${esc(pid)}">${I('cal', 'width:16px;height:16px')}Agendar</button><button type="button" class="sbtn" data-comp="${esc(pid)}">${I('share', 'width:16px;height:16px')}Compartir</button><button type="button" class="sbtn" data-invitar="${esc(pid)}">${I('chat', 'width:16px;height:16px')}Invitar</button></div><button type="button" class="btn" data-go="#/t/${esc(pid)}" data-cerrar>Ver mi turno</button><button type="button" class="btn alt" data-cerrar>Listo</button>`);
      } catch (e) {
        if (e && e.code === 'sin-respuesta') { ov.remove(); sheet(`<h3>Todavía no hay respuesta</h3><p class="hint">Parece que hay poca señal. Tu pedido queda guardado en este celular y se manda solo cuando vuelva la conexión.</p><p class="hint">Fijate en <b>Mis turnos</b> en un rato: si aparece "Esperando confirmación", llegó bien.</p><button type="button" class="btn" data-cerrar>Entendido</button>`); return; }
        console.error(e); b.disabled = false; b.textContent = 'Anotarme en este turno';
        err(/permission|insufficient/i.test(e && (e.code || e.message) || '') ? 'Ese turno se acaba de completar. Elegí otro.' : 'No se pudo enviar. Revisá la conexión y probá de nuevo.');
      }
    });
  }
  // Sin señal, Firebase guarda el envío y lo manda solo cuando vuelve la conexión: no esperamos para siempre
  const SIN_RESPUESTA = 15000;
  const conTiempo = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('sin respuesta'), { code: 'sin-respuesta' })), SIN_RESPUESTA))]);
  async function enviarPedido(c, t, fecha, datos) {
    const u = S.user, id = cupoId(c.id, fecha, t.id);
    const batch = S.db.batch();
    batch.set(S.db.doc('cupos/' + id), { cid: c.id, fecha, tid: t.id, ocupados: { [u.uid]: 'p' } }, { merge: true });
    batch.set(S.db.doc('pedidos/' + id + '__' + u.uid), {
      cid: c.id, fecha, tid: t.id, punto: t.punto, desde: t.desde, hasta: t.hasta, uid: u.uid, email: u.email.toLowerCase(),
      nombre: datos.nombre.slice(0, 60), apellido: datos.apellido.slice(0, 60), congregacion: datos.congregacion.slice(0, 80), celular: datos.celular.slice(0, 30),
      estado: 'pendiente', creado: new Date().toISOString(), ...(datos.nota ? { nota: String(datos.nota).slice(0, NOTA_MAX) } : {})
    });
    await batch.commit();
  }
  function cancelarPedido(pid) {
    const p = S.mis[pid]; if (!p) return;
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {};
    const ov = sheet(`<h3>¿Cancelar este turno?</h3><p class="hint">Se libera el lugar para otro publicador y se borran tus datos de contacto de ese turno. En el historial de la campaña queda que cancelaste.</p>
      <div class="sum"><div><b>${esc(cap(fmtDia(p.fecha)))} · ${esc(p.desde)} a ${esc(p.hasta)}</b></div><div style="color:var(--ink3)">${esc([c.nombre, pt.nombre, c.ciudad].filter(Boolean).join(' · '))}</div></div>
      <button type="button" class="btn danger" id="cxOk">Sí, cancelar el turno</button><button type="button" class="btn alt" data-cerrar>No, mantenerlo</button>`);
    ov.querySelector('#cxOk').addEventListener('click', async () => {
      const b = ov.querySelector('#cxOk'); b.disabled = true; b.textContent = 'Cancelando…';
      const batch = S.db.batch();
      batch.update(S.db.doc('cupos/' + cupoId(p.cid, p.fecha, p.tid)), { ['ocupados.' + p.uid]: S.del() });
      batch.delete(S.db.doc('pedidos/' + pid));
      // la línea del historial va en el mismo envío: las reglas solo la aceptan si de verdad se borra el pedido
      batch.set(S.db.collection('auditoria').doc(Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), { cid: p.cid, tipo: 'cancelo', texto: ('canceló su turno: ' + pTxt(c, p)).slice(0, 400), por: S.user.email.toLowerCase(), uid: S.user.uid, at: S.ahora(), ref: pid });
      try { await conTiempo(batch.commit()); ov.remove(); toast('Turno cancelado'); if (S.route.name === 'turno') go('#/mis'); }
      catch (e) { if (e && e.code === 'sin-respuesta') { ov.remove(); toast('Hay poca señal: la cancelación se manda sola cuando vuelva la conexión.'); return; } console.error(e); b.disabled = false; b.textContent = 'Sí, cancelar el turno'; toast('No se pudo cancelar. Probá de nuevo.'); }
    });
  }
  S.del = () => (window.__ppamMock ? window.__ppamMock.del() : firebase.firestore.FieldValue.delete());
  S.ahora = () => (window.__ppamMock ? new Date().toISOString() : firebase.firestore.FieldValue.serverTimestamp());
  /* ---------- Historial (auditoría): quién cambió o borró qué y cuándo. Solo se agregan líneas; nadie las edita ---------- */
  function auditar(cid, tipo, texto, extra) {
    if (!S.user) return Promise.resolve();
    const d = Object.assign({ cid: cid || '', tipo, texto: String(texto).slice(0, 400), por: S.user.email.toLowerCase(), uid: S.user.uid, at: S.ahora() }, extra || {});
    return S.db.collection('auditoria').doc(Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).set(d).catch(e => console.error('auditoria', e));
  }
  const difTxt = (a, b) => { const mas = b.filter(x => !a.includes(x)), menos = a.filter(x => !b.includes(x)); return (mas.length ? ': agregó ' + mas.join(', ') : '') + (menos.length ? (mas.length ? '; sacó ' : ': sacó ') + menos.join(', ') : ''); };
  const tTxt = (c, t) => `${fmtHora(t.desde)}–${fmtHora(t.hasta)} del ${((c.puntos || {})[t.punto] || {}).nombre || 'punto'}`;
  const dTxt = (ds) => (ds || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DOW[d]).join(', ');
  const fTxt = (f) => { const x = parseIso(f); return `${DOW[x.getDay()]} ${x.getDate()}/${x.getMonth() + 1}`; };
  const pTxt = (c, p) => `${p.nombre} ${p.apellido} · ${fTxt(p.fecha)} ${fmtHora(p.desde)}–${fmtHora(p.hasta)} · ${((c.puntos || {})[p.punto] || {}).nombre || ''}`;

  /* ---------- Mis turnos ---------- */
  function renderMis() {
    if (!S.user) { $('app').innerHTML = '<div class="welcome"><h4>Tus turnos</h4><p>Ingresá con tu cuenta de Google para ver los turnos que pediste.</p><button type="button" class="btn p" data-login>Ingresar con Google</button></div>'; return; }
    if (S.misErr && !Object.keys(S.mis).length) { $('app').innerHTML = '<div class="empty carga-err"><b>No pudimos cargar tus turnos.</b><br>Revisá la conexión y probá de nuevo.</div><button type="button" class="btn" id="misRe">Reintentar</button>'; $('misRe').addEventListener('click', () => { S.misErr = false; onUser(S.user); }); return; }
    const ahora = new Date(), m = ahora.getHours() * 60 + ahora.getMinutes(), h0 = hoy(), mes = h0.slice(0, 7);
    const hecho = (p) => p.fecha < h0 || (p.fecha === h0 && minutos(p.hasta) <= m);
    const all = Object.keys(S.mis).map(id => Object.assign({ id }, S.mis[id])).sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
    const deHoy = all.filter(p => !hecho(p) && p.fecha === h0 && p.estado !== 'rechazado');
    const prox = all.filter(p => !hecho(p) && (p.fecha > h0 || p.estado === 'rechazado') && !deHoy.includes(p));
    const pas = all.filter(hecho).reverse();
    let mesRef = mes, delMes = all.filter(p => p.fecha.slice(0, 7) === mes && p.estado !== 'rechazado');
    if (!delMes.length) { const sig = all.find(p => !hecho(p) && p.estado !== 'rechazado'); if (sig) { mesRef = sig.fecha.slice(0, 7); delMes = all.filter(p => p.fecha.slice(0, 7) === mesRef && p.estado !== 'rechazado'); } }
    const cualMes = mesRef === mes ? 'este mes' : 'en ' + MES[+mesRef.slice(5, 7) - 1];
    const horas = delMes.reduce((a, p) => a + Math.max(0, minutos(p.hasta) - minutos(p.desde)), 0) / 60;
    const porConf = all.filter(p => !hecho(p) && p.estado === 'pendiente').length;
    let h = '';
    if (all.length) h += `<div class="stat"><div class="g"><b class="num">${delMes.length}</b><small>${delMes.length === 1 ? 'turno' : 'turnos'} ${cualMes}</small></div><div><b class="num">${Number.isInteger(horas) ? horas : horas.toFixed(1).replace('.', ',')} h</b><small>de predicación</small></div><div><b class="num">${porConf}</b><small>por confirmar</small></div></div>`;
    if (deHoy.length) h += '<div class="lbl">Hoy</div>' + deHoy.map(p => misCard(p, 'hoy')).join('');
    if (prox.length) h += `<div class="lbl sp">Próximos <span>${prox.length}</span></div>` + prox.map(p => misCard(p, '')).join('');
    if (!deHoy.length && !prox.length) h += '<div class="welcome"><h4>No tenés turnos por delante</h4><p>Elegí una campaña y anotate en un horario libre.</p><button type="button" class="btn p" data-go="#/">Ver campañas</button></div>';
    if (pas.length) {
      const hechosMes = pas.filter(p => p.estado === 'confirmado' && p.fecha.slice(0, 7) === mes).length;
      h += `<div class="lbl sp">Realizados <span>${esc(cap(MES[parseIso(pas[0].fecha).getMonth()]))}</span></div>` + pas.slice(0, 20).map(p => misCard(p, 'done')).join('');
      if (hechosMes) h += `<div class="thanks">${I('star')}<span><b>¡Gracias por participar!</b><br>${hechosMes === 1 ? 'Ya hiciste 1 turno este mes.' : `Ya hiciste ${hechosMes} turnos este mes.`}</span></div>`;
    }
    if (deHoy.length || prox.length) h += `<button type="button" class="cta2" data-go="#/">${I('plus')}Anotarme en otro turno</button>`;
    $('app').innerHTML = h;
  }
  function misCard(p, modo) {
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, d = parseIso(p.fecha);
    const rech = p.estado === 'rechazado', conf = p.estado === 'confirmado', done = modo === 'done';
    const url = !done && !rech && pt.nombre ? comoLlegarUrl(pt, c) : '';
    const foto = (pt.fotos || [])[0];
    const chip = done ? (conf ? `<span class="chip dn">${I('check')}Hecho</span>` : `<span class="chip dn">${rech ? 'No confirmado' : 'Sin confirmar'}</span>`)
      : `<span class="chip ${conf ? 'ok' : rech ? 'rj' : 'pe'}"><i></i>${esc(ESTADOS[p.estado] || p.estado)}</span>`;
    let acts = '';
    if (url) acts += `<a class="go" href="${esc(url)}" target="_blank" rel="noopener">${I('nav')}Cómo llegar</a>`;
    acts += `<button type="button" class="sbtn" data-go="#/t/${esc(p.id)}">Detalle</button>`;
    if (!done && !rech) acts += `<button type="button" class="sbtn bad" data-cancelar="${esc(p.id)}">Cancelar</button>`;
    return `<div class="tc ${modo}"><div class="tcl"><div class="cal ${done ? 'd' : conf ? '' : 'p'}"><small>${DOW[d.getDay()]}</small><b class="num">${d.getDate()}</b><i>${MES[d.getMonth()].slice(0, 3)}</i></div>${foto ? `<div class="thumb"${fotoAttr(p.cid, foto)}></div>` : ''}</div><div class="bd">${modo === 'hoy' ? `<span class="hoyb">${I('clock')}${esc(cuandoTexto(p).replace(/^Hoy · /, ''))}</span>` : ''}<div class="h num">${esc(p.desde)} – ${esc(p.hasta)}</div><div class="m">${I(pt.tipo === 'carrito' ? 'cart' : pt.tipo === 'stand' ? 'stand' : 'pin')}<span>${esc([c.nombre, pt.nombre, c.ciudad].filter(Boolean).join(' · '))}</span></div><div class="st1">${chip}</div></div><div class="acts3">${acts}</div></div>`;
  }
  function renderTurno() {
    if (!S.user) { $('app').innerHTML = '<div class="welcome"><h4>Tu turno</h4><p>Ingresá con tu cuenta para ver el detalle.</p><button type="button" class="btn p" data-login>Ingresar con Google</button></div>'; return; }
    const pid = S.route.pid, p = S.mis[pid] && Object.assign({ id: pid }, S.mis[pid]);
    if (!p) { $('app').innerHTML = '<div class="card"><div class="empty">Ese turno ya no está en tu lista.</div></div><button type="button" class="btn" data-go="#/mis">Ver mis turnos</button>'; return; }
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, conf = p.estado === 'confirmado', rech = p.estado === 'rechazado';
    const url = rech ? '' : comoLlegarUrl(pt, c), d = parseIso(p.fecha), pasado = p.fecha < hoy();
    let h = pt.lat != null ? mapaLugar(pt, c, 'big')
      : `<div class="mapa big foto"${fotoAttr(p.cid, (pt.fotos || [])[0], `background-image:${colorDe(c.id ? c : { id: p.cid })};`)}></div>`;
    h += `<div class="det"><div class="st ${esc(p.estado)}"><i></i>${conf ? 'Confirmado por un coordinador' : rech ? 'No fue confirmado' : 'Esperando confirmación'}${!conf && !rech ? ' <a class="qhelp" href="#/ayuda/espera">¿Qué significa?</a>' : ''}</div>`;
    h += `<h2>${esc(cap(DOW_L[d.getDay()]))} ${d.getDate()} de ${MES[d.getMonth()]} · <span class="num">${esc(p.desde)} a ${esc(p.hasta)}</span></h2>`;
    h += `<div class="m">${esc([c.nombre, pt.nombre, pt.direccion].filter(Boolean).join(' · '))}</div>`;
    if (!rech) h += `<div class="tl"><span class="ok"><span class="dot">${I('check')}</span>Pedido</span><span class="ln on"></span><span class="${conf ? 'ok' : ''}"><span class="dot">${conf ? I('check') : ''}</span>Confirmado</span><span class="ln${pasado ? ' on' : ''}"></span><span class="${pasado ? 'ok' : ''}"><span class="dot">${pasado ? I('check') : ''}</span>El día</span></div>`;
    h += '<div class="grid4">';
    h += url ? `<a class="pr" href="${esc(url)}" target="_blank" rel="noopener">${I('nav')}Llegar</a>` : `<button type="button" disabled>${I('nav')}Llegar</button>`;
    h += `<button type="button" data-ics="${esc(p.id)}">${I('cal')}Agendar</button><button type="button" data-comp="${esc(p.id)}">${I('share')}Compartir</button>`;
    h += !rech && !pasado ? `<button type="button" data-cancelar="${esc(p.id)}">${I('x')}Cancelar</button>` : `<button type="button" disabled>${I('x')}Cancelar</button>`;
    h += '</div>';
    if (!rech && !pasado) h += `<button type="button" class="btn alt inv" data-invitar="${esc(p.id)}">${I('chat')}Invitar a alguien a este turno</button>`;
    if (!rech && !pasado) h += `<div class="info nota-info"><b>Nota para el coordinador</b><p>${p.nota ? esc(p.nota) : '<span class="faint">Sin nota.</span>'}</p><button type="button" class="sbtn" data-nota="${esc(p.id)}">${I('edit', 'width:15px;height:15px')}${p.nota ? 'Cambiar' : 'Agregar una nota'}</button></div>`;
    else if (p.nota) h += `<div class="info"><b>Nota para el coordinador</b><p>${esc(p.nota)}</p></div>`;
    if (pt.indicaciones) h += `<div class="info"><b>Cómo encontrarlo</b><p>${esc(pt.indicaciones)}</p></div>`;
    if (pt.retiro) h += `<div class="info"><b>${esc(retiroLabel(pt))}</b><p>${esc(pt.retiro)}</p></div>`;
    if (tieneLugar(pt)) h += `<button type="button" class="btn alt" data-lugar="${esc(p.cid)}|${esc(p.punto)}">${I('pin')}Ver fotos y datos del lugar</button>`;
    h += '</div>';
    $('app').innerHTML = h;
  }
  // "Anotate conmigo": link directo a ese turno (se abre listo para anotarse); no muestra datos de nadie
  function invitarTurno(pid) {
    const p = S.mis[pid]; if (!p) return;
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {};
    const link = location.origin + location.pathname + '#/c/' + p.cid + '/' + p.fecha + '/' + encodeURIComponent(p.tid);
    const txt = `Me anoté en la PPAM: ${cap(fmtDia(p.fecha))} de ${p.desde} a ${p.hasta} · ${pt.nombre || ''} (${c.nombre || ''}${c.ciudad ? ', ' + c.ciudad : ''}). ¿Venís conmigo? Anotate acá: ${link}`;
    compartir(txt);
  }
  function textoTurno(p) {
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, url = comoLlegarUrl(pt, c);
    return `Tengo turno en la PPAM: ${cap(fmtDia(p.fecha))} de ${p.desde} a ${p.hasta} · ${pt.nombre || ''} (${c.nombre || ''}${c.ciudad ? ', ' + c.ciudad : ''}).${url ? '\nCómo llegar: ' + url : ''}`;
  }
  function agendar(pid) {
    const p = S.mis[pid]; if (!p) return;
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {};
    const f = p.fecha.replace(/-/g, ''), hh = (x) => x.replace(':', '') + '00', ahora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const escIcs = (x) => String(x || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PPAM Entre Rios//ES', 'BEGIN:VEVENT', `UID:${pid}@ppam-entre-rios`, `DTSTAMP:${ahora}`,
      `DTSTART:${f}T${hh(p.desde)}`, `DTEND:${f}T${hh(p.hasta)}`, `SUMMARY:${escIcs('PPAM · ' + (pt.nombre || '') + ' (' + (c.nombre || '') + ')')}`,
      `LOCATION:${escIcs([pt.direccion, c.nombre, c.ciudad].filter(Boolean).join(', '))}`, `DESCRIPTION:${escIcs([pt.indicaciones, pt.retiro && retiroLabel(pt) + ': ' + pt.retiro].filter(Boolean).join('\n'))}`,
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Turno PPAM', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    S.ultimoIcs = ics;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'turno-ppam-' + p.fecha + '.ics';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function compartirTurno(pid) {
    const p = S.mis[pid]; if (!p) return;
    const txt = textoTurno(p);
    if (navigator.share && !window.__ppamMock) { try { await navigator.share({ title: 'Mi turno PPAM', text: txt }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    compartir(txt);
  }

  /* ---------- Coordinación ---------- */
  function misCampanas() { return Object.values(S.campanas).filter(c => S.isAdmin || S.coordDe.includes(c.id)).sort((a, b) => String(b.desde || '').localeCompare(String(a.desde || ''))); }
  function listenCoord(cid) {
    if (S.coord.cid === cid) return;
    S.coord.unsub.forEach(f => f()); S.coord.unsub = []; S.coord.cid = cid; S.coord.pedidos = {}; S.coord.cupos = {};
    S.coord.unsub.push(S.db.collection('pedidos').where('cid', '==', cid).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.coord.pedidos = o; if (S.route.name === 'coord') refrescar(renderCoord); }, (e) => console.error(e)));
    S.coord.aud = {};
    S.coord.unsub.push(S.db.collection('auditoria').where('cid', '==', cid).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.coord.aud = o; if (S.route.name === 'coord' && S.coord.tab === 'config' && S.coord.aj === 'hist') refrescar(renderCoord); }, () => {}));
    S.coord.unsub.push(S.db.collection('cupos').where('cid', '==', cid).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.coord.cupos = o; if (S.route.name === 'coord') refrescar(renderCoord); }, (e) => console.error(e)));
  }
  function renderCoord() {
    if (!S.user) { $('app').innerHTML = '<div class="empty">Iniciá sesión para coordinar.</div><button type="button" class="btn" data-login>Iniciar sesión con Google</button>'; return; }
    const mias = misCampanas();
    if (!S.route.cid) {
      if (mias.length === 1 && !S.isAdmin && !S.isSoporte) { go('#/coord/' + mias[0].id); return; }
      if (!mias.length && !S.isAdmin && S.isSoporte) { go('#/soporte'); return; }
      let h = S.isSoporte && !S.isAdmin ? `<button type="button" class="coordbar" data-go="#/soporte"><span class="n">${I('alert', 'width:15px;height:15px')}</span><span class="tx">Reportes y errores<small>Equipo de soporte</small></span>${I('chev')}</button>` : '';
      h += S.isAdmin ? `<button type="button" class="coordbar" data-go="#/admin"><span class="n">${I('grid', 'width:15px;height:15px')}</span><span class="tx">Administración<small>Campañas, coordinadores y congregaciones</small></span>${I('chev')}</button><div class="sec">Campañas</div>` : '';
      h += !mias.length && !S.isAdmin && S.isSoporte ? '' : mias.length ? mias.map(c => `<button type="button" class="cc camp" data-go="#/coord/${esc(c.id)}"><span class="th"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}></span><span class="tx"><b>${esc(c.nombre)}</b><small>${esc(c.ciudad || '')} · ${esc(campRango(c))}</small></span>${I('chev')}</button>`).join('') : '<div class="card"><div class="empty">No coordinás ninguna campaña todavía.</div></div>';
      $('app').innerHTML = h; return;
    }
    const c = S.campanas[S.route.cid];
    if (!c || !(S.isAdmin || S.coordDe.includes(c.id))) { $('app').innerHTML = '<div class="empty">No coordinás esa campaña.</div>'; return; }
    listenCoord(c.id);
    const peds = Object.keys(S.coord.pedidos).map(id => Object.assign({ id }, S.coord.pedidos[id]));
    const pend = peds.filter(p => p.estado === 'pendiente' && p.fecha >= hoy()).sort((a, b) => String(a.creado).localeCompare(String(b.creado)));
    const dias = diasDe(c);
    let total = 0, ocup = 0;
    dias.forEach(d => turnosDelDia(c, d).forEach(t => { total += cupoDe(c, t); ocup += Math.min(cupoDe(c, t), Object.values((S.coord.cupos[cupoId(c.id, d, t.id)] || {}).ocupados || {}).filter(v => v === 'c').length); }));
    const personas = new Set(peds.filter(p => p.estado === 'confirmado').map(p => p.uid)).size;
    let h = `<div class="kpis"><div class="kpi hl"><b class="num">${pend.length}</b><span>por confirmar</span></div><div class="kpi"><b class="num">${total ? Math.round(ocup * 100 / total) : 0}%</b><span>cubierto de hoy al ${esc(c.hasta ? parseIso(c.hasta).getDate() + ' ' + MES[parseIso(c.hasta).getMonth()].slice(0, 3) : 'final')}</span></div><div class="kpi"><b class="num">${personas}</b><span>${personas === 1 ? 'hermano confirmado' : 'hermanos confirmados'}</span></div></div>`;
    const tabs = [['pedidos', 'Pedidos'], ['cobertura', 'Cobertura'], ['dia', 'Del día'], ['config', 'Ajustes']];
    h += `<div id="cTab"><div class="tabs">${tabs.map(([k, l]) => `<button type="button" class="${S.coord.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
    if (S.coord.tab === 'pedidos') h += guiaCoord() + coordPedidos(c, pend, peds);
    else if (S.coord.tab === 'cobertura') h += coordCobertura(c, dias);
    else if (S.coord.tab === 'dia') h += coordDia(c, dias, peds);
    else h += coordConfig(c);
    $('app').innerHTML = h + '</div>';
    if (S.coord.tab === 'config') bindConfig(c);
    if (S.coord.flash) { const e = document.getElementById(S.coord.flash); if (e) { e.scrollIntoView({ block: 'center' }); e.classList.add('flash'); S.coord.flashV = [S.coord.flash, Date.now() + 2500]; S.coord.flash = null; } }
    else if (S.coord.flashV && Date.now() < S.coord.flashV[1]) { const e = document.getElementById(S.coord.flashV[0]); if (e) e.classList.add('flash'); }
  }
  /* ---------- Lupa para hermanos: lugares, días y horarios con lugar (nunca personas) ---------- */
  function campsPub() { return Object.values(S.campanas).filter(c => c.activa !== false && (!c.hasta || c.hasta >= hoy())); }
  function pubFila(c, d, t) {
    const p = (c.puntos || {})[t.punto] || {}, oc = ocupDe(c.id, d, t.id), n = cupoDe(c, t), falta = Math.max(0, n - Object.keys(oc).length), mio = S.user && oc[S.user.uid], x = parseIso(d);
    return `<button type="button" class="bsr" data-bpedir="${esc(c.id)}|${d}|${esc(t.id)}"${!mio && !falta ? ' disabled' : ''}><span class="f"><small>${DOW[x.getDay()]}</small><b class="num">${x.getDate()}</b><small>${MES[x.getMonth()].slice(0, 3)}</small></span><span class="tx"><b class="num">${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} · ${esc(p.nombre || '')}</b><small>${esc(c.nombre)}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</small></span><span class="st ${mio ? 'ok' : falta ? 'lib' : ''}">${mio ? 'Tu turno' : falta ? (falta === 1 ? 'Queda 1' : 'Quedan ' + falta) : 'Completo'}</span></button>`;
  }
  const libre = (c, d, t) => { if (yaEmpezo(d, t)) return false; const oc = ocupDe(c.id, d, t.id); return Object.keys(oc).length < cupoDe(c, t) && !(S.user && oc[S.user.uid]); };
  function pubAtajo(k) {
    const d = k === 'hoy' ? hoy() : addDays(hoy(), 1), filas = [];
    campsPub().forEach(c => { listenCC(c.id); if (diasDe(c).includes(d)) turnosDelDia(c, d).filter(t => libre(c, d, t)).forEach(t => filas.push([c, t])); });
    filas.sort((a, b) => a[1].desde.localeCompare(b[1].desde));
    return `<div class="bsg">Con lugar ${k === 'hoy' ? 'hoy' : 'mañana'} · ${esc(cap(fmtDia(d)))}</div>` + (filas.length ? filas.slice(0, 30).map(([c, t]) => pubFila(c, d, t)).join('') : '<div class="bs0">No quedan lugares ese día.</div>');
  }
  function pubResultados(q0) {
    const q = sinTilde(q0), cs = campsPub(); if (q.length < 2) return '';
    cs.forEach(c => listenCC(c.id));
    let h = '';
    const camps = cs.filter(c => sinTilde(c.nombre + ' ' + (c.ciudad || '') + ' ' + (c.lugar || '')).includes(q));
    if (camps.length) h += `<div class="bsg">Campañas</div>` + camps.slice(0, 8).map(c => `<button type="button" class="bsr" data-go="#/c/${esc(c.id)}"><span class="th"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}></span><span class="tx"><b>${esc(c.nombre)}</b><small>${esc(c.ciudad || '')} · ${esc(campRango(c))}</small></span>${I('chev')}</button>`).join('');
    const pts = []; cs.forEach(c => Object.keys(c.puntos || {}).forEach(pid => { const p = c.puntos[pid]; if (sinTilde([p.nombre, p.detalle, p.direccion].join(' ')).includes(q)) pts.push([c, pid, p]); }));
    pts.slice(0, 6).forEach(([c, pid, p]) => {
      const filas = []; diasDe(c).forEach(d => turnosDelDia(c, d).filter(t => t.punto === pid && libre(c, d, t)).forEach(t => filas.push([d, t])));
      h += `<div class="bsg">${esc(p.nombre)} · ${esc(c.nombre)}</div>` + (filas.length ? filas.slice(0, 6).map(([d, t]) => pubFila(c, d, t)).join('') + (filas.length > 6 ? `<button type="button" class="linkish bsnl" data-go="#/c/${esc(c.id)}">Ver todos sus horarios</button>` : '') : '<div class="bs0">Sin lugares libres en este punto.</div>');
    });
    let filas = [];
    const mh = q.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*hs?)?$/), dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'], dw = dias.findIndex(x => x.startsWith(q) && q.length >= 3);
    if (mh) { const hh = String(mh[1]).padStart(2, '0') + (mh[2] ? ':' + mh[2] : ''); cs.forEach(c => diasDe(c).slice(0, 7).forEach(d => turnosDelDia(c, d).filter(t => t.desde.startsWith(hh) && libre(c, d, t)).forEach(t => filas.push([c, d, t])))); }
    else if (dw >= 0 || q === 'hoy' || q === 'manana') cs.forEach(c => { const d = q === 'hoy' ? hoy() : q === 'manana' ? addDays(hoy(), 1) : diasDe(c).find(x => dowOf(x) === dw); if (d && diasDe(c).includes(d)) turnosDelDia(c, d).filter(t => libre(c, d, t)).forEach(t => filas.push([c, d, t])); });
    filas.sort((a, b) => (a[1] + a[2].desde).localeCompare(b[1] + b[2].desde));
    if (filas.length) h += `<div class="bsg">Con lugar</div>` + filas.slice(0, 20).map(([c, d, t]) => pubFila(c, d, t)).join('');
    return h || `<div class="bs0">No encontramos lugares con “${esc(q0.trim())}”. Probá con un carrito, una ciudad, un día (sábado) o un horario (8:30).</div>`;
  }
  function irAPedir(cid, d, tid) {
    S.dia = d; S.diaCid = cid;
    const h = '#/c/' + cid;
    if (location.hash === h) { readRoute(); render(); pedir(tid); return; }
    window.addEventListener('hashchange', () => setTimeout(() => pedir(tid), 0), { once: true });
    location.hash = h;
  }
  function abrirBuscadorPub() {
    const ov = document.createElement('div'); ov.className = 'bsov';
    ov.innerHTML = `<div class="bsbox" aria-label="Buscar lugares, días u horarios"><div class="bsin">${I('search')}<input id="bsQ" type="search" placeholder="Buscar lugar, día u horario" aria-label="Buscar lugar, día u horario" autocomplete="off" enterkeyhint="search"><button type="button" class="bsx" data-bscerrar aria-label="Cerrar">Cerrar</button></div><div class="bsres" id="bsR"></div></div>`;
    document.body.appendChild(ov); modal(ov, ov.querySelector('.bsbox'));
    const inp = ov.querySelector('#bsQ'), res = ov.querySelector('#bsR');
    let atajo = null, timer = null;
    const pinta = () => {
      const q = inp.value;
      if (q.trim().length >= 2) { atajo = null; res.innerHTML = pubResultados(q); return; }
      const rec = busRecientes();
      res.innerHTML = `<div class="bsch"><button type="button" data-bsat="hoy" class="${atajo === 'hoy' ? 'on' : ''}">Con lugar hoy</button><button type="button" data-bsat="man" class="${atajo === 'man' ? 'on' : ''}">Con lugar mañana</button></div>` +
        (atajo ? pubAtajo(atajo) : (rec.length ? `<div class="bsg">Búsquedas recientes</div>${rec.map(r => `<button type="button" class="bsrec" data-bsrec="${esc(r)}">${I('clock', 'width:15px;height:15px')}${esc(r)}</button>`).join('')}` : '<div class="bs0">Escribí un carrito o lugar, una ciudad, un día (sábado) o un horario (8:30).</div>'));
    };
    pinta(); setTimeout(() => inp.focus(), 50);
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(pinta, 120); });
    const cerrar = () => ov.remove();
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) { if (e.target === ov) cerrar(); return; }
      const d = b.dataset;
      if (d.bscerrar !== undefined) { cerrar(); return; }
      if (d.bsat) { atajo = atajo === d.bsat ? null : d.bsat; pinta(); return; }
      if (d.bsrec) { inp.value = d.bsrec; pinta(); return; }
      if (d.bpedir) { e.stopPropagation(); busGuardar(inp.value); const [cid, f, tid] = d.bpedir.split('|'); cerrar(); const c = S.campanas[cid]; if (c && S.user && ocupDe(cid, f, tid)[S.user.uid]) { go('#/mis'); return; } irAPedir(cid, f, tid); return; }
      if (d.go) { busGuardar(inp.value); cerrar(); }
    });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
  }
  /* ---------- Buscador de coordinación (lupa arriba): hermanos, campañas, puntos y turnos de las campañas que coordina ---------- */
  S.bus = { t: 0, peds: {}, cupos: {}, cargando: null };
  function cargarBusqueda() {
    const cs = misCampanas().filter(c => !c.hasta || c.hasta >= isoOf(new Date(Date.now() - 30 * 864e5)));
    if (S.bus.cargando) return S.bus.cargando;
    if (Date.now() - S.bus.t < 5 * 60e3) return Promise.resolve();
    S.bus.err = false;
    S.bus.cargando = Promise.all(cs.map(c => Promise.all([S.db.collection('pedidos').where('cid', '==', c.id).get(), S.db.collection('cupos').where('cid', '==', c.id).get()]).then(([qp, qc]) => {
      const a = []; qp.forEach(d => a.push(Object.assign({ id: d.id }, d.data()))); S.bus.peds[c.id] = a;
      const o = {}; qc.forEach(d => { o[d.id] = d.data(); }); S.bus.cupos[c.id] = o;
    }).catch(e => { console.error(e); S.bus.err = true; }))).then(() => { if (!S.bus.err) S.bus.t = Date.now(); S.bus.cargando = null; });
    return S.bus.cargando;
  }
  const busPeds = (cid) => S.coord.cid === cid && Object.keys(S.coord.pedidos).length ? Object.keys(S.coord.pedidos).map(id => Object.assign({ id }, S.coord.pedidos[id])) : (S.bus.peds[cid] || []);
  const busCupos = (cid) => S.coord.cid === cid && Object.keys(S.coord.cupos).length ? S.coord.cupos : (S.bus.cupos[cid] || {});
  const sumarDias = (iso, n) => { const x = parseIso(iso); x.setDate(x.getDate() + n); return isoOf(x); };
  function busTurnoFila(c, d, t, extra) {
    const p = (c.puntos || {})[t.punto] || {}, n = cupoDe(c, t), oc = Object.values((busCupos(c.id)[cupoId(c.id, d, t.id)] || {}).ocupados || {}), falta = Math.max(0, n - oc.length), x = parseIso(d);
    return `<button type="button" class="bsr" data-bir="${esc(c.id)}|${d}|${esc(t.id)}"><span class="f"><small>${DOW[x.getDay()]}</small><b class="num">${x.getDate()}</b><small>${MES[x.getMonth()].slice(0, 3)}</small></span><span class="tx"><b class="num">${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} · ${esc(p.nombre || '')}</b><small>${esc(c.nombre)}${extra ? ' · ' + extra : ''}</small></span><span class="st ${falta ? 'fa' : 'ok'}">${falta ? (falta === 1 ? 'Falta 1' : 'Faltan ' + falta) : 'Completo'}</span></button>`;
  }
  function busRecientes() { try { return JSON.parse(localStorage.getItem('ppam-bus-rec') || '[]'); } catch (e) { return []; } }
  function busGuardar(q) { q = q.trim(); if (q.length < 2) return; try { localStorage.setItem('ppam-bus-rec', JSON.stringify([q].concat(busRecientes().filter(x => x !== q)).slice(0, 5))); } catch (e) {} }
  function busAtajo(k) {
    const cs = misCampanas(), hoyS = hoy();
    if (k === 'pend') {
      const ps = []; cs.forEach(c => busPeds(c.id).filter(p => p.estado === 'pendiente' && p.fecha >= hoyS).forEach(p => ps.push([c, p])));
      ps.sort((a, b) => (a[1].fecha + a[1].desde).localeCompare(b[1].fecha + b[1].desde));
      return `<div class="bsg">Por confirmar (${ps.length})</div>` + (ps.length ? ps.map(([c, p]) => busTurnoFila(c, p.fecha, Object.assign({ id: p.tid }, (c.turnos || {})[p.tid] || { punto: p.punto, desde: p.desde, hasta: p.hasta }), esc(p.nombre + ' ' + p.apellido))).join('') : '<div class="bs0">No hay pedidos por confirmar.</div>');
    }
    const d = k === 'hoy' ? hoyS : sumarDias(hoyS, 1), filas = [];
    cs.forEach(c => { if (diasDe(c).includes(d)) turnosDelDia(c, d).filter(t => !yaEmpezo(d, t)).forEach(t => { const oc = Object.values((busCupos(c.id)[cupoId(c.id, d, t.id)] || {}).ocupados || {}); if (oc.length < cupoDe(c, t)) filas.push([c, t]); }); });
    filas.sort((a, b) => a[1].desde.localeCompare(b[1].desde));
    return `<div class="bsg">Faltan ${k === 'hoy' ? 'hoy' : 'mañana'} · ${esc(cap(fmtDia(d)))}</div>` + (filas.length ? filas.map(([c, t]) => `<div class="bsrw">${busTurnoFila(c, d, t)}<button type="button" class="sbtn anot" data-banot="${esc(c.id)}|${d}|${esc(t.id)}">${I('plus', 'width:14px;height:14px')}Anotar</button></div>`).join('') : '<div class="bs0">Todo cubierto.</div>');
  }
  function busResultados(q0) {
    const q = sinTilde(q0), dig = q.replace(/\D/g, ''), cs = misCampanas(), hoyS = hoy();
    if (q.length < 2) return '';
    let h = '';
    // Hermanos (exactos; si no hay y parece un nombre, parecidos y "anotar a alguien nuevo")
    const per = {}, todos = {};
    const okE = (p) => p.estado === 'confirmado' || p.estado === 'pendiente';
    const coincide = (p) => sinTilde(p.nombre + ' ' + p.apellido).includes(q) || sinTilde(p.apellido + ' ' + p.nombre).includes(q) || (dig.length >= 3 && !/[a-z]/.test(q) && String(p.celular || '').replace(/\D/g, '').includes(dig));
    cs.forEach(c => busPeds(c.id).filter(okE).forEach(p => { const k = p.uid || p.nombre + p.apellido; (todos[k] = todos[k] || []).push([c, p]); if (coincide(p)) (per[k] = per[k] || []).push([c, p]); }));
    const diasPal = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'hoy', 'manana'];
    const pareceNombre = /^[a-zñ' .-]{3,}$/.test(q) && !diasPal.some(x => x.startsWith(q)) && !cs.some(c => sinTilde(c.nombre + ' ' + (c.ciudad || '')).includes(q) || Object.values(c.puntos || {}).some(pt => sinTilde([pt.nombre, pt.detalle, pt.direccion].join(' ')).includes(q)));
    let ks = Object.keys(per), parecidos = false;
    if (!ks.length && pareceNombre) {
      const ws = q.split(/\s+/).filter(w => w.length >= 3);
      ks = Object.keys(todos).filter(k => { const p0 = todos[k][0][1], ts = sinTilde(p0.nombre + ' ' + p0.apellido).split(/\s+/); return ws.length && ws.every(w => ts.some(t => lev(w, t) <= (w.length >= 6 ? 2 : 1) || (t.length > 3 && w.startsWith(t.slice(0, Math.max(4, t.length - 1)))))); });
      ks.forEach(k => { per[k] = todos[k]; }); parecidos = ks.length > 0;
    }
    ks.sort((a, b) => (per[a][0][1].nombre + per[a][0][1].apellido).localeCompare(per[b][0][1].nombre + per[b][0][1].apellido));
    S.bus.per = per;
    if (!Object.keys(per).length && pareceNombre || parecidos) h += `<div class="bsnew"><b>No hay nadie con “${esc(q0.trim())}”${parecidos ? '. ¿Es alguno de estos?' : '.'}</b>${parecidos ? '' : '<span>Si no se anotó nunca, lo podés anotar vos.</span>'}<button type="button" class="btn${parecidos ? ' alt' : ''}" data-bnuevo="${esc(q0.trim())}">${I('plus')}${parecidos ? 'No, anotar a alguien nuevo' : 'Anotar a ' + esc(capNombre(q0.trim()))}</button></div>`;
    if (ks.length) h += `<div class="bsg">${parecidos ? 'Parecidos' : 'Hermanos'}</div>` + ks.slice(0, 15).map(k => {
      const l = per[k].sort((a, b) => (a[1].fecha + a[1].desde).localeCompare(b[1].fecha + b[1].desde)), p0 = l[0][1], wa = String(p0.celular || '').replace(/\D/g, ''), varias = new Set(l.map(x => x[0].id)).size > 1;
      return `<div class="bsh"><div class="t"><span class="ini">${esc(iniciales(p0.nombre + ' ' + p0.apellido))}</span><div class="who"><b>${esc(p0.nombre)} ${esc(p0.apellido)}</b><small>${esc(p0.congregacion)} · <span class="num">${esc(p0.celular || '')}</span></small></div>${wa ? `<a class="wa" href="https://wa.me/${wa.length === 10 ? '549' + wa : wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${I('chat')}</a>` : ''}<button type="button" class="sbtn anot" data-bturno="${esc(k)}">${I('plus', 'width:14px;height:14px')}Turno</button></div>${l.map(([c, p]) => { const x = parseIso(p.fecha), pt = (c.puntos || {})[p.punto] || {}, pas = p.fecha < hoyS;
        return `<button type="button" class="bt${pas ? ' pas' : ''}" data-bir="${esc(c.id)}|${esc(p.fecha)}|${esc(p.tid)}"><span class="f"><small>${DOW[x.getDay()]}</small><b class="num">${x.getDate()}</b><small>${MES[x.getMonth()].slice(0, 3)}</small></span><span class="tx"><b class="num">${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))}</b><small>${esc(pt.nombre || '')}${varias || cs.length > 1 ? ' · ' + esc(c.nombre) : ''}</small></span><span class="tag ${p.estado}">${pas ? 'Ya pasó' : p.estado === 'confirmado' ? 'Confirmado' : 'Por confirmar'}</span></button>`; }).join('')}</div>`;
    }).join('');
    if (ks.length && !parecidos && pareceNombre) h += `<button type="button" class="linkish bsnl" data-bnuevo="${esc(q0.trim())}">¿No es ninguno? Anotar a alguien nuevo</button>`;
    // Campañas
    const camps = cs.filter(c => sinTilde(c.nombre + ' ' + (c.ciudad || '') + ' ' + (c.lugar || '')).includes(q));
    if (camps.length) h += `<div class="bsg">Campañas</div>` + camps.slice(0, 8).map(c => `<button type="button" class="bsr" data-go="#/coord/${esc(c.id)}"><span class="th"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}></span><span class="tx"><b>${esc(c.nombre)}</b><small>${esc(c.ciudad || '')} · ${esc(campRango(c))}</small></span>${I('chev')}</button>`).join('');
    // Puntos
    const pts = []; cs.forEach(c => Object.keys(c.puntos || {}).forEach(pid => { const p = c.puntos[pid]; if (sinTilde([p.nombre, p.detalle, p.direccion].join(' ')).includes(q)) pts.push([c, pid, p]); }));
    if (pts.length) h += `<div class="bsg">Puntos</div>` + pts.slice(0, 10).map(([c, pid, p]) => { const nt = Object.values(c.turnos || {}).filter(t => t.punto === pid).length;
      return `<button type="button" class="bsr" data-bpt="${esc(c.id)}|${esc(pid)}"><span class="th ic2"${fotoAttr(c.id, (p.fotos || [])[0])}>${I(p.tipo === 'stand' ? 'stand' : p.tipo === 'carrito' ? 'cart' : 'pin')}</span><span class="tx"><b>${esc(p.nombre)}</b><small>${p.detalle ? esc(p.detalle) + ' · ' : ''}${esc(c.nombre)} · ${nt === 1 ? '1 turno' : nt + ' turnos'}</small></span>${I('chev')}</button>`; }).join('');
    // Turnos: por hora ("8:30", "18") o por día ("sábado", "hoy", "mañana")
    let filas = [];
    const mh = q.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*hs?)?$/), dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'], dw = dias.findIndex(x => x.startsWith(q) && q.length >= 3);
    if (mh) {
      const hh = String(mh[1]).padStart(2, '0') + (mh[2] ? ':' + mh[2] : '');
      cs.forEach(c => { const ds = diasDe(c).slice(0, 7); ds.forEach(d => turnosDelDia(c, d).filter(t => t.desde.startsWith(hh)).forEach(t => filas.push([c, d, t]))); });
    } else if (dw >= 0 || q === 'hoy' || q === 'manana') {
      cs.forEach(c => { const d = q === 'hoy' ? hoyS : q === 'manana' ? sumarDias(hoyS, 1) : diasDe(c).find(x => parseIso(x).getDay() === dw); if (d && diasDe(c).includes(d)) turnosDelDia(c, d).forEach(t => filas.push([c, d, t])); });
    }
    filas.sort((a, b) => (a[1] + a[2].desde).localeCompare(b[1] + b[2].desde));
    if (filas.length) h += `<div class="bsg">Turnos</div>` + filas.slice(0, 20).map(([c, d, t]) => busTurnoFila(c, d, t)).join('');
    return h || `<div class="bs0">Nada con “${esc(q0.trim())}”. Probá con un nombre, un celular, un punto, una ciudad, un horario (8:30) o un día (sábado).</div>`;
  }
  function abrirBuscador() {
    if (!(S.isAdmin || S.coordDe.length)) { abrirBuscadorPub(); return; }
    const ov = document.createElement('div'); ov.className = 'bsov';
    ov.innerHTML = `<div class="bsbox" aria-label="Buscar hermanos, puntos o turnos"><div class="bsin">${I('search')}<input id="bsQ" type="search" aria-label="Buscar hermano, punto o turno" placeholder="Buscar hermano, punto o turno" autocomplete="off" enterkeyhint="search"><button type="button" class="bsx" data-bscerrar aria-label="Cerrar">Cerrar</button></div><div class="bsres" id="bsR"></div></div>`;
    document.body.appendChild(ov); modal(ov, ov.querySelector('.bsbox'));
    const inp = ov.querySelector('#bsQ'), res = ov.querySelector('#bsR');
    let atajo = null, timer = null;
    const pinta = () => {
      const q = inp.value;
      if (q.trim().length >= 2) { atajo = null; res.innerHTML = busResultados(q); return; }
      const pend = misCampanas().reduce((a, c) => a + busPeds(c.id).filter(p => p.estado === 'pendiente' && p.fecha >= hoy()).length, 0), rec = busRecientes();
      res.innerHTML = `<div class="bsch"><button type="button" data-bsat="pend" class="${atajo === 'pend' ? 'on' : ''}">Por confirmar${pend ? ` <b>${pend}</b>` : ''}</button><button type="button" data-bsat="hoy" class="${atajo === 'hoy' ? 'on' : ''}">Faltan hoy</button><button type="button" data-bsat="man" class="${atajo === 'man' ? 'on' : ''}">Faltan mañana</button></div>` + (S.bus.err ? '<div class="bs0 err">No se pudo cargar todo: algunos resultados pueden faltar. Cerrá y abrí la lupa para reintentar.</div>' : '') +
        (atajo ? busAtajo(atajo) : (rec.length ? `<div class="bsg">Búsquedas recientes</div>${rec.map(r => `<button type="button" class="bsrec" data-bsrec="${esc(r)}">${I('clock', 'width:15px;height:15px')}${esc(r)}</button>`).join('')}` : '<div class="bs0">Escribí un nombre, un celular, un punto, una ciudad, un horario (8:30) o un día (sábado).</div>'));
    };
    pinta(); setTimeout(() => inp.focus(), 50);
    if (S.bus.t === 0) res.insertAdjacentHTML('afterbegin', '<div class="bscarga">Cargando…</div>');
    cargarBusqueda().then(() => { if (ov.isConnected) pinta(); });
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(pinta, 120); });
    const cerrar = () => { ov.remove(); };
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('button, a'); if (!b) { if (e.target === ov) cerrar(); return; }
      const d = b.dataset;
      if (d.bscerrar !== undefined) { cerrar(); return; }
      if (d.bsat) { atajo = atajo === d.bsat ? null : d.bsat; pinta(); return; }
      if (d.bsrec) { inp.value = d.bsrec; pinta(); return; }
      if (d.bir) { e.stopPropagation(); busGuardar(inp.value); const [cid, f, tid] = d.bir.split('|'); cerrar(); S.coord.dia = f; S.coord.tab = 'dia'; S.coord.diaF = 'todos'; S.coord.flash = 'dt-' + tid; if (S.route.name === 'coord' && S.route.cid === cid) renderCoord(); else go('#/coord/' + cid); return; }
      if (d.bnuevo !== undefined) { e.stopPropagation(); busGuardar(inp.value); const qq = d.bnuevo; cerrar(); nuevoHermano(qq); return; }
      if (d.bturno) { e.stopPropagation(); busGuardar(inp.value); const l = (S.bus.per || {})[d.bturno]; if (!l) return; const ult = l.slice().sort((a, b) => String(b[1].creado || '').localeCompare(String(a[1].creado || '')))[0]; const p0 = ult[1]; cerrar(); elegirLugares(ult[0], { nombre: p0.nombre, apellido: p0.apellido, congregacion: p0.congregacion, celular: p0.celular || '', uid: /^m-/.test(p0.uid || '') ? p0.uid : '' }, null); return; }
      if (d.banot) { e.stopPropagation(); const [cid, f, tid] = d.banot.split('|'); cerrar(); anotarHermano(S.campanas[cid], tid, f, () => { S.coord.tab = 'dia'; S.coord.dia = f; S.coord.diaF = 'todos'; S.coord.flash = 'dt-' + tid; if (S.route.name === 'coord' && S.route.cid === cid) renderCoord(); else go('#/coord/' + cid); }); return; }
      if (d.bpt) { e.stopPropagation(); busGuardar(inp.value); const [cid, pid] = d.bpt.split('|'); cerrar(); S.coord.tab = 'config'; S.coord.aj = 'puntos'; S.coord.flash = 'pc-' + pid; if (S.route.name === 'coord' && S.route.cid === cid) renderCoord(); else go('#/coord/' + cid); return; }
      if (d.go) { busGuardar(inp.value); cerrar(); }
    });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
  }
  const waUrl = (cel) => { const x = String(cel || '').replace(/\D/g, ''); return 'https://wa.me/' + (x.length === 10 ? '549' + x : x); };
  function personaCoord(q) { const wa = waUrl; return `<div class="dp ${q.estado === 'confirmado' ? 'c' : 'p'}"><span class="mk">${q.estado === 'confirmado' ? I('check', 'width:13px;height:13px;stroke-width:3') : ''}</span><div class="who"><b>${esc(q.nombre)} ${esc(q.apellido)}</b><small>${esc(q.congregacion)}${q.estado === 'pendiente' ? ' · <em>por confirmar</em>' : ''}${q.manual ? ' · <span class="man">cargado por coordinador</span>' : ''}</small></div>${q.celular ? `<a class="wa" href="${wa(q.celular)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(q.nombre)}">${I('chat')}</a>` : ''}${q.estado === 'pendiente' ? `<div class="bb"><button type="button" class="sbtn nk" data-rechazar="${esc(q.id)}">No</button><button type="button" class="sbtn pri" data-confirmar="${esc(q.id)}">Confirmar</button></div>` : ''}${q.nota ? `<div class="nota chica">${I('edit', 'width:14px;height:14px')}<span><b>${esc(q.nombre)}:</b> ${esc(q.nota)}</span></div>` : ''}</div>`; }
  // Hermanos ya conocidos (anotados en las campañas que coordina), para completar los datos con un toque
  function conocidos() {
    const m = {};
    const add = (p) => { if (!p || !p.nombre) return; const k = sinTilde(p.nombre + ' ' + p.apellido) + '|' + String(p.celular || '').replace(/\D/g, ''); const prev = m[k]; if (!prev || String(p.creado || '') > String(prev.creado || '')) m[k] = p; };
    Object.values(S.coord.pedidos || {}).forEach(add);
    Object.values(S.bus.peds || {}).forEach(l => l.forEach(add));
    return Object.values(m);
  }
  function bindAutocompletar(ov, c) {
    if (!S.bus.t) cargarBusqueda();
    const q = (x) => ov.querySelector(x), box = q('#aSug');
    const pinta = () => {
      const t = sinTilde(q('#aNom').value + ' ' + q('#aApe').value);
      if (t.length < 2) { box.classList.add('hidden'); return; }
      const l = conocidos().filter(p => sinTilde(p.nombre + ' ' + p.apellido).includes(t) || sinTilde(p.apellido + ' ' + p.nombre).includes(t) || t.split(' ').every(w => sinTilde(p.nombre + ' ' + p.apellido).includes(w))).slice(0, 5);
      box.innerHTML = l.map((p, i) => `<button type="button" data-sug="${i}"><span class="ini">${esc(iniciales(p.nombre + ' ' + p.apellido))}</span><span class="tx"><b>${esc(p.nombre)} ${esc(p.apellido)}</b><small>${esc(p.congregacion)}${p.celular ? ' · ' + esc(p.celular) : ''}</small></span></button>`).join('');
      box.classList.toggle('hidden', !l.length);
      box.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => {
        const p = l[+b.dataset.sug];
        q('#aNom').value = p.nombre; q('#aApe').value = p.apellido; q('#aCel').value = p.celular || ''; q('#aNom').dataset.uid = /^m-/.test(p.uid || '') ? p.uid : '';
        const sel = q('#aCong'); if ([...sel.options].some(o => o.value === p.congregacion || o.text === p.congregacion)) { sel.value = p.congregacion; q('#aOtraF').classList.add('hidden'); } else { sel.value = '__otra'; q('#aOtra').value = p.congregacion; q('#aOtraF').classList.remove('hidden'); }
        box.classList.add('hidden'); q('#aGo').focus();
      }));
    };
    q('#aNom').addEventListener('input', pinta); q('#aApe').addEventListener('input', pinta);
  }
  /* ---------- El coordinador anota a un hermano que no usa la app: queda confirmado ---------- */
  function anotarHermano(c, tid, fecha, volver) {
    const t = c && c.turnos[tid] && Object.assign({ id: tid }, c.turnos[tid]); if (!t) return;
    const p = c.puntos[t.punto] || {};
    const congs = (S.publico.congregaciones || []).slice().sort((a, b) => a.localeCompare(b, 'es'));
    const ov = sheet(`<h3>Anotar a un hermano</h3><p class="hint">Para quien no puede usar la app. Queda <b>confirmado</b> y se lo podés avisar por WhatsApp.</p>
      <div class="sum"><div>${I('cal')}${esc(cap(fmtDia(fecha)))}</div><div>${I('clock')}<span class="num">${esc(t.desde)} – ${esc(t.hasta)}</span></div><div>${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin')}${esc(p.nombre || '')}</div><div class="cqs ya">${I('users')}<span><em>${quienesEn(c.id, fecha, tid).length === 1 ? 'Ya va:' : quienesEn(c.id, fecha, tid).length ? 'Ya van:' : ''}</em> ${conQuienHTML(quienesEn(c.id, fecha, tid), '')}</span></div></div>
      <div class="two"><div class="fld"><label for="aNom">Nombre</label><input id="aNom" autocomplete="off"></div><div class="fld"><label for="aApe">Apellido</label><input id="aApe" autocomplete="off"></div></div><div class="sug hidden" id="aSug"></div>
      <div class="fld"><label for="aCong">Congregación</label><select id="aCong">${congs.length ? '<option value="">Elegí la congregación</option>' : ''}${congs.map(x => `<option>${esc(x)}</option>`).join('')}<option value="__otra">Otra…</option></select></div>
      <div class="fld hidden" id="aOtraF"><label for="aOtra">¿Cuál?</label><input id="aOtra" placeholder="Nombre de la congregación y ciudad"></div>
      <div class="fld"><label for="aCel">Celular (WhatsApp) <span class="opc">(opcional)</span></label><input id="aCel" type="tel" autocomplete="off" placeholder="343 555-0000"><small class="celok" id="aCelOk"></small></div>
      <div class="fld"><label for="aNota">Nota <span class="opc">(opcional)</span></label><textarea id="aNota" rows="2" maxlength="${NOTA_MAX}" placeholder="Por ejemplo: avisarle por teléfono fijo, viene con su esposa…"></textarea></div>
      <p class="err hidden" id="aErr"></p>
      <button type="button" class="btn" id="aGo">Anotar y confirmar</button><button type="button" class="btn alt" data-cerrar id="aCancel">Cancelar</button>`);
    const q = (x) => ov.querySelector(x);
    if (volver) q('#aCancel').addEventListener('click', () => setTimeout(volver, 0));
    bindAutocompletar(ov, c);
    bindCel(q('#aCel'), q('#aCelOk'));
    const marcaFam = () => { const ap = sinTilde(q('#aApe').value); ov.querySelectorAll('.cqs.ya .cq').forEach(x => x.classList.toggle('fam', !!ap && x.dataset.ape === ap)); };
    q('#aApe').addEventListener('input', marcaFam); ov.addEventListener('click', () => setTimeout(marcaFam, 0));
    q('#aCong').addEventListener('change', () => q('#aOtraF').classList.toggle('hidden', q('#aCong').value !== '__otra'));
    q('#aGo').addEventListener('click', async () => {
      const nombre = q('#aNom').value.trim(), apellido = q('#aApe').value.trim(), cel = normCel(q('#aCel').value), celular = cel.ok ? cel.txt : '';
      const congregacion = q('#aCong').value === '__otra' ? q('#aOtra').value.trim() : q('#aCong').value;
      const nota = (q('#aNota') ? q('#aNota').value.trim() : '').slice(0, NOTA_MAX);
      const err = (m) => { q('#aErr').textContent = m; q('#aErr').classList.remove('hidden'); };
      if (!nombre || !apellido) return err('Completá nombre y apellido.');
      if (!congregacion) return err('Elegí la congregación.');
      if (!cel.ok && !cel.vacio) return err(CEL_ERR + ' O dejalo vacío.');
      const oc = (busCupos(c.id)[cupoId(c.id, fecha, tid)] || {}).ocupados || {};
      if (Object.keys(oc).length >= cupoDe(c, t)) return err('Ese turno ya se completó.');
      const per = { nombre, apellido, congregacion, celular, nota, uid: q('#aNom').dataset.uid || '' };
      const b = q('#aGo'); b.disabled = true; b.textContent = 'Guardando…';
      let hechos;
      try { hechos = await guardarManual(c, per, [{ fecha, tid }]); } catch (e) { console.error(e); b.disabled = false; b.textContent = 'Anotar y confirmar'; return err('No se pudo guardar. Revisá la conexión y probá de nuevo.'); }
      ov.remove();
      listoManual(c, per, hechos, volver);
    });
  }
  /* Alguien que no está en ninguna campaña: sus datos y después los lugares libres */
  function nuevoHermano(q) {
    const cs = misCampanas().filter(x => diasDe(x).length);
    if (!cs.length) { toast('No hay campañas con turnos por delante.'); return; }
    const ws = capNombre(q).split(' '), nom = ws.length > 1 ? ws.slice(0, -1).join(' ') : ws[0], ape = ws.length > 1 ? ws[ws.length - 1] : '';
    const congs = (S.publico.congregaciones || []).slice().sort((a, b) => a.localeCompare(b, 'es'));
    const c0 = (S.route.name === 'coord' && S.campanas[S.route.cid] && cs.find(x => x.id === S.route.cid)) || cs[0];
    const ov = sheet(`<h3>Anotar a alguien nuevo</h3><p class="hint">Sus datos, y después elegís uno o varios lugares libres. Queda <b>confirmado</b>.</p>
      <div class="two"><div class="fld"><label for="nNom">Nombre</label><input id="nNom" value="${esc(nom)}" autocomplete="off"></div><div class="fld"><label for="nApe">Apellido</label><input id="nApe" value="${esc(ape)}" autocomplete="off"></div></div>
      <div class="fld"><label for="nCong">Congregación</label><select id="nCong">${congs.length ? '<option value="">Elegí la congregación</option>' : ''}${congs.map(x => `<option>${esc(x)}</option>`).join('')}<option value="__otra">Otra…</option></select></div>
      <div class="fld hidden" id="nOtraF"><label for="nOtra">¿Cuál?</label><input id="nOtra" placeholder="Nombre de la congregación y ciudad"></div>
      <div class="fld"><label for="nCel">Celular (WhatsApp) <span class="opc">(opcional)</span></label><input id="nCel" type="tel" autocomplete="off" placeholder="343 555-0000"><small class="celok" id="nCelOk"></small></div>
      <div class="fld"><label for="nNota">Nota <span class="opc">(opcional)</span></label><textarea id="nNota" rows="2" maxlength="${NOTA_MAX}" placeholder="Por ejemplo: avisarle por teléfono fijo, viene con su esposa…"></textarea></div>
      <p class="err hidden" id="nErr"></p>
      <button type="button" class="btn" id="nGo">Elegir sus turnos</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const qs = (x) => ov.querySelector(x);
    bindCel(qs('#nCel'), qs('#nCelOk'));
    qs('#nCong').addEventListener('change', () => qs('#nOtraF').classList.toggle('hidden', qs('#nCong').value !== '__otra'));
    setTimeout(() => (ape ? qs('#nCong') : qs('#nApe')).focus(), 60);
    qs('#nGo').addEventListener('click', () => {
      const per = { nombre: capNombre(qs('#nNom').value), apellido: capNombre(qs('#nApe').value), congregacion: qs('#nCong').value === '__otra' ? qs('#nOtra').value.trim() : qs('#nCong').value, celular: normCel(qs('#nCel').value).txt || '', nota: qs('#nNota').value.trim().slice(0, NOTA_MAX), uid: '' };
      const err = (m) => { qs('#nErr').textContent = m; qs('#nErr').classList.remove('hidden'); };
      if (!per.nombre || !per.apellido) return err('Completá nombre y apellido.');
      if (!per.congregacion) return err('Elegí la congregación.');
      if (!normCel(qs('#nCel').value).ok && !normCel(qs('#nCel').value).vacio) return err(CEL_ERR + ' O dejalo vacío.');
      ov.remove(); elegirLugares(c0, per, null);
    });
  }
  // Quiénes ya van en un turno (confirmados o por confirmar), para no juntar a quien no corresponde
  const quienesEn = (cid, fecha, tid) => busPeds(cid).filter(p => p.fecha === fecha && p.tid === tid && (p.estado === 'confirmado' || p.estado === 'pendiente'));
  const congCorta = (x) => String(x || '').replace(/\s*\(.*\)\s*$/, '');
  function conQuienHTML(gente, apellido) {
    if (!gente.length) return '<span class="cq0">Nadie todavía</span>';
    const ap = sinTilde(apellido || '');
    return gente.map(g => `<span class="cq${ap && sinTilde(g.apellido) === ap ? ' fam' : ''}" data-ape="${esc(sinTilde(g.apellido))}">${esc(g.nombre)} ${esc(g.apellido)} <i>(${esc(congCorta(g.congregacion))})</i>${g.estado === 'pendiente' ? ' <i>· por confirmar</i>' : ''}<b class="ma">mismo apellido</b></span>`).join('');
  }
  // Guarda pedidos "cargados por coordinador" (confirmados) para una persona en uno o varios turnos; saltea los completos
  async function guardarManual(c, per, slots) {
    const uid = /^m-[a-z0-9]{6,24}$/.test(per.uid || '') ? per.uid : 'm-' + uidGen() + uidGen().slice(0, 3);
    const cups = busCupos(c.id), batch = S.db.batch(), hechos = [], ahora = new Date().toISOString();
    slots.forEach(({ fecha, tid }) => {
      const t = c.turnos[tid]; if (!t) return;
      const oc = (cups[cupoId(c.id, fecha, tid)] || {}).ocupados || {};
      if (oc[uid] || Object.keys(oc).length >= cupoDe(c, Object.assign({ id: tid }, t))) return;
      const d = { cid: c.id, fecha, tid, punto: t.punto, desde: t.desde, hasta: t.hasta, uid, nombre: per.nombre, apellido: per.apellido, congregacion: per.congregacion, estado: 'confirmado', creado: ahora, manual: true, por: S.user.email.toLowerCase() };
      if (per.celular) d.celular = per.celular;
      if (per.nota) d.nota = per.nota;
      batch.set(S.db.doc('cupos/' + cupoId(c.id, fecha, tid)), { cid: c.id, fecha, tid, ocupados: { [uid]: 'c' } }, { merge: true });
      batch.set(S.db.doc('pedidos/' + cupoId(c.id, fecha, tid) + '__' + uid), d);
      hechos.push({ fecha, t: Object.assign({ id: tid }, t), p: c.puntos[t.punto] || {}, d });
    });
    if (!hechos.length) return hechos;
    await batch.commit();
    auditar(c.id, 'anoto', `anotó a ${per.nombre} ${per.apellido} en ${hechos.length === 1 ? '' : hechos.length + ' turnos: '}` + hechos.map(h => `${fTxt(h.fecha)} ${tTxt(c, h.t)}`).join('; '));
    per.uid = uid;
    // la lupa y el selector de lugares usan una copia: se actualiza al momento
    hechos.forEach(h => { (S.bus.peds[c.id] = S.bus.peds[c.id] || []).push(Object.assign({ id: cupoId(c.id, h.fecha, h.t.id) + '__' + uid }, h.d)); const k = cupoId(c.id, h.fecha, h.t.id), cc = (S.bus.cupos[c.id] = S.bus.cupos[c.id] || {}); cc[k] = cc[k] || { cid: c.id, fecha: h.fecha, tid: h.t.id, ocupados: {} }; cc[k].ocupados = Object.assign({}, cc[k].ocupados, { [uid]: 'c' }); });
    return hechos;
  }
  function avisoManual(c, nombre, hechos) {
    const lugar = (p) => (p.nombre || '') + (p.detalle ? ' (' + p.detalle + ')' : '');
    if (hechos.length === 1) { const h = hechos[0], url = comoLlegarUrl(h.p, c); return `Hola ${nombre}, ya tenés tu turno en la PPAM: ${cap(fmtDia(h.fecha))} de ${h.t.desde} a ${h.t.hasta} · ${lugar(h.p)} — ${c.nombre}${c.ciudad ? ', ' + c.ciudad : ''}.${url ? '\nCómo llegar: ' + url : ''}`; }
    const ps = [...new Set(hechos.map(h => h.t.punto))];
    return `Hola ${nombre}, ya tenés tus turnos en la PPAM (${c.nombre}${c.ciudad ? ', ' + c.ciudad : ''}):\n` + hechos.slice().sort((a, b) => (a.fecha + a.t.desde).localeCompare(b.fecha + b.t.desde)).map(h => `• ${cap(fmtDia(h.fecha))}, ${h.t.desde} a ${h.t.hasta} · ${lugar(h.p)}`).join('\n') +
      ps.map(pid => { const url = comoLlegarUrl(c.puntos[pid] || {}, c); return url ? `\nCómo llegar a ${(c.puntos[pid] || {}).nombre || ''}: ${url}` : ''; }).join('');
  }
  function listoManual(c, per, hechos, volver) {
    const msg = avisoManual(c, per.nombre, hechos), wa = String(per.celular || '').replace(/\D/g, ''), n = hechos.length;
    const ok = sheet(`<div class="ok-big"><div class="o">${I('check', 'width:30px;height:30px;stroke-width:2.6')}</div><h3>${esc(per.nombre)} ya tiene ${n === 1 ? 'su turno' : n + ' turnos'}</h3>${hechos.map(h => `<p>${esc(cap(fmtDia(h.fecha)))} · ${esc(h.t.desde)} a ${esc(h.t.hasta)} · ${esc(h.p.nombre || '')}</p>`).join('')}<p><span class="tag confirmado">Confirmado${n === 1 ? '' : 's'}</span></p></div>
      ${wa ? `<a class="btn" id="aWa" href="https://wa.me/${wa.length === 10 ? '549' + wa : wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${I('chat')}Avisarle por WhatsApp</a>` : `<button type="button" class="btn" id="aCopy">${I('copy')}Copiar el mensaje para avisarle</button>`}<button type="button" class="btn alt" id="aOtro">${I('plus')}Anotarlo en otro turno</button><button type="button" class="btn alt" data-cerrar>Listo</button>`);
    const cp = ok.querySelector('#aCopy'); if (cp) cp.addEventListener('click', () => { copiar(msg); });
    if (volver) ok.querySelectorAll('[data-cerrar]').forEach(x => x.addEventListener('click', () => setTimeout(volver, 0)));
    ok.querySelector('#aOtro').addEventListener('click', () => { ok.remove(); elegirLugares(c, per, volver); });
    const aw = ok.querySelector('#aWa'); if (aw && window.__ppamMock) aw.addEventListener('click', (e) => { e.preventDefault(); window.open(aw.href); });
  }
  /* Lugares libres de una campaña para anotar a una persona: se pueden marcar varios */
  function elegirLugares(c0, per, volver) {
    const ov = sheet('<div class="lg-body"></div>'); ov.classList.add('lgov');
    let c = c0, todos = false;
    const yaEsta = (cid, fecha, tid) => busPeds(cid).some(p => p.fecha === fecha && p.tid === tid && (p.estado === 'confirmado' || p.estado === 'pendiente') && ((per.uid && p.uid === per.uid) || sinTilde(p.nombre + ' ' + p.apellido) === sinTilde(per.nombre + ' ' + per.apellido)));
    const pinta = () => {
      const cs = misCampanas().filter(x => diasDe(x).length), dias = diasDe(c), ver = todos ? dias : dias.slice(0, 14), cups = busCupos(c.id);
      let h = `<h3>Anotar a ${esc(per.nombre)} ${esc(per.apellido)}</h3><p class="hint">${esc(per.congregacion)}${per.celular ? ' · ' + esc(per.celular) : ''}. Marcá uno o varios lugares libres.</p>`;
      if (cs.length > 1) h += `<div class="fld"><select id="lgCamp">${cs.map(x => `<option value="${esc(x.id)}"${x.id === c.id ? ' selected' : ''}>${esc(x.nombre)}${x.ciudad ? ' · ' + esc(x.ciudad) : ''}</option>`).join('')}</select></div>`;
      let hay = 0;
      ver.forEach(d => {
        const suyos = busPeds(c.id).filter(q => q.fecha === d && (q.estado === 'confirmado' || q.estado === 'pendiente') && ((per.uid && q.uid === per.uid) || sinTilde(q.nombre + ' ' + q.apellido) === sinTilde(per.nombre + ' ' + per.apellido)));
        const fs = turnosDelDia(c, d).filter(t => !yaEmpezo(d, t)).map(t => { const oc = Object.keys((cups[cupoId(c.id, d, t.id)] || {}).ocupados || {}).length, ch = suyos.find(q => q.tid !== t.id && minutos(q.desde) < minutos(t.hasta) && minutos(t.desde) < minutos(q.hasta)); return { t, falta: cupoDe(c, t) - oc, esta: yaEsta(c.id, d, t.id), ch }; }).filter(x => x.falta > 0 || x.esta);
        if (!fs.length) return;
        h += `<div class="lgd">${esc(cap(fmtDia(d)))}</div>` + fs.map(({ t, falta, esta, ch }) => { const p = c.puntos[t.punto] || {}; if (!esta) hay++;
          return `<label class="lgr${esta ? ' ya' : ''}"><input type="checkbox" value="${d}|${esc(t.id)}"${esta ? ' disabled' : ''}><span class="tx"><b class="num">${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))}</b> · ${esc(p.nombre || '')}<small>${esta ? 'Ya está anotado' : falta === 1 ? 'Falta 1' : 'Faltan ' + falta}${p.detalle ? ' · ' + esc(p.detalle) : ''}</small>${esta ? '' : `<span class="cqs"><em>Con:</em> ${conQuienHTML(quienesEn(c.id, d, t.id), per.apellido)}</span>`}${!esta && ch ? `<span class="chq">Se superpone con su turno de ${esc(ch.desde)} a ${esc(ch.hasta)}</span>` : ''}</span></label>`; }).join('');
      });
      if (!hay) h += '<div class="bs0">No quedan lugares libres en esta campaña.</div>';
      if (!todos && dias.length > 14) h += `<button type="button" class="btn alt" id="lgMas">Ver los días que siguen</button>`;
      h += `<div class="lgbar"><p class="err hidden" id="lgErr"></p><button type="button" class="btn" id="lgGo" disabled>Elegí uno o más lugares</button><button type="button" class="btn alt" data-cerrar>Cancelar</button></div>`;
      ov.querySelector('.lg-body').innerHTML = h;
      const sel = ov.querySelector('#lgCamp'); if (sel) sel.addEventListener('change', () => { c = S.campanas[sel.value]; todos = false; pinta(); });
      const mas = ov.querySelector('#lgMas'); if (mas) mas.addEventListener('click', () => { todos = true; pinta(); });
      const go = ov.querySelector('#lgGo');
      const cuenta = () => { const n = ov.querySelectorAll('.lgr input:checked').length; go.disabled = !n; go.textContent = n ? (n === 1 ? 'Anotar en 1 turno' : `Anotar en ${n} turnos`) : 'Elegí uno o más lugares'; };
      ov.querySelectorAll('.lgr input').forEach(x => x.addEventListener('change', cuenta));
      go.addEventListener('click', async () => {
        const slots = [...ov.querySelectorAll('.lgr input:checked')].map(x => { const [fecha, tid] = x.value.split('|'); return { fecha, tid }; });
        go.disabled = true; go.textContent = 'Guardando…';
        let hechos;
        try { hechos = await guardarManual(c, per, slots); } catch (e) { console.error(e); cuenta(); const er = ov.querySelector('#lgErr'); er.textContent = 'No se pudo guardar. Revisá la conexión y probá de nuevo.'; er.classList.remove('hidden'); return; }
        if (!hechos.length) { cuenta(); const er = ov.querySelector('#lgErr'); er.textContent = 'Esos lugares se acaban de completar. Elegí otros.'; er.classList.remove('hidden'); return; }
        ov.remove(); listoManual(c, per, hechos, volver);
      });
    };
    pinta();
    if (!S.bus.t) cargarBusqueda().then(() => { if (ov.isConnected) pinta(); });
  }
  /* ---------- Historial: lista, filtro "solo borrados" y "Restaurar" ---------- */
  const audFecha = (x) => { const v = x && x.at; if (!v) return null; if (typeof v === 'string') return new Date(v); if (v.toDate) return v.toDate(); if (v.seconds) return new Date(v.seconds * 1000); return null; };
  const AUD_IC = { borro_turno: 'x', borro_punto: 'x', borro_foto: 'x', quito: 'x', cancelo: 'x', no_confirmo: 'x', confirmo: 'check', anoto: 'plus', creo_turno: 'plus', creo_punto: 'plus', creo_campana: 'plus', restauro: 'back', cambio_turno: 'edit', cambio_punto: 'edit', cambio_campana: 'edit', coordinadores: 'edit', config: 'edit' };
  const esBorrado = (x) => /^(borro_|quito|cancelo|no_confirmo)/.test(x.tipo);
  function cuandoTxt(d) {
    if (!d) return 'recién';
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'recién'; if (min < 60) return `hace ${min} min`;
    const hh = pad(d.getHours()) + ':' + pad(d.getMinutes()), iso = isoOf(d);
    if (iso === hoy()) return 'hoy ' + hh; if (iso === addDays(hoy(), -1)) return 'ayer ' + hh;
    return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} ${hh}`;
  }
  function historialHTML(lista, o) {
    o = o || {};
    const f = S.audF || 'todo', restaurados = new Set(lista.filter(x => x.tipo === 'restauro' && x.de).map(x => x.de));
    let l = lista.slice().sort((a, b) => (audFecha(b) || new Date()).getTime() - (audFecha(a) || new Date()).getTime() || String(b.id).localeCompare(String(a.id)));
    if (f === 'borr') l = l.filter(esBorrado);
    if (o.cid) l = l.filter(x => x.cid === o.cid);
    if (o.q) { const q = sinTilde(o.q); l = l.filter(x => sinTilde(x.por + ' ' + x.texto).includes(q)); }
    let h = `<div class="seg2 hf"><button type="button" data-hf="todo" class="${f === 'todo' ? 'on' : ''}">Todo</button><button type="button" data-hf="borr" class="${f === 'borr' ? 'on' : ''}">Solo borrados y quitados</button></div>`;
    if (!l.length) return h + '<div class="card"><div class="empty">No hay cambios registrados todavía.</div></div>';
    const lim = o.lim || 150;
    h += '<div class="card hist">' + l.slice(0, lim).map(x => {
      const c = S.campanas[x.cid], [k, rid] = String(x.ref || '').split(':');
      const existe = c && (k === 'turno' ? !!(c.turnos || {})[rid] : k === 'punto' ? !!(c.puntos || {})[rid] : false);
      const puede = x.antes && (x.tipo === 'borro_turno' || x.tipo === 'borro_punto') && !restaurados.has(x.id) && c && !existe && (S.isAdmin || S.coordDe.includes(x.cid));
      return `<div class="hrow ${esBorrado(x) ? 'del' : ''}"><span class="hic">${I(AUD_IC[x.tipo] || 'edit', 'width:14px;height:14px')}</span><div class="htx"><b>${esc(x.por)}</b> ${esc(x.texto)}<small>${esc(cuandoTxt(audFecha(x)))}${o.cam && x.cid ? ' · ' + esc(c ? c.nombre : x.cid) : o.cam ? ' · Configuración general' : ''}${restaurados.has(x.id) ? ' · <span class="ok">restaurado</span>' : ''}</small></div>${puede ? `<button type="button" class="sbtn" data-restaurar="${esc(x.id)}">${I('back', 'width:14px;height:14px')}Restaurar</button>` : ''}</div>`;
    }).join('') + '</div>' + (l.length > lim ? `<p class="note">Se muestran los últimos ${lim} de ${l.length}.</p>` : '');
    return h;
  }
  async function restaurar(id) {
    const x = (S.coord.aud || {})[id] || ((S.audAll || []).find(y => y.id === id)); if (!x || !x.antes) return;
    const c = S.campanas[x.cid]; if (!c) return;
    const [k, rid] = String(x.ref).split(':'), upd = {};
    if (k === 'turno') upd['turnos.' + rid] = x.antes;
    else if (k === 'punto') { upd['puntos.' + rid] = x.antes.punto; Object.keys(x.antes.turnos || {}).forEach(t => { upd['turnos.' + t] = x.antes.turnos[t]; }); }
    else return;
    if (!confirm(k === 'turno' ? `¿Restaurar el turno ${tTxt(c, x.antes)}?` : `¿Restaurar el punto ${x.antes.punto.nombre} y sus turnos?`)) return;
    try { await S.db.doc('campanas/' + c.id).update(upd); await auditar(c.id, 'restauro', k === 'turno' ? `restauró el turno ${tTxt(Object.assign({}, c, { puntos: Object.assign({}, c.puntos) }), x.antes)}` : `restauró el punto ${x.antes.punto.nombre}${Object.keys(x.antes.turnos || {}).length ? ' y sus turnos' : ''}`, { de: id }); toast('Restaurado'); if (S.audAll) abrirHistorialGeneral(true); }
    catch (e) { console.error(e); toast('No se pudo restaurar.'); }
  }
  async function abrirHistorialGeneral(refrescar) {
    let ov = document.querySelector('.hgov');
    if (!ov) { ov = sheet('<div class="hg-body"><div class="empty">Cargando…</div></div>'); ov.classList.add('hgov'); ov.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.hf) { e.stopPropagation(); S.audF = b.dataset.hf; pinta(); } if (b.dataset.restaurar) { e.stopPropagation(); restaurar(b.dataset.restaurar); } }); }
    const pinta = () => {
      const body = ov.querySelector('.hg-body'), cid = (ov.querySelector('#hgCamp') || {}).value || '', q = (ov.querySelector('#hgQ') || {}).value || '';
      const cs = Object.values(S.campanas).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      body.innerHTML = `<h3>Historial de cambios</h3><p class="hint">Todas las campañas y la configuración general. Nadie puede editar ni borrar estas líneas; se guardan 6 meses.</p>
        <div class="two"><div class="fld"><select id="hgCamp"><option value="">Todas las campañas</option><option value="__gen"${cid === '__gen' ? ' selected' : ''}>Configuración general</option>${cs.map(c => `<option value="${esc(c.id)}"${c.id === cid ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div><div class="fld"><input id="hgQ" type="search" placeholder="Persona o texto" value="${esc(q)}"></div></div>` +
        historialHTML((S.audAll || []).filter(x => cid === '__gen' ? !x.cid : true), { cam: true, cid: cid && cid !== '__gen' ? cid : '', q }) + '<button type="button" class="btn alt" data-cerrar>Cerrar</button>';
      body.querySelector('#hgCamp').addEventListener('change', pinta);
      const qi = body.querySelector('#hgQ'); qi.addEventListener('input', () => { clearTimeout(pinta.t); pinta.t = setTimeout(() => { pinta(); const n = ov.querySelector('#hgQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    };
    try {
      // se trae todo y se ordena acá (ordenar en Firebase por id descendente pide un índice que no hace falta crear)
      const qs = await S.db.collection('auditoria').get();
      const a = []; qs.forEach(d => a.push(Object.assign({ id: d.id }, d.data()))); a.sort((x, y) => String(y.id).localeCompare(String(x.id))); S.audAll = a;
      // limpieza: las líneas de más de 6 meses se borran (solo el administrador puede, y solo esas)
      const viejas = a.filter(x => { const d = audFecha(x); return d && Date.now() - d.getTime() > 183 * 864e5; });
      if (viejas.length) { const b = S.db.batch(); viejas.slice(0, 200).forEach(x => b.delete(S.db.doc('auditoria/' + x.id))); b.commit().catch(() => {}); }
    } catch (e) { console.error(e); registrarError('aviso', 'Historial: ' + String(e.code || e.message || e)); ov.querySelector('.hg-body').innerHTML = `<div class="empty">No se pudo cargar el historial.<br><small style="color:var(--ink3)">(${esc(String(e.code || e.message || e).slice(0, 80))})</small></div><button type="button" class="btn alt" data-cerrar>Cerrar</button>`; return; }
    pinta();
  }
  function pedidoCoordRow(c, p, acciones) {
    const pt = (c.puntos || {})[p.punto] || {};
    const wa = String(p.celular || '').replace(/\D/g, '');
    const pal = ['#E5EEEB|#12433F', '#F4ECDC|#7A5E27', '#E6ECF5|#2F4B7A', '#F3E6EC|#7A3553'][(p.nombre || '').length % 4].split('|');
    return `<div class="rq"><div class="t"><span class="ini" style="background:${pal[0]};color:${pal[1]}">${esc(iniciales(p.nombre + ' ' + p.apellido))}</span><div class="who"><b>${esc(p.nombre)} ${esc(p.apellido)}</b><small>${esc(p.congregacion)}</small></div><a class="wa" href="https://wa.me/${wa.length === 10 ? '549' + wa : wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${I('chat')}</a></div><div class="w">${I('cal', 'width:15px;height:15px')}<span>${esc(cap(fmtDia(p.fecha)))} · ${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))} · ${esc(pt.nombre || '')}</span><span class="num tel">${esc(p.celular)}</span></div>${notaHTML(p.nota)}${acciones ? `<div class="bb">${acciones}</div>` : ''}</div>`;
  }
  function coordPedidos(c, pend, peds) {
    let h = `<div class="sec">Por confirmar</div>`;
    h += pend.length ? pend.map(p => pedidoCoordRow(c, p, `<button type="button" class="sbtn nk" data-rechazar="${esc(p.id)}">${I('x', 'width:15px;height:15px')}No confirmar</button><button type="button" class="sbtn pri" data-confirmar="${esc(p.id)}">${I('check', 'width:15px;height:15px')}Confirmar</button>`)).join('') : '<div class="card"><div class="empty">No hay pedidos nuevos. Todo al día.</div></div>';
    const conf = peds.filter(p => p.estado === 'confirmado' && p.fecha >= hoy()).sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
    if (conf.length) h += `<div class="sec">Confirmados (${conf.length})</div><div class="card">` + conf.slice(0, 40).map(p => pedidoCoordRow(c, p, `<button type="button" class="sbtn bad" data-quitar="${esc(p.id)}">Quitar del turno</button>`)).join('') + '</div>';
    return h;
  }
  function coordCobertura(c, dias) {
    if (!dias.length) return '<div class="empty">No hay días con turnos por delante. Revisá las fechas y los turnos en Configurar.</div>';
    if (!S.coord.semana || !dias.includes(S.coord.semana)) S.coord.semana = dias[0];
    const i0 = dias.indexOf(S.coord.semana), ds = dias.slice(i0, i0 + 7);
    let h = `<div class="acts" style="margin:0 0 10px;"><button type="button" class="sbtn" data-sem="-7" ${i0 === 0 ? 'disabled' : ''}>${I('back', 'width:15px;height:15px')}Anteriores</button><button type="button" class="sbtn" data-sem="7" ${i0 + 7 >= dias.length ? 'disabled' : ''}>Siguientes${I('chev', 'width:15px;height:15px')}</button></div>`;
    Object.keys(c.puntos || {}).forEach(pid => {
      const p = c.puntos[pid];
      const franjas = [...new Set(Object.values(c.turnos || {}).filter(t => t.punto === pid).map(t => t.desde + '-' + t.hasta))].sort();
      if (!franjas.length) return;
      h += `<div class="sec">${esc(p.nombre)} · ${esc((TIPOS[p.tipo] || TIPOS.otro)[1].toLowerCase())}, ${cupoDe(c, { punto: pid })} por turno</div>`;
      h += `<div class="grid" style="grid-template-columns: 62px repeat(${ds.length}, minmax(40px,1fr));"><div class="hd"></div>${ds.map(d => `<div class="hd">${esc(fmtCorto(d))}</div>`).join('')}`;
      franjas.forEach(f => {
        const [a, b] = f.split('-');
        h += `<div class="hd">${esc(fmtHora(a))}–${esc(fmtHora(b))}</div>`;
        ds.forEach(d => {
          const t = turnosDelDia(c, d).find(x => x.punto === pid && x.desde === a && x.hasta === b);
          if (!t) { h += '<div class="na">·</div>'; return; }
          const oc = Object.values((S.coord.cupos[cupoId(c.id, d, t.id)] || {}).ocupados || {}), n = cupoDe(c, t), k = oc.filter(v => v === 'c').length, pe = oc.length - k;
          h += `<button type="button" class="${k >= n ? 'full' : k > 0 ? 'half' : 'none'}" data-cir="${d}|${esc(t.id)}" title="Ver quiénes van${pe ? ' (' + pe + ' por confirmar)' : ''}">${k}/${n}${pe ? '<sup>+' + pe + '</sup>' : ''}</button>`;
        });
      });
      h += '</div>';
    });
    h += `<div class="acts"><button type="button" class="sbtn pri" data-voluntarios>${I('chat')}Pedir voluntarios por WhatsApp</button></div><p class="note">Tocá una casilla para ver quiénes van en ese turno. "Pedir voluntarios" arma un mensaje con los turnos de estos días que todavía no están completos y el link a la campaña.</p>`;
    return h;
  }
  function coordDia(c, dias, peds) {
    if (!dias.length) return '<div class="empty">No hay días con turnos por delante.</div>';
    if (!S.coord.dia || !dias.includes(S.coord.dia)) S.coord.dia = dias[0];
    let h = `<div class="days">${dias.slice(0, 30).map(d => { const x = parseIso(d); return `<button type="button" class="day${d === S.coord.dia ? ' on' : ''}" data-cdia="${d}"><small>${DOW[x.getDay()]}</small><b>${x.getDate()}</b><i>${MES[x.getMonth()].slice(0, 3)}</i></button>`; }).join('')}</div>`;
    const d = S.coord.dia, ts = turnosDelDia(c, d), soloF = S.coord.diaF === 'faltan';
    const info = ts.map(t => {
      const ocup = Object.values((S.coord.cupos[cupoId(c.id, d, t.id)] || {}).ocupados || {}), n = cupoDe(c, t);
      const ps = peds.filter(p => p.fecha === d && p.tid === t.id && (p.estado === 'confirmado' || p.estado === 'pendiente')).sort((x, y) => (x.estado === 'confirmado' ? 0 : 1) - (y.estado === 'confirmado' ? 0 : 1));
      return { t, n, ps, falta: Math.max(0, n - Math.max(ocup.length, ps.length)) };
    });
    const nc = info.reduce((a, x) => a + x.ps.filter(p => p.estado === 'confirmado').length, 0), np = info.reduce((a, x) => a + x.ps.filter(p => p.estado === 'pendiente').length, 0), nf = info.reduce((a, x) => a + x.falta, 0);
    h += `<div class="dres cd"><span><b>${nc}</b> confirmados${np ? ` · <b class="pe">${np}</b> por confirmar` : ''} · ${nf ? `<b class="fa">faltan ${nf}</b>` : '<b>completo</b>'}</span><div class="seg2 cf"><button type="button" data-cdf="todos" class="${soloF ? '' : 'on'}">Todos</button><button type="button" data-cdf="faltan" class="${soloF ? 'on' : ''}">Faltan</button></div></div>`;
    const wa = (cel) => { const x = String(cel || '').replace(/\D/g, ''); return 'https://wa.me/' + (x.length === 10 ? '549' + x : x); };
    let vistos = 0;
    Object.keys(c.puntos || {}).forEach(pid => {
      const p = c.puntos[pid], its = info.filter(x => x.t.punto === pid && (!soloF || x.falta > 0));
      if (!its.length) return;
      vistos++;
      const fp = info.filter(x => x.t.punto === pid).reduce((a, x) => a + x.falta, 0);
      h += `<div class="pc cdp"><div class="pt"><div class="th"${fotoAttr(c.id, (p.fotos || [])[0])}>${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin')}</div><div class="tx"><b>${esc(p.nombre)}</b>${p.detalle ? `<small>${esc(p.detalle)}</small>` : ''}</div><span class="pl ${fp ? 'fa' : 'ok'}">${fp ? (fp === 1 ? 'Falta 1' : 'Faltan ' + fp) : 'Completo'}</span></div>`;
      its.forEach(x => {
        h += `<div class="dt" id="dt-${esc(x.t.id)}"><div class="dth"><b class="num">${esc(fmtHora(x.t.desde))} a ${esc(fmtHora(x.t.hasta))}</b><span class="${x.falta ? 'fa' : 'ok'}">${x.falta ? (x.falta === 1 ? 'Falta 1' : 'Faltan ' + x.falta) : 'Completo'}</span></div>`;
        h += x.ps.map(personaCoord).join('');
        if (x.falta) h += `<div class="dp v"><span class="mk"></span><span class="who">${x.ps.length ? (x.falta === 1 ? '1 lugar libre' : x.falta + ' lugares libres') : 'Nadie anotado todavía'}</span><button type="button" class="sbtn anot" data-anotar="${esc(x.t.id)}|${esc(d)}">${I('plus', 'width:14px;height:14px')}Anotar</button></div>`;
        h += '</div>';
      });
      h += '</div>';
    });
    if (!ts.length) h += '<div class="card"><div class="empty">No hay turnos ese día.</div></div>';
    else if (!vistos) h += '<div class="card"><div class="empty">Ese día está todo cubierto.</div></div>';
    h += `<div class="acts"><button type="button" class="sbtn pri" data-listadia>${I('share')}Compartir la lista por WhatsApp</button></div>`;
    return h;
  }
  const enCurso = new Set();   // evita el doble toque: la misma acción no se manda dos veces mientras se guarda
  async function cambiarEstado(pid, estado) {
    const p = S.coord.pedidos[pid]; if (!p || enCurso.has(pid)) return;
    enCurso.add(pid); setTimeout(() => enCurso.delete(pid), 4000);
    const batch = S.db.batch();
    const cref = S.db.doc('cupos/' + cupoId(p.cid, p.fecha, p.tid));
    if (estado === 'confirmado') batch.set(cref, { cid: p.cid, fecha: p.fecha, tid: p.tid, ocupados: { [p.uid]: 'c' } }, { merge: true });
    else batch.update(cref, { ['ocupados.' + p.uid]: S.del() });
    batch.update(S.db.doc('pedidos/' + pid), { estado, actualizado: new Date().toISOString(), por: S.user.email.toLowerCase() });
    try { await batch.commit(); const c = S.campanas[p.cid] || {}; auditar(p.cid, estado === 'confirmado' ? 'confirmo' : p.estado === 'confirmado' ? 'quito' : 'no_confirmo', (estado === 'confirmado' ? 'confirmó a ' : p.estado === 'confirmado' ? 'quitó del turno a ' : 'no confirmó a ') + pTxt(c, p)); toast(estado === 'confirmado' ? 'Confirmado' : 'Listo'); } catch (e) { console.error(e); toast('No se pudo guardar. Probá de nuevo.'); }
  }
  function compartir(texto) {
    const url = 'https://wa.me/?text=' + encodeURIComponent(texto);
    window.open(url, '_blank', 'noopener');
  }
  function linkCampana(c) { return location.origin + location.pathname + '#/c/' + c.id; }
  function textoVoluntarios(c, dias) {
    const i0 = dias.indexOf(S.coord.semana), ds = dias.slice(i0 < 0 ? 0 : i0, (i0 < 0 ? 0 : i0) + 7);
    const lin = [];
    ds.forEach(d => turnosDelDia(c, d).forEach(t => {
      const n = cupoDe(c, t), oc = Object.keys((S.coord.cupos[cupoId(c.id, d, t.id)] || {}).ocupados || {}).length;
      if (oc < n) lin.push(`• ${cap(fmtDia(d))} · ${fmtHora(t.desde)} a ${fmtHora(t.hasta)} · ${c.puntos[t.punto].nombre} (falta${n - oc > 1 ? 'n ' + (n - oc) : ' 1'})`);
    }));
    return `*PPAM · ${c.nombre}* (${c.ciudad || ''})\nNecesitamos voluntarios para estos turnos:\n\n${lin.join('\n') || 'Por ahora están todos cubiertos.'}\n\nPedí tu turno acá: ${linkCampana(c)}`;
  }
  function textoDia(c, peds) {
    const d = S.coord.dia, ts = turnosDelDia(c, d);
    return `*PPAM · ${c.nombre}* — ${cap(fmtDia(d))}\n\n` + ts.map(t => {
      const ps = peds.filter(p => p.fecha === d && p.tid === t.id && p.estado === 'confirmado');
      return `*${fmtHora(t.desde)} a ${fmtHora(t.hasta)} · ${c.puntos[t.punto].nombre}*\n${ps.length ? ps.map(p => `  – ${p.nombre} ${p.apellido}`).join('\n') : '  (sin confirmar)'}`;
    }).join('\n\n');
  }

  /* ---------- Configurar una campaña (coordinadores y administradores) ---------- */
  function coordConfig(c) {
    const puntos = Object.keys(c.puntos || {}).map(id => Object.assign({ id }, c.puntos[id]));
    const turnos = Object.keys(c.turnos || {}).map(id => Object.assign({ id }, c.turnos[id])).sort((a, b) => (a.desde + a.hasta).localeCompare(b.desde + b.hasta));
    const aj = S.coord.aj || 'puntos';
    let h = `<div class="seg2 aj"><button type="button" data-aj="campana" class="${aj === 'campana' ? 'on' : ''}">Campaña</button><button type="button" data-aj="puntos" class="${aj === 'puntos' ? 'on' : ''}">Puntos y turnos</button><button type="button" data-aj="hist" class="${aj === 'hist' ? 'on' : ''}">Historial</button></div>`;
    if (aj === 'hist') return h + `<p class="note hnote">Quién cambió o borró algo en esta campaña, y cuándo. Nadie puede editar ni borrar estas líneas. Se guardan 6 meses.</p>` + historialHTML(Object.keys(S.coord.aud || {}).map(id => Object.assign({ id }, S.coord.aud[id])), { cam: false });
    if (aj === 'campana') {
      h += `<div class="sec">Datos de la campaña</div><div class="card" data-editable style="padding:12px 13px 4px;">
      <div class="lbl">Foto de portada</div><div class="portada"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}></div>
      <div class="pills"><label class="sbtn">${I('camera')}${c.portada ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" id="cfFoto" hidden></label>${c.portada ? '<button type="button" class="sbtn bad" id="cfFotoDel">Quitar foto</button>' : ''}</div>
      <p class="small-hint">Una foto apaisada del lugar, sin personas reconocibles. Se achica sola antes de subirse. Sin foto se usa el color de la campaña.</p>
      <div class="fld"><label for="cfNom">Nombre</label><input id="cfNom" value="${esc(c.nombre)}"></div>
      <div class="two"><div class="fld"><label for="cfCiu">Ciudad</label><input id="cfCiu" value="${esc(c.ciudad || '')}"></div><div class="fld"><label for="cfLug">Lugar (opcional)</label><input id="cfLug" value="${esc(c.lugar || '')}"></div></div>
      <div class="two"><div class="fld"><label for="cfDes">Desde</label><input id="cfDes" type="date" value="${esc(c.desde || '')}"></div><div class="fld"><label for="cfHas">Hasta</label><input id="cfHas" type="date" value="${esc(c.hasta || '')}"></div></div>
      <label class="ck"><input type="checkbox" id="cfAct"${c.activa !== false ? ' checked' : ''}> <span>Visible para todos (si la desmarcás, deja de aparecer en el inicio)</span></label>
      <button type="button" class="btn" id="cfSave" style="margin-bottom:10px;">Guardar datos</button></div>`;
      return h;
    }
    const vistosT = {}, repetidos = new Set();
    turnos.forEach(t => { (t.dias || []).forEach(d => { const k = t.punto + '|' + t.desde + '|' + t.hasta + '|' + d; if (vistosT[k] && vistosT[k] !== t.id) { repetidos.add(t.id); repetidos.add(vistosT[k]); } else vistosT[k] = t.id; }); });
    const corta = diasCorta(c), validos = corta ? corta.map(x => x.d) : [0, 1, 2, 3, 4, 5, 6];
    const diasTxt = (ds) => corta ? corta.filter(x => (ds || []).includes(x.d)).map(x => DOW[x.d] + ' ' + x.n).join(', ') || 'Ningún día de la campaña' : (ds || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DOW[d]).join(', ') || 'Ningún día';
    const fuera = (t) => (t.dias || []).filter(d => !validos.includes(d));
    const conTurnos = puntos.filter(p => turnos.some(t => t.punto === p.id));
    h += `<div class="sec">Puntos y turnos <button type="button" class="sbtn" data-punto="">+ Punto</button></div>`;
    if (!puntos.length) h += '<div class="card"><div class="empty">Agregá el primer punto (un carrito, un stand…). Después le cargás sus horarios.</div></div>';
    puntos.forEach(p => {
      const ts = turnos.filter(t => t.punto === p.id), mismos = ts.length > 1 && ts.every(t => diasTxt(t.dias) === diasTxt(ts[0].dias));
      const rep = ts.filter(t => repetidos.has(t.id)).length, nf = (p.fotos || []).length;
      h += `<div class="pc aj" id="pc-${esc(p.id)}"><div class="pt"><div class="th"${fotoAttr(c.id, (p.fotos || [])[0])}>${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin')}</div><div class="tx"><b>${esc(p.nombre)}</b><small>${esc((TIPOS[p.tipo] || TIPOS.otro)[1])} · ${cupoDe(c, { punto: p.id })} por turno${p.detalle ? ' · ' + esc(p.detalle) : ''}</small><small class="est ${p.lat != null ? 'ok' : 'warn'}">${p.lat != null ? 'Marcado en el mapa' : 'Sin marcar en el mapa: tocá Editar'}${nf ? ' · ' + nf + (nf === 1 ? ' foto' : ' fotos') : ''}</small></div><button type="button" class="sbtn" data-punto="${esc(p.id)}">Editar</button></div>`;
      const tf = ts.filter(t => fuera(t).length);
      if (tf.length) h += `<div class="pav fue">${I('cal', 'width:14px;height:14px;flex-shrink:0;margin-top:1px')}<span><b>${tf.length === 1 ? 'Un turno tiene' : tf.length + ' turnos tienen'} días fuera de la campaña</b> (${esc([...new Set(tf.flatMap(fuera))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DOW[d]).join(', '))}). No se muestran a nadie. Tocá el turno y guardalo para corregirlo.</span></div>`;
      if (rep) h += `<div class="pav" id="avRep">${I('alert', 'width:14px;height:14px;flex-shrink:0;margin-top:1px')}<span><b>${rep === 2 ? 'Hay un turno repetido' : 'Hay turnos repetidos'}</b> Los hermanos ven dos botones iguales. Borrá el que sobra, o dejá uno solo y subile el cupo al punto.</span></div>`;
      h += `<div class="tlbl">${ts.length ? (ts.length === 1 ? '1 turno' : ts.length + ' turnos') + (mismos ? ' · ' + esc(diasTxt(ts[0].dias)) : '') : 'Sin turnos todavía'}</div>`;
      h += `<div class="tch">${ts.map(t => `<button type="button" class="tchip${repetidos.has(t.id) || fuera(t).length ? ' rep' : ''}" data-turno="${esc(t.id)}"><b class="num">${esc(t.desde)}–${esc(t.hasta)}</b>${repetidos.has(t.id) ? '<small class="r">Repetido</small>' : fuera(t).length ? '<small class="r">Días fuera</small>' : mismos ? '' : `<small>${esc(diasTxt(t.dias))}</small>`}</button>`).join('')}<button type="button" class="tchip add" data-turno="" data-tpto="${esc(p.id)}">+ Turno</button></div>`;
      if (!ts.length && conTurnos.length) h += `<button type="button" class="linkish cph" data-cph="${esc(p.id)}">Copiar los horarios de otro punto</button>`;
      h += '</div>';
    });
    const huerf = turnos.filter(t => !(c.puntos || {})[t.punto]);
    if (huerf.length) h += `<div class="pc aj"><div class="tlbl">Turnos de un punto que ya no existe</div><div class="tch">${huerf.map(t => `<button type="button" class="tchip rep" data-turno="${esc(t.id)}"><b class="num">${esc(t.desde)}–${esc(t.hasta)}</b><small>${esc(diasTxt(t.dias))}</small></button>`).join('')}</div></div>`;
    return h;
  }
  function copiarHorarios(c, pid) {
    const otros = Object.keys(c.puntos || {}).filter(k => k !== pid && Object.values(c.turnos || {}).some(t => t.punto === k));
    const ov = sheet(`<h3>Copiar horarios</h3><p class="hint">Se cargan en <b>${esc(c.puntos[pid].nombre)}</b> los mismos turnos (horario y días) del punto que elijas. Después los podés cambiar uno por uno.</p>${otros.map(k => { const ts = Object.values(c.turnos).filter(t => t.punto === k).sort((a, b) => a.desde.localeCompare(b.desde)); return `<button type="button" class="btn alt cphb" data-de="${esc(k)}" style="text-align:left;display:block;"><b>${esc(c.puntos[k].nombre)}</b><small style="display:block;font-weight:500;color:var(--ink3);">${ts.map(t => esc(t.desde)).join(' · ')}</small></button>`; }).join('')}<button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    ov.querySelectorAll('[data-de]').forEach(bt => bt.addEventListener('click', async () => {
      if (ov.dataset.enviando) return;
      const upd = {};
      const corta = diasCorta(c); Object.values(c.turnos).filter(t => t.punto === bt.dataset.de).forEach(t => { const dias = (t.dias || []).filter(d => !corta || corta.some(x => x.d === d)); if (dias.length) upd['turnos.t' + uidGen()] = { punto: pid, desde: t.desde, hasta: t.hasta, dias }; });
      if (!Object.keys(upd).length) { toast('Ese punto no tiene turnos en los días de esta campaña.'); return; }
      ov.dataset.enviando = '1'; ov.querySelectorAll('[data-de]').forEach(x => { x.disabled = true; });
      try { await S.db.doc('campanas/' + c.id).update(upd); auditar(c.id, 'creo_turno', `copió ${Object.keys(upd).length} turno(s) de ${c.puntos[bt.dataset.de].nombre} a ${c.puntos[pid].nombre}`); ov.remove(); toast(Object.keys(upd).length === 1 ? '1 turno copiado' : Object.keys(upd).length + ' turnos copiados'); } catch (e) { delete ov.dataset.enviando; ov.querySelectorAll('[data-de]').forEach(x => { x.disabled = false; }); console.error(e); toast('No se pudo copiar.'); }
    }));
  }
  const uidGen = () => Math.random().toString(36).slice(2, 9);
  async function guardarCampo(c, path, value, msg) {
    try { await S.db.doc('campanas/' + c.id).update({ [path]: value }); if (msg) toast(msg); return true; }
    catch (e) { console.error(e); toast('No se pudo guardar. Probá de nuevo.'); return false; }
  }
  function bindConfig(c) {
    if (!$('cfSave')) return;
    $('cfFoto').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) subirPortada(c, f); });
    if ($('cfFotoDel')) $('cfFotoDel').addEventListener('click', async () => {
      if (!confirm('¿Quitar la foto de portada?')) return;
      const b = S.db.batch(); b.update(S.db.doc('campanas/' + c.id), { portada: S.del() }); b.delete(S.db.doc('fotos/' + fotoKey(c.id, c.portada)));
      try { await b.commit(); auditar(c.id, 'borro_foto', 'quitó la foto de portada'); toast('Foto quitada'); } catch (e) { console.error(e); toast('No se pudo quitar.'); }
    });
    $('cfSave').addEventListener('click', async () => {
      const bs = $('cfSave'); if (bs.disabled) return;
      const d = { nombre: $('cfNom').value.trim(), ciudad: $('cfCiu').value.trim(), lugar: $('cfLug').value.trim(), desde: $('cfDes').value, hasta: $('cfHas').value, activa: $('cfAct').checked };
      if (!d.nombre || !d.desde || !d.hasta) { toast('Completá el nombre y las fechas.'); return; }
      if (d.hasta < d.desde) { toast('La fecha "hasta" es anterior a "desde".'); return; }
      const cam = []; if (d.nombre !== c.nombre) cam.push(`nombre ("${c.nombre}" → "${d.nombre}")`); if (d.ciudad !== (c.ciudad || '')) cam.push(`ciudad (${c.ciudad || '—'} → ${d.ciudad})`); if (d.lugar !== (c.lugar || '')) cam.push('lugar'); if (d.desde !== c.desde || d.hasta !== c.hasta) cam.push(`fechas (${c.desde} a ${c.hasta} → ${d.desde} a ${d.hasta})`); if (d.activa !== (c.activa !== false)) cam.push(d.activa ? 'la hizo visible' : 'la ocultó');
      bs.disabled = true;
      try { await S.db.doc('campanas/' + c.id).update(d); if (cam.length) auditar(c.id, 'cambio_campana', 'cambió los datos de la campaña: ' + cam.join(', ')); S.sucio = false; S.pendRender = false; toast('Guardado'); render(); } catch (e) { console.error(e); toast('No se pudo guardar.'); }
      if (bs.isConnected) bs.disabled = false;
    });
  }
  /* ---------- Mapa para marcar un punto (Leaflet + OpenStreetMap; buscador y direcciones: Nominatim) ---------- */
  const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
  const ER = { centro: [-31.73, -60.53], caja: '-60.85,-30.1,-57.8,-34.1' };   // Entre Ríos (Paraná al centro)
  function cargarLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (cargarLeaflet.p) return cargarLeaflet.p;
    cargarLeaflet.p = new Promise((res, rej) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAFLET + '.css'; document.head.appendChild(l);
      const sc = document.createElement('script'); sc.src = LEAFLET + '.js';
      sc.onload = () => (window.L ? res(window.L) : rej(new Error('leaflet')));
      sc.onerror = () => { cargarLeaflet.p = null; rej(new Error('leaflet')); };
      document.head.appendChild(sc);
    });
    return cargarLeaflet.p;
  }
  async function nominatim(ruta, params) {
    const u = 'https://nominatim.openstreetmap.org/' + ruta + '?' + new URLSearchParams(Object.assign({ format: 'jsonv2', 'accept-language': 'es' }, params));
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('nominatim');
    return r.json();
  }
  function textoDir(a, nombre) {
    a = a || {};
    const calle = a.road || a.pedestrian || a.footway || a.square || a.neighbourhood || '';
    const loc = a.city || a.town || a.village || a.municipality || '';
    const s = [calle && (calle + (a.house_number ? ' ' + a.house_number : '')), loc].filter(Boolean).join(', ');
    return (s || nombre || '').slice(0, 150);
  }
  async function direccionDe(lat, lng) {
    try { const r = await nominatim('reverse', { lat, lon: lng, zoom: 18, addressdetails: 1 }); return textoDir(r.address, r.name); } catch (e) { return ''; }
  }
  async function buscarLugar(txt) {
    const r = await nominatim('search', { q: txt, countrycodes: 'ar', viewbox: ER.caja, bounded: 1, limit: 6, addressdetails: 1 });
    return (r || []).map(x => ({ lat: +x.lat, lng: +x.lon, nombre: x.name || '', dir: textoDir(x.address, x.name), txt: x.display_name || '' }));
  }
  S.geoCiudad = {};
  async function centroMapa(c, st) {
    if (st.lat != null) return { ll: [st.lat, st.lng], z: 17 };
    const otro = Object.values(c.puntos || {}).find(p => p.lat != null);
    if (otro) return { ll: [otro.lat, otro.lng], z: 16 };
    const ciu = (c.ciudad || '').trim();
    if (ciu) {
      if (!(ciu in S.geoCiudad)) { try { const r = await buscarLugar(ciu + ', Entre Ríos'); S.geoCiudad[ciu] = r[0] ? [r[0].lat, r[0].lng] : null; } catch (e) { S.geoCiudad[ciu] = null; } }
      if (S.geoCiudad[ciu]) return { ll: S.geoCiudad[ciu], z: 14 };
    }
    return { ll: ER.centro, z: 8 };
  }
  function crearMapa(el, cen, pos, alTocar) {
    const L = window.L;
    const map = L.map(el, { attributionControl: true }).setView(cen.ll, cen.z);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const icon = L.divIcon({ className: 'pinx', html: '<i></i>', iconSize: [30, 40], iconAnchor: [15, 38] });
    let mk = null;
    const poner = (lat, lng, mover) => {
      if (!mk) { mk = L.marker([lat, lng], { draggable: true, icon }).addTo(map); mk.on('dragend', () => alTocar(mk.getLatLng())); }
      else mk.setLatLng([lat, lng]);
      if (mover) map.setView([lat, lng], Math.max(map.getZoom(), 17));
    };
    if (pos) poner(pos[0], pos[1]);
    map.on('click', (e) => { poner(e.latlng.lat, e.latlng.lng); alTocar(e.latlng); });
    setTimeout(() => map.invalidateSize(), 60);
    return { map, poner, quitar: () => { if (mk) { map.removeLayer(mk); mk = null; } } };
  }
  // Pantalla completa: buscar por nombre o dirección y marcar con comodidad.
  function buscarEnMapa(c, st, listo) {
    const ov = document.createElement('div'); ov.className = 'mapfull';
    ov.innerHTML = `<div class="mf-top"><button type="button" class="mf-back" data-mf-cerrar>${I('back')}Volver al punto</button><h3>Marcar en el mapa</h3>
      <form class="mf-bus" id="mfForm"><input id="mfQ" placeholder="Buscá un lugar o una dirección" autocomplete="off"><button type="submit" class="sbtn pri">Buscar</button></form><div class="mf-res hidden" id="mfRes"></div></div>
      <div class="mf-map" id="mfMap"><div class="mapmsg">Cargando el mapa…</div></div>
      <div class="mf-bot"><div id="mfDir" class="mf-dir">Tocá el mapa donde va el punto.</div><div class="mf-acts"><button type="button" class="btn alt" data-mf-cerrar>Cancelar</button><button type="button" class="btn" id="mfOk" disabled>✓ Usar este lugar</button></div></div>`;
    document.body.appendChild(ov);
    const q = (s) => ov.querySelector(s);
    let sel = st.lat != null ? { lat: st.lat, lng: st.lng, dir: '' } : null, mapa = null;
    const elegir = (lat, lng, dir, mover) => {
      sel = { lat, lng, dir: dir || '' }; q('#mfOk').disabled = false;
      if (mapa) mapa.poner(lat, lng, mover);
      q('#mfDir').innerHTML = dir ? `<b>${esc(dir)}</b><br><small>Podés arrastrar el pin para afinar.</small>` : 'Buscando la dirección…';
      if (!dir) direccionDe(lat, lng).then(d => { if (sel && sel.lat === lat && sel.lng === lng) { sel.dir = d; q('#mfDir').innerHTML = `<b>${esc(d || 'Lugar marcado')}</b><br><small>Podés arrastrar el pin para afinar.</small>`; } });
    };
    if (sel) q('#mfOk').disabled = false;
    ov.addEventListener('click', (e) => { if (e.target.closest('[data-mf-cerrar]')) ov.remove(); });
    centroMapa(c, st).then(async (cen) => {
      try { await cargarLeaflet(); if (!ov.isConnected) return; q('#mfMap').innerHTML = ''; mapa = crearMapa(q('#mfMap'), cen, sel ? [sel.lat, sel.lng] : null, (ll) => elegir(ll.lat, ll.lng)); }
      catch (e) { q('#mfMap').innerHTML = '<div class="mapmsg">No se pudo cargar el mapa. Revisá la conexión.</div>'; }
    });
    q('#mfForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = q('#mfQ').value.trim(); if (!t) return;
      const box = q('#mfRes'); box.classList.remove('hidden'); box.innerHTML = '<div>Buscando…</div>';
      try {
        const rs = await buscarLugar(c.ciudad && !t.toLowerCase().includes(c.ciudad.toLowerCase()) ? t + ', ' + c.ciudad : t).then(r => r.length ? r : buscarLugar(t));
        box.innerHTML = rs.length ? rs.map((r, i) => `<button type="button" data-mf-r="${i}">${I('pin', 'width:15px;height:15px;margin-right:6px;color:var(--pri)')}${esc(r.nombre ? r.nombre + ' · ' + r.dir : r.txt)}</button>`).join('') : '<div>No encontré ese lugar. Probá con otra forma de escribirlo, o tocá el mapa.</div>';
        box.querySelectorAll('[data-mf-r]').forEach(b => b.addEventListener('click', () => { const r = rs[+b.dataset.mfR]; box.classList.add('hidden'); elegir(r.lat, r.lng, r.dir, true); }));
      } catch (err) { box.innerHTML = '<div>No se pudo buscar. Revisá la conexión.</div>'; }
    });
    q('#mfOk').addEventListener('click', () => { if (!sel) return; ov.remove(); listo(sel.lat, sel.lng, sel.dir); });
  }

  async function subirPortada(c, file) {
    toast('Subiendo la foto…');
    try {
      const data = await achicar(file, 1400), fid = 'portada-' + uidGen(), k = fotoKey(c.id, fid);
      const b = S.db.batch();
      b.set(S.db.doc('fotos/' + k), { cid: c.id, data, creado: new Date().toISOString() });
      b.update(S.db.doc('campanas/' + c.id), { portada: fid });
      if (c.portada) b.delete(S.db.doc('fotos/' + fotoKey(c.id, c.portada)));
      S.fotos[k] = data;
      await b.commit(); toast('Foto de portada guardada');
    } catch (e) { console.error(e); toast(e && e.message === 'imagen' ? 'No se pudo leer esa imagen.' : 'No se pudo subir la foto. Probá con otra.'); }
  }
  function editarPunto(c, pidIn) {
    const pid = pidIn || 'p' + uidGen();
    const p = pidIn ? c.puntos[pidIn] : { nombre: '', tipo: 'carrito', cupo: 2, detalle: '' };
    const st = { fotos: (p.fotos || []).slice(), nuevas: {}, borrar: [], lat: p.lat != null ? p.lat : null, lng: p.lng != null ? p.lng : null, mapsUrl: p.mapsUrl || '' };
    const ov = sheet(`<h3>${pidIn ? 'Editar punto' : 'Nuevo punto'}</h3><p class="hint">Un carrito, un stand o cualquier lugar donde se pone la gente.</p>
      <div class="fld"><label for="ptNom">Nombre</label><input id="ptNom" value="${esc(p.nombre)}" placeholder="Andén 1, Hall central, Plaza…"></div>
      <div class="two"><div class="fld"><label for="ptTipo">Tipo</label><select id="ptTipo">${Object.keys(TIPOS).map(k => `<option value="${k}"${p.tipo === k ? ' selected' : ''}>${TIPOS[k][1]}</option>`).join('')}</select></div>
      <div class="fld"><label for="ptCupo">Personas por turno</label><input id="ptCupo" type="number" min="1" max="20" value="${esc(p.cupo)}"></div></div>
      <div class="fld"><label for="ptDet">Detalle corto (opcional)</label><input id="ptDet" value="${esc(p.detalle || '')}" placeholder="Frente a boleterías"></div>
      <div class="fld"><label for="ptDir">Dirección (opcional)</label><input id="ptDir" value="${esc(p.direccion || '')}" placeholder="Av. Ramírez 2598"></div>
      <div class="lbl">Ubicación · tocá el mapa donde va el punto</div>
      <div class="mapedit" id="ptMap"><div class="mapmsg">Cargando el mapa…</div></div>
      <div class="okline" id="ptUbi"></div>
      <div class="pills" style="margin-top:8px"><button type="button" class="sbtn" id="ptGeo">${I('target')}Estoy acá</button><button type="button" class="sbtn" id="ptFull">${I('search')}Buscar en el mapa</button><button type="button" class="sbtn" id="ptLinkB">${I('link')}Pegar link</button></div>
      <div class="fld hidden" id="ptLinkF" style="margin:8px 0 0"><input id="ptLink" placeholder="Pegá acá el link de Google Maps" inputmode="url"></div>
      <p class="small-hint">Tocá el mapa donde va el carrito o el stand; el pin se puede arrastrar para afinar. La dirección se completa sola.</p>
      <div class="lbl">Fotos del lugar (hasta 3)</div><div class="up" id="ptFotos"></div>
      <p class="small-hint">Del lugar, sin personas reconocibles. Se achican solas antes de subirse.</p>
      <div class="fld"><label for="ptInd">Cómo encontrarlo (opcional)</label><textarea id="ptInd" rows="2" placeholder="Entrando por Av. Ramírez, a la derecha, entre las boleterías 4 y 5.">${esc(p.indicaciones || '')}</textarea></div>
      <div class="fld"><label for="ptRet" id="ptRetL">${retiroLabel(p)} (opcional)</label><textarea id="ptRet" rows="2" placeholder="Dónde se busca y se devuelve">${esc(p.retiro || '')}</textarea></div>
      <button type="button" class="btn" id="ptOk">Guardar</button>${pidIn ? '<button type="button" class="btn alt" id="ptDel" style="color:var(--bad)">Borrar este punto</button>' : ''}<button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const q = (s) => ov.querySelector(s);
    let mapa = null, dirAuto = '';
    function pintarUbi() {
      q('#ptUbi').innerHTML = st.lat != null ? `✓ Ubicación marcada (${st.lat}, ${st.lng}) · <button type="button" class="linkish" id="ptUbiX">quitar</button>`
        : st.mapsUrl ? '✓ Link de Maps guardado · <button type="button" class="linkish" id="ptUbiX">quitar</button>' : '';
      if (q('#ptUbiX')) q('#ptUbiX').addEventListener('click', () => { st.lat = st.lng = null; st.mapsUrl = ''; q('#ptLink').value = ''; if (mapa) mapa.quitar(); pintarUbi(); });
    }
    // Marca un lugar (desde el mapa, el GPS, el buscador o un link) y completa la dirección si está vacía.
    function marcar(lat, lng, dirSugerida, mover) {
      st.lat = +(+lat).toFixed(6); st.lng = +(+lng).toFixed(6); st.mapsUrl = '';
      if (mapa) mapa.poner(st.lat, st.lng, mover);
      pintarUbi();
      const campo = q('#ptDir'), libre = () => !campo.value.trim() || campo.value.trim() === dirAuto;
      if (!libre()) return;
      const llenar = (d) => { if (d && libre()) { campo.value = d; dirAuto = d; } };
      if (dirSugerida) llenar(dirSugerida); else direccionDe(st.lat, st.lng).then(llenar);
    }
    centroMapa(c, st).then(async (cen) => {
      try {
        await cargarLeaflet();
        if (!ov.isConnected) return;
        q('#ptMap').innerHTML = '';
        mapa = crearMapa(q('#ptMap'), cen, st.lat != null ? [st.lat, st.lng] : null, (ll) => marcar(ll.lat, ll.lng));
      } catch (e) { q('#ptMap').innerHTML = '<div class="mapmsg">No se pudo cargar el mapa. Usá "Estoy acá" o pegá un link de Google Maps.</div>'; }
    });
    q('#ptFull').addEventListener('click', () => buscarEnMapa(c, st, (lat, lng, dir) => marcar(lat, lng, dir, true)));
    function pintarFotos() {
      q('#ptFotos').innerHTML = st.fotos.map(f => `<div class="img"${st.nuevas[f] ? ` style="background-image:url('${st.nuevas[f]}')"` : fotoAttr(c.id, f)}><button type="button" data-qf="${esc(f)}" aria-label="Quitar foto">✕</button></div>`).join('') +
        (st.fotos.length < 3 ? '<label class="add">' + I('camera', 'width:20px;height:20px;margin:0 auto 3px;display:block') + 'Agregar foto<input type="file" accept="image/*" id="ptFile"></label>' : '');
      ov.querySelectorAll('[data-qf]').forEach(b => b.addEventListener('click', () => { const f = b.dataset.qf; st.fotos = st.fotos.filter(x => x !== f); if (st.nuevas[f]) delete st.nuevas[f]; else st.borrar.push(f); pintarFotos(); }));
      if (q('#ptFile')) q('#ptFile').addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        try { const data = await achicar(file, 1200), f = 'f' + uidGen(); st.nuevas[f] = data; st.fotos.push(f); pintarFotos(); }
        catch (err) { toast(err && err.message === 'imagen' ? 'No se pudo leer esa imagen.' : 'Esa foto es muy pesada. Probá con otra.'); }
      });
    }
    pintarUbi(); pintarFotos();
    q('#ptTipo').addEventListener('change', () => { if (!pidIn) q('#ptCupo').value = q('#ptTipo').value === 'stand' ? 3 : 2; q('#ptRetL').textContent = retiroLabel({ tipo: q('#ptTipo').value }) + ' (opcional)'; });
    q('#ptLinkB').addEventListener('click', () => { q('#ptLinkF').classList.remove('hidden'); q('#ptLink').focus(); });
    q('#ptLink').addEventListener('input', () => {
      const v = q('#ptLink').value.trim(), g = parseMapsLink(v);
      if (g) { marcar(g.lat, g.lng, '', true); return; }
      if (/^https?:\/\/\S+$/.test(v)) { st.lat = st.lng = null; st.mapsUrl = v.slice(0, 500); if (mapa) mapa.quitar(); }
      pintarUbi();
    });
    q('#ptGeo').addEventListener('click', () => {
      if (!navigator.geolocation) { toast('Este navegador no da la ubicación.'); return; }
      q('#ptGeo').disabled = true; q('#ptGeo').textContent = 'Buscando…';
      navigator.geolocation.getCurrentPosition((pos) => {
        q('#ptGeo').disabled = false; q('#ptGeo').innerHTML = I('target') + 'Estoy acá';
        marcar(pos.coords.latitude, pos.coords.longitude, '', true);
      }, () => { q('#ptGeo').disabled = false; q('#ptGeo').innerHTML = I('target') + 'Estoy acá'; toast('No se pudo obtener la ubicación. Revisá el permiso del navegador.'); }, { enableHighAccuracy: true, timeout: 15000 });
    });
    q('#ptOk').addEventListener('click', async () => {
      const d = { nombre: q('#ptNom').value.trim(), tipo: q('#ptTipo').value, cupo: Math.min(20, Math.max(1, parseInt(q('#ptCupo').value, 10) || 2)), detalle: q('#ptDet').value.trim() };
      if (!d.nombre) { toast('Poné un nombre al punto.'); return; }
      const dir = q('#ptDir').value.trim().slice(0, 150), ind = q('#ptInd').value.trim().slice(0, 600), ret = q('#ptRet').value.trim().slice(0, 600);
      if (dir) d.direccion = dir;
      if (ind) d.indicaciones = ind;
      if (ret) d.retiro = ret;
      if (st.lat != null) { d.lat = st.lat; d.lng = st.lng; } else if (st.mapsUrl) d.mapsUrl = st.mapsUrl;
      if (st.fotos.length) d.fotos = st.fotos;
      const b = S.db.batch(), ahora = new Date().toISOString();
      Object.keys(st.nuevas).forEach(f => { b.set(S.db.doc('fotos/' + fotoKey(c.id, f)), { cid: c.id, data: st.nuevas[f], creado: ahora }); S.fotos[fotoKey(c.id, f)] = st.nuevas[f]; });
      st.borrar.forEach(f => b.delete(S.db.doc('fotos/' + fotoKey(c.id, f))));
      b.update(S.db.doc('campanas/' + c.id), { ['puntos.' + pid]: d });
      const btn = q('#ptOk'); btn.disabled = true; btn.textContent = 'Guardando…';
      try { await b.commit(); auditar(c.id, pidIn ? 'cambio_punto' : 'creo_punto', (pidIn ? 'cambió el punto ' : 'creó el punto ') + d.nombre + (st.borrar.length ? ` (quitó ${st.borrar.length} foto${st.borrar.length === 1 ? '' : 's'})` : '')); ov.remove(); toast('Punto guardado'); }
      catch (e) { console.error(e); btn.disabled = false; btn.textContent = 'Guardar'; toast('No se pudo guardar. Probá de nuevo.'); }
    });
    if (pidIn) q('#ptDel').addEventListener('click', async () => {
      const usados = Object.values(c.turnos || {}).filter(t => t.punto === pid).length;
      if (!confirm(usados ? `Este punto tiene ${usados} turno(s). Se borran también. ¿Seguir?` : '¿Borrar este punto?')) return;
      const upd = { ['puntos.' + pid]: S.del() };
      Object.keys(c.turnos || {}).forEach(tid => { if (c.turnos[tid].punto === pid) upd['turnos.' + tid] = S.del(); });
      const antes = { punto: JSON.parse(JSON.stringify(c.puntos[pid])), turnos: {} };
      Object.keys(c.turnos || {}).forEach(tid => { if (c.turnos[tid].punto === pid) antes.turnos[tid] = JSON.parse(JSON.stringify(c.turnos[tid])); });
      // las fotos se conservan para poder restaurar el punto desde el historial
      try { await S.db.doc('campanas/' + c.id).update(upd); auditar(c.id, 'borro_punto', `borró el punto ${c.puntos[pid].nombre}${usados ? ` y sus ${usados} turno${usados === 1 ? '' : 's'}` : ''}`, { antes, ref: 'punto:' + pid }); ov.remove(); toast('Punto borrado'); } catch (e) { toast('No se pudo borrar.'); }
    });
  }
  function editarTurno(c, tid, pto) {
    let t = tid ? c.turnos[tid] : { punto: pto && c.puntos[pto] ? pto : Object.keys(c.puntos)[0], desde: '08:00', hasta: '10:00', dias: [1, 2, 3, 4, 5, 6] };
    if (!tid) {   // un turno nuevo sigue al último del punto (mismo largo y días); si el punto no tiene, toma los días de la campaña
      const todos = Object.values(c.turnos || {}), del = todos.filter(x => x.punto === t.punto).sort((a, b) => a.hasta.localeCompare(b.hasta)), u = del[del.length - 1];
      const m = (x) => +x.slice(0, 2) * 60 + +x.slice(3), hh = (n) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
      if (u && m(u.hasta) + m(u.hasta) - m(u.desde) <= 23 * 60 + 59) t = Object.assign({}, t, { desde: u.hasta, hasta: hh(m(u.hasta) + m(u.hasta) - m(u.desde)), dias: (u.dias || []).slice() });
      else if (todos.length) t = Object.assign({}, t, { dias: (todos[0].dias || []).slice() });
    }
    const corta = diasCorta(c), orden = corta ? corta.map(x => x.d) : [1, 2, 3, 4, 5, 6, 0];
    if (corta && !tid && !(t.dias || []).some(d => orden.includes(d))) t = Object.assign({}, t, { dias: orden.slice() });
    const ov = sheet(`<h3>${tid ? 'Editar turno' : 'Nuevo turno'}</h3><p class="hint">${corta ? 'Elegí en qué días de la campaña va este horario.' : 'Se repite todos los días marcados, entre las fechas de la campaña.'}</p>
      <div class="fld"><label for="tuPto">Punto</label><select id="tuPto">${Object.keys(c.puntos).map(pid => `<option value="${esc(pid)}"${pid === t.punto ? ' selected' : ''}>${esc(c.puntos[pid].nombre)}</option>`).join('')}</select></div>
      <div class="two"><div class="fld"><label for="tuDes">Desde</label><input id="tuDes" type="time" value="${esc(t.desde)}"></div><div class="fld"><label for="tuHas">Hasta</label><input id="tuHas" type="time" value="${esc(t.hasta)}"></div></div>
      <div class="fld"><label>${corta ? 'Días de la campaña' : 'Días'}</label><div class="wd">${(corta || orden.map(d => ({ d }))).map(x => `<label><input type="checkbox" value="${x.d}"${(t.dias || []).includes(x.d) ? ' checked' : ''}><span>${DOW[x.d]}${corta ? ' ' + x.n : ''}</span></label>`).join('')}</div>${corta && tid && (t.dias || []).some(d => !orden.includes(d)) ? '<p class="small-hint" style="color:var(--warn)">Tenía días fuera de la campaña; al guardar se quitan.</p>' : ''}</div>
      ${tid ? '' : '<label class="ck"><input type="checkbox" id="tuMas"> <span>Crear también los turnos siguientes, uno detrás del otro, hasta:</span></label><div class="fld hidden" id="tuMasF"><input id="tuFin" type="time" value="20:00"></div>'}
      <button type="button" class="btn" id="tuOk">Guardar</button>${tid ? '<button type="button" class="btn alt" id="tuDel" style="color:var(--bad)">Borrar este turno</button>' : ''}<button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const q = (s) => ov.querySelector(s);
    if (!tid) q('#tuMas').addEventListener('change', () => q('#tuMasF').classList.toggle('hidden', !q('#tuMas').checked));
    q('#tuOk').addEventListener('click', async () => {
      const dias = [...ov.querySelectorAll('.wd input:checked')].map(x => +x.value);
      const d = { punto: q('#tuPto').value, desde: q('#tuDes').value, hasta: q('#tuHas').value, dias };
      if (!/^\d\d:\d\d$/.test(d.desde) || !/^\d\d:\d\d$/.test(d.hasta) || d.hasta <= d.desde) { toast('Revisá el horario.'); return; }
      if (!dias.length) { toast('Marcá al menos un día.'); return; }
      const upd = {};
      if (tid) upd['turnos.' + tid] = d;
      else {
        const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3), toHH = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
        let a = toMin(d.desde), dur = toMin(d.hasta) - a;
        const fin = q('#tuMas').checked ? toMin(q('#tuFin').value || d.hasta) : toMin(d.hasta);
        let n = 0;
        while (a + dur <= fin && n < 12) { upd['turnos.t' + uidGen()] = Object.assign({}, d, { desde: toHH(a), hasta: toHH(a + dur) }); a += dur; n++; }
      }
      const pn = (c.puntos[d.punto] || {}).nombre || '';
      const at = tid ? (t0 => `cambió el turno ${tTxt(c, t0)} (${dTxt(t0.dias)}) → ${fmtHora(d.desde)}–${fmtHora(d.hasta)} del ${pn} (${dTxt(d.dias)})`)(c.turnos[tid]) : `creó ${Object.keys(upd).length === 1 ? 'el turno' : Object.keys(upd).length + ' turnos'} ${Object.values(upd).map(x => fmtHora(x.desde) + '–' + fmtHora(x.hasta)).join(', ')} del ${pn} (${dTxt(d.dias)})`;
      const ex = tid ? { antes: JSON.parse(JSON.stringify(c.turnos[tid])), ref: 'turno:' + tid } : null;
      try { await S.db.doc('campanas/' + c.id).update(upd); auditar(c.id, tid ? 'cambio_turno' : 'creo_turno', at, ex); ov.remove(); toast(Object.keys(upd).length > 1 ? `${Object.keys(upd).length} turnos creados` : 'Turno guardado'); } catch (e) { console.error(e); toast('No se pudo guardar.'); }
    });
    if (tid) q('#tuDel').addEventListener('click', async () => {
      if (!confirm('¿Borrar este turno? Los pedidos que ya tenga quedan en la lista.')) return;
      const antes = JSON.parse(JSON.stringify(c.turnos[tid])), n = Object.values(S.coord.pedidos || {}).filter(p => p.tid === tid && p.fecha >= hoy() && (p.estado === 'confirmado' || p.estado === 'pendiente')).length;
      if (await guardarCampo(c, 'turnos.' + tid, S.del(), 'Turno borrado')) { auditar(c.id, 'borro_turno', `borró el turno ${tTxt(c, antes)} (${dTxt(antes.dias)})${n ? ` — tenía ${n} anotado${n === 1 ? '' : 's'} por delante` : ''}`, { antes, ref: 'turno:' + tid }); ov.remove(); }
    });
  }

  /* ---------- Administración (provincial) ---------- */
  async function renderAdmin() {
    if (!S.isAdmin) { $('app').innerHTML = '<div class="empty">Esta sección es para los administradores.</div>'; return; }
    const cs = Object.values(S.campanas).sort((a, b) => String(b.desde || '').localeCompare(String(a.desde || '')));
    escucharSoporte();
    let h = soporteHTML(true);
    h += `<div class="sec">Campañas <button type="button" class="sbtn pri" data-nueva>+ Campaña</button></div><div class="card">`;
    h += cs.map(c => `<div class="edit-row adm"><div><b>${esc(c.nombre)}</b><small style="display:block;color:var(--soft);font-size:12px;">${esc(c.ciudad || '')} · ${esc(campRango(c))}${c.activa === false ? ' · oculta' : ''}</small><small style="display:block;color:var(--soft);font-size:12px;">Coordinan: ${esc((S.coordEmails[c.id] || []).join(', ') || '—')}</small></div><div style="display:flex;gap:6px;"><button type="button" class="sbtn" data-coords="${esc(c.id)}">Coordinadores</button><button type="button" class="sbtn" data-go="#/coord/${esc(c.id)}">Abrir</button></div></div>`).join('') || '<div class="empty">Creá la primera campaña.</div>';
    h += `</div><div class="sec">Congregaciones</div><div class="card" style="padding:12px 13px;"><p class="note" style="margin:0 0 8px;">Una por renglón, con la ciudad: "San Agustín (Paraná)". Es la lista que eligen los publicadores al pedir un turno.</p><div class="fld"><textarea id="adCongs" rows="8">${esc((S.publico.congregaciones || []).join('\n'))}</textarea></div><button type="button" class="btn" id="adCongsOk">Guardar lista</button></div>`;
    h += `<div class="sec">Administradores</div><div class="card" style="padding:12px 13px;"><p class="note" style="margin:0 0 8px;">Pueden crear campañas y elegir sus coordinadores. Un email por renglón.</p><div class="fld"><textarea id="adAdm" rows="3">${esc(S.admins.join('\n'))}</textarea></div><button type="button" class="btn" id="adAdmOk">Guardar</button></div>`;
    h += `<div class="sec">Inicio</div><div class="card" style="padding:12px 13px;"><label class="ck" style="margin:0 2px"><input type="checkbox" id="adMapa"${S.publico.mapa !== false ? ' checked' : ''}> <span><b>Mostrar el mapa en el Inicio</b><br>Debajo de "Campañas" se puede elegir Lista o Mapa. Si lo apagás, todos ven solo la lista.</span></label></div>`;
    h += `<div class="sec">Historial de cambios</div><div class="card" style="padding:12px 13px;"><p class="note" style="margin:0 0 8px;">Quién creó, cambió o borró algo, en todas las campañas y en esta configuración, y cuándo. Lo borrado se puede restaurar desde ahí.</p><button type="button" class="sbtn pri" data-histgen>${I('clock', 'width:15px;height:15px')}Ver el historial</button></div>`;
    h += `<div class="sec">Equipo de soporte</div><div class="card" style="padding:12px 13px;"><p class="note" style="margin:0 0 8px;">Ven los reportes de problemas y los errores de la página. No cambian campañas ni ven los pedidos. Un email por renglón.</p><div class="fld"><textarea id="adSop" rows="3">${esc(S.soporteEmails.join('\n'))}</textarea></div><button type="button" class="btn" id="adSopOk">Guardar</button></div>`;
    $('app').innerHTML = h;
    $('adMapa').addEventListener('change', async (e) => {
      const on = e.target.checked;
      try { await S.db.doc('config/publico').set({ mapa: on }, { merge: true }); auditar('', 'config', on ? 'prendió el mapa del Inicio' : 'apagó el mapa del Inicio'); toast(on ? 'El mapa se muestra en el Inicio' : 'El mapa quedó apagado'); } catch (er) { e.target.checked = !on; toast('No se pudo guardar.'); }
    });
    $('adSopOk').addEventListener('click', async () => {
      const lista = [...new Set($('adSop').value.split('\n').map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
      const sa = S.soporteEmails || [];
      try { await S.db.doc('config/soporte').set({ emails: lista }); auditar('', 'config', 'cambió el equipo de soporte' + difTxt(sa, lista)); S.soporteEmails = lista; toast('Equipo de soporte guardado'); renderAdmin(); } catch (e) { toast('No se pudo guardar.'); }
    });
    $('adCongsOk').addEventListener('click', async () => {
      const lista = [...new Set($('adCongs').value.split('\n').map(s => s.trim()).filter(Boolean))];
      const ca = S.publico.congregaciones || [];
      try { await S.db.doc('config/publico').set({ congregaciones: lista }, { merge: true }); auditar('', 'config', 'cambió la lista de congregaciones' + difTxt(ca, lista)); toast('Lista guardada'); } catch (e) { toast('No se pudo guardar.'); }
    });
    $('adAdmOk').addEventListener('click', async () => {
      const lista = [...new Set($('adAdm').value.split('\n').map(s => s.trim().toLowerCase()).filter(s => /@/.test(s)))];
      if (!lista.includes(S.user.email.toLowerCase()) && !confirm('No estás en la lista: vas a dejar de ser administrador. ¿Seguir?')) return;
      const aa = S.admins || [];
      try { await S.db.doc('config/admins').set({ emails: lista }); auditar('', 'config', 'cambió los administradores' + difTxt(aa, lista)); S.admins = lista; toast('Guardado'); } catch (e) { toast('No se pudo guardar.'); }
    });
    // Coordinadores de cada campaña (solo los ven los administradores)
    const faltan = cs.filter(c => !(c.id in S.coordEmails));
    for (const c of faltan) { try { const d = await S.db.doc('coordinadores/' + c.id).get(); S.coordEmails[c.id] = (d.exists && d.data().emails) || []; } catch (e) { S.coordEmails[c.id] = []; } }
    if (faltan.length && S.route.name === 'admin') renderAdmin();
  }
  function nuevaCampana() {
    const ov = sheet(`<h3>Nueva campaña</h3><p class="hint">Después agregás los puntos y los turnos desde "Configurar".</p>
      <div class="fld"><label for="ncNom">Nombre</label><input id="ncNom" placeholder="Terminal de ómnibus"></div>
      <div class="two"><div class="fld"><label for="ncCiu">Ciudad</label><input id="ncCiu" placeholder="Paraná"></div><div class="fld"><label for="ncLug">Lugar (opcional)</label><input id="ncLug"></div></div>
      <div class="two"><div class="fld"><label for="ncDes">Desde</label><input id="ncDes" type="date" value="${hoy()}"></div><div class="fld"><label for="ncHas">Hasta</label><input id="ncHas" type="date" value="${addDays(hoy(), 30)}"></div></div>
      <button type="button" class="btn" id="ncOk">Crear</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const q = (s) => ov.querySelector(s);
    q('#ncOk').addEventListener('click', async () => {
      const d = { nombre: q('#ncNom').value.trim(), ciudad: q('#ncCiu').value.trim(), lugar: q('#ncLug').value.trim(), desde: q('#ncDes').value, hasta: q('#ncHas').value, activa: true, puntos: {}, turnos: {},
        creada: new Date().toISOString() };
      if (!d.nombre || !d.ciudad || !d.desde || !d.hasta || d.hasta < d.desde) { toast('Completá nombre, ciudad y fechas.'); return; }
      const slug = (d.ciudad + '-' + d.nombre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + uidGen().slice(0, 3);
      try { await S.db.doc('campanas/' + slug).set(d); auditar(slug, 'creo_campana', `creó la campaña ${d.nombre} (${d.ciudad})`); ov.remove(); toast('Campaña creada'); S.coord.tab = 'config'; go('#/coord/' + slug); } catch (e) { console.error(e); toast('No se pudo crear.'); }
    });
  }
  function editarCoordinadores(cid) {
    const c = S.campanas[cid], antes = S.coordEmails[cid] || [];
    const ov = sheet(`<h3>Coordinadores</h3><p class="hint">${esc(c.nombre)} · ${esc(c.ciudad || '')}. Un email por renglón (el de su cuenta de Google). Confirman los pedidos y configuran la campaña.</p>
      <div class="fld"><textarea id="coEm" rows="4">${esc(antes.join('\n'))}</textarea></div><button type="button" class="btn" id="coOk">Guardar</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    ov.querySelector('#coOk').addEventListener('click', async () => {
      const lista = [...new Set(ov.querySelector('#coEm').value.split('\n').map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))];
      const batch = S.db.batch();
      batch.set(S.db.doc('coordinadores/' + cid), { emails: lista });
      const arr = window.__ppamMock ? window.__ppamMock.arr : firebase.firestore.FieldValue;
      lista.filter(e => !antes.includes(e)).forEach(e => batch.set(S.db.doc('roles/' + e), { campanas: arr.arrayUnion(cid) }, { merge: true }));
      antes.filter(e => !lista.includes(e)).forEach(e => batch.set(S.db.doc('roles/' + e), { campanas: arr.arrayRemove(cid) }, { merge: true }));
      try { await batch.commit(); auditar(cid, 'coordinadores', 'cambió los coordinadores' + difTxt(antes, lista)); S.coordEmails[cid] = lista; ov.remove(); toast('Coordinadores guardados'); renderAdmin(); } catch (e) { console.error(e); toast('No se pudo guardar.'); }
    });
  }

  /* ---------- Privacidad ---------- */
  function privacidad() {
    sheet(`<h3>Cómo se usan tus datos</h3><div class="hint" style="font-size:13.5px;line-height:1.55;">
      <p>Para pedir un turno te pedimos <b>nombre, apellido, congregación y celular</b>. Los ven <b>solo los coordinadores de esa campaña</b> (y los administradores), para organizar los turnos y avisarte si hay un cambio.</p>
      <p>En la página pública solo se ve cuántos lugares quedan en cada turno, nunca quién los ocupa.</p>
      <p>No se usan para nada más ni se comparten con nadie. Podés cancelar tu turno cuando quieras desde "Mis turnos", y así se borran tus datos de ese turno.</p>
      <p>Iniciás sesión con Google solo para que nadie pueda pedir turnos a tu nombre.</p>
      <p>Si mandás un reporte de problema, lo ve el equipo de soporte de la PPAM, con tu cuenta y tu celular si los dejaste, para poder responderte. Cuando algo falla, la página anota solo el error, la pantalla y el tipo de celular, sin tus datos.</p></div><button type="button" class="btn" data-cerrar>Entendido</button>`);
  }


  /* ---------- Soporte: reportes de problemas y errores automáticos ----------
     reportes/{id}: lo que manda un hermano con "Reportar un problema" (lo ven Soporte y los administradores).
     errores/{id}: lo que la página anota sola cuando algo falla (sin datos personales).
     Topes en el celular: 5 reportes y 30 errores por día (para cuidar la cuota gratis de Firebase). */
  const REP_TIPOS = ['No me deja anotarme', 'No carga / se queda en blanco', 'Un dato está mal', 'No veo un botón', 'Otro'];
  function dispositivo() {
    const ua = navigator.userAgent || '';
    let so = /Android ([\d.]+)/.test(ua) ? 'Android ' + RegExp.$1.split('.')[0] : /iPhone|iPad|iPod/.test(ua) ? ((/iPad/.test(ua) ? 'iPad' : 'iPhone') + (/OS (\d+)/.test(ua) ? ' · iOS ' + RegExp.$1 : '')) : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Otro';
    const nav = /SamsungBrowser\/(\d+)/.test(ua) ? 'Samsung Internet ' + RegExp.$1 : /Edg\/(\d+)/.test(ua) ? 'Edge ' + RegExp.$1 : /(?:Chrome|CriOS)\/(\d+)/.test(ua) ? 'Chrome ' + RegExp.$1 : /(?:Firefox|FxiOS)\/(\d+)/.test(ua) ? 'Firefox ' + RegExp.$1 : /Version\/(\d+).*Safari/.test(ua) ? 'Safari ' + RegExp.$1 : 'Navegador';
    return (so + ' · ' + nav).slice(0, 80);
  }
  function tope(clave, max) {
    try {
      const k = 'ppam-tope-' + clave, d = JSON.parse(localStorage.getItem(k) || '{}'), h = hoy();
      const n = d.dia === h ? d.n : 0;
      if (n >= max) return false;
      localStorage.setItem(k, JSON.stringify({ dia: h, n: n + 1 }));
      return true;
    } catch (e) { return true; }
  }
  const pantallaActual = () => (location.hash || '#/').slice(0, 100);
  function pantallaLabel(h) {
    const x = String(h || '#/').slice(1).split('/').filter(Boolean);
    const camp = (id) => { const c = S.campanas[id]; return c ? c.nombre + (c.ciudad ? ' (' + c.ciudad + ')' : '') : id; };
    if (x[0] === 'c' && x[1]) return camp(x[1]);
    if (x[0] === 't' && x[1]) return 'Tu turno · ' + camp(decodeURIComponent(x[1]).split('__')[0]);
    if (x[0] === 'mis') return 'Mis turnos';
    if (x[0] === 'coord') return 'Coordinación' + (x[1] ? ' · ' + camp(x[1]) : '');
    if (x[0] === 'admin') return 'Administración';
    if (x[0] === 'soporte') return 'Soporte';
    return 'Inicio';
  }
  let enRegistro = false;
  function registrarError(tipo, msg) {
    const m = String(msg || '').slice(0, 300);
    if (!m || enRegistro) return;
    S.ultimoError = { msg: m, hora: new Date().toISOString() };
    if (!S.db || !tope('err', 30)) return;
    enRegistro = true;
    try {
      S.db.collection('errores').doc(Date.now().toString(36) + uidGen()).set({ tipo, msg: m, pantalla: pantallaActual(), disp: dispositivo(), ver: VERSION, creado: new Date().toISOString() }).catch(() => {});
    } catch (e) { /* nada */ }
    enRegistro = false;
  }
  window.addEventListener('error', (e) => { if (e && e.message) registrarError('js', e.message + (e.filename ? ' · ' + String(e.filename).split('/').pop() + ':' + e.lineno : '')); });
  window.addEventListener('unhandledrejection', (e) => { const r = e && e.reason; registrarError('js', (r && (r.code || r.message)) || String(r)); });

  function reportar() {
    const pf = perfil();
    const ult = S.ultimoError;
    const ov = sheet(`<h3>Reportar un problema</h3><p class="hint">Contanos qué pasó. Lo recibe el equipo de soporte de la PPAM.</p>
      <div class="fld"><label>¿Qué pasó?</label></div>
      <div class="rp-chips">${REP_TIPOS.map(t => `<button type="button" data-rptipo="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="fld"><label for="rpTx">Contalo con tus palabras</label><textarea id="rpTx" rows="3" maxlength="1000" placeholder="Qué estabas haciendo, qué tocaste y qué apareció"></textarea></div>
      <div class="fld"><label for="rpCel">Tu celular <span class="opc">(opcional, para responderte)</span></label><input id="rpCel" type="tel" value="${esc(pf.celular || '')}" placeholder="343 555-0000"></div>
      <div class="fld"><label>Se envía también</label></div>
      <div class="rp-tec"><b>Pantalla:</b> ${esc(pantallaLabel(pantallaActual()))}<br><b>Celular:</b> ${esc(dispositivo())}<br><b>Versión:</b> ${VERSION}${ult ? ` · <b>Último error:</b> "${esc(ult.msg.slice(0, 80))}"` : ''}${S.user ? `<br><b>Tu cuenta:</b> ${esc(S.user.email)}` : ''}</div>
      <p class="err hidden" id="rpErr"></p>
      <button type="button" class="btn" id="rpGo">Enviar reporte</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const q = (x) => ov.querySelector(x);
    let tipo = '';
    ov.querySelectorAll('[data-rptipo]').forEach(b => b.addEventListener('click', () => { tipo = b.dataset.rptipo; ov.querySelectorAll('[data-rptipo]').forEach(x => x.classList.toggle('on', x === b)); }));
    q('#rpGo').addEventListener('click', async () => {
      const texto = q('#rpTx').value.trim().slice(0, 1000), cel = q('#rpCel').value.trim().slice(0, 30);
      const err = (m) => { q('#rpErr').textContent = m; q('#rpErr').classList.remove('hidden'); };
      if (!tipo) return err('Elegí qué pasó.');
      if (texto.length < 3) return err('Contá en pocas palabras qué pasó.');
      if (!tope('rep', 5)) return err('Ya mandaste varios reportes hoy. Si es urgente, avisale a tu coordinador.');
      const d = { tipo, texto, pantalla: pantallaActual(), disp: dispositivo(), ver: VERSION, estado: 'nuevo', creado: new Date().toISOString() };
      if (ult) d.ultErr = ult.msg.slice(0, 300);
      if (cel) d.celular = cel;
      if (S.user) { d.uid = S.user.uid; d.email = S.user.email.toLowerCase(); const n = [pf.nombre, pf.apellido].filter(Boolean).join(' ') || S.user.displayName || ''; if (n) d.nombre = n.slice(0, 80); }
      const b = q('#rpGo'); b.disabled = true; b.textContent = 'Enviando…';
      try { await S.db.collection('reportes').doc(Date.now().toString(36) + uidGen()).set(d); ov.remove(); toast('¡Gracias! Lo recibió el equipo de soporte.'); }
      catch (e) { console.error(e); b.disabled = false; b.textContent = 'Enviar reporte'; err('No se pudo enviar. Revisá la conexión y probá de nuevo.'); }
    });
  }

  function escucharSoporte() {
    if (!(S.isAdmin || S.isSoporte) || S.sop.on) return;
    S.sop.on = true;
    let pend = false;
    const re = () => { if (pend) return; pend = true; setTimeout(() => { pend = false; if (S.route.name === 'soporte' || S.route.name === 'admin') { const y = window.scrollY; render(); window.scrollTo(0, y); } }, 0); };
    S.sop.unsub.push(S.db.collection('reportes').onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.sop.reportes = o; S.sop.okR = true; limpiarViejos(); re(); }, (e) => console.error(e)));
    S.sop.unsub.push(S.db.collection('errores').onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.sop.errores = o; S.sop.okE = true; limpiarViejos(); re(); }, (e) => console.error(e)));
  }
  // Los reportes resueltos hace más de 60 días y los errores de más de 30 se borran solos (una vez por sesión).
  function limpiarViejos() {
    if (S.sop.limpio || !S.sop.okR || !S.sop.okE) return;   // una vez, con las dos listas cargadas
    S.sop.limpio = true;
    const lim60 = new Date(Date.now() - 60 * 864e5).toISOString(), lim30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const viejos = Object.keys(S.sop.reportes).filter(id => S.sop.reportes[id].estado === 'resuelto' && String(S.sop.reportes[id].actualizado || S.sop.reportes[id].creado) < lim60).map(id => 'reportes/' + id)
      .concat(Object.keys(S.sop.errores).filter(id => String(S.sop.errores[id].creado) < lim30).map(id => 'errores/' + id)).slice(0, 200);
    if (!viejos.length) return;
    const b = S.db.batch(); viejos.forEach(x => b.delete(S.db.doc(x))); b.commit().catch(() => {});
  }
  function haceCuanto(iso) {
    const d = new Date(iso), hh = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const dif = Math.round((new Date(hoy() + 'T12:00:00') - new Date(isoDia(d) + 'T12:00:00')) / 864e5);
    return dif === 0 ? 'hoy ' + hh : dif === 1 ? 'ayer ' + hh : d.getDate() + '/' + (d.getMonth() + 1) + ' ' + hh;
  }
  const isoDia = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function soporteHTML(enAdmin) {
    if (!(S.isAdmin || S.isSoporte)) return '';
    const reps = Object.keys(S.sop.reportes).map(id => Object.assign({ id }, S.sop.reportes[id])).sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    const errs = Object.keys(S.sop.errores).map(id => Object.assign({ id }, S.sop.errores[id])).sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    const n = { nuevo: 0, visto: 0, resuelto: 0 }; reps.forEach(r => { n[r.estado] = (n[r.estado] || 0) + 1; });
    const tagN = n.nuevo ? `<span class="rp-tag nuevo">${n.nuevo} ${n.nuevo === 1 ? 'nuevo' : 'nuevos'}</span>` : '';
    let h = enAdmin ? `<div class="sec">Reportes y errores ${tagN}</div>` : '';
    const desde = new Date(Date.now() - 864e5).toISOString(), e24 = errs.filter(e => String(e.creado) >= desde);
    if (e24.length) {
      const g = {}; e24.forEach(e => { const k = e.msg; g[k] = g[k] || { msg: k, n: 0, lugares: {}, disp: {} }; g[k].n++; g[k].lugares[pantallaLabel(e.pantalla)] = 1; g[k].disp[e.disp] = 1; });
      const top = Object.values(g).sort((a, b) => b.n - a.n).slice(0, 2);
      h += `<div class="rp-auto">${I('alert', 'width:16px;height:16px;flex-shrink:0;margin-top:2px')}<span><b>Errores automáticos: ${e24.length} en las últimas 24 h</b>${top.map(x => `${x.n} × "${esc(x.msg.slice(0, 70))}" · ${esc(Object.keys(x.lugares).slice(0, 2).join(', '))}`).join('<br>')}<br><button type="button" class="linkish rp-det" data-rpdet>${S.sop.detalle ? 'Ocultar detalle' : 'Ver detalle'}</button></span></div>`;
    } else h += `<div class="rp-auto ok">${I('check', 'width:16px;height:16px;flex-shrink:0;margin-top:2px')}<span><b>Sin errores automáticos en las últimas 24 h</b>${errs.length ? 'El último fue ' + esc(haceCuanto(errs[0].creado)) + '.' : 'Todavía no se registró ninguno.'}${errs.length ? `<br><button type="button" class="linkish rp-det" data-rpdet>${S.sop.detalle ? 'Ocultar detalle' : 'Ver detalle'}</button>` : ''}</span></div>`;
    if (S.sop.detalle && errs.length) h += '<div class="card">' + errs.slice(0, 30).map(e => `<div class="rp-item"><div class="m">${esc(haceCuanto(e.creado))} · ${esc(pantallaLabel(e.pantalla))}</div><p class="rp-msg">${esc(e.msg)}</p><div class="m">${esc(e.disp)} · v${esc(e.ver)}${e.ver !== VERSION ? ' (versión vieja)' : ''}</div></div>`).join('') + '</div>';
    const F = [['nuevo', 'Nuevos'], ['visto', 'Vistos'], ['resuelto', 'Resueltos']];
    h += `<div class="rp-seg">${F.map(([k, l]) => `<button type="button" class="${S.sop.filtro === k ? 'on' : ''}" data-rpfiltro="${k}">${l} (${n[k] || 0})</button>`).join('')}</div>`;
    const lista = reps.filter(r => (r.estado || 'nuevo') === S.sop.filtro);
    h += '<div class="card">' + (lista.map(r => {
      const tel = String(r.celular || '').replace(/\D/g, '');
      const acc = [tel ? `<a class="sbtn" href="https://wa.me/${tel.length === 10 ? '549' + tel : tel}" target="_blank" rel="noopener">${I('chat', 'width:15px;height:15px')}WhatsApp</a>` : '', r.email ? `<a class="sbtn" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('PPAM · ' + r.tipo)}">Email</a>` : '',
        r.estado !== 'visto' && r.estado !== 'resuelto' ? `<button type="button" class="sbtn" data-rpestado="${esc(r.id)}|visto">Marcar visto</button>` : '',
        r.estado === 'resuelto' ? `<button type="button" class="sbtn" data-rpestado="${esc(r.id)}|nuevo">Volver a abrir</button>` : `<button type="button" class="sbtn pri" data-rpestado="${esc(r.id)}|resuelto">${I('check', 'width:15px;height:15px')}Resuelto</button>`].filter(Boolean).join('');
      return `<div class="rp-item"><div class="h"><b>${esc(r.tipo)}</b><span class="rp-tag ${r.estado === 'resuelto' ? 'ok' : r.estado === 'visto' ? 'visto' : 'nuevo'}">${r.estado === 'resuelto' ? 'Resuelto' : r.estado === 'visto' ? 'Visto' : 'Nuevo'}</span></div>
        <div class="m">${esc(r.nombre || (r.uid ? r.email : 'Sin nombre (no inició sesión)'))} · ${esc(pantallaLabel(r.pantalla))} · ${esc(haceCuanto(r.creado))}</div><p>${esc(r.texto)}</p>
        <div class="m">${esc(r.disp)} · v${esc(r.ver)}${r.ver !== VERSION ? ' (versión vieja)' : ''}${r.ultErr ? ' · último error: "' + esc(r.ultErr.slice(0, 80)) + '"' : ''}${r.email ? ' · ' + esc(r.email) : ''}</div>
        <div class="acts" style="margin:10px 0 0">${acc}</div></div>`;
    }).join('') || `<div class="empty">${S.sop.filtro === 'nuevo' ? 'No hay reportes nuevos.' : 'Nada por acá.'}</div>`) + '</div>';
    return h;
  }
  function renderSoporte() {
    if (!S.user) { $('app').innerHTML = '<div class="empty">Iniciá sesión para ver los reportes.</div><button type="button" class="btn" data-login>Iniciar sesión con Google</button>'; return; }
    if (!(S.isAdmin || S.isSoporte)) { $('app').innerHTML = '<div class="empty">Esta sección es para el equipo de soporte.</div>'; return; }
    escucharSoporte();
    $('app').innerHTML = soporteHTML(false);
  }
  async function cambiarReporte(id, estado) {
    try { await S.db.doc('reportes/' + id).update({ estado, actualizado: new Date().toISOString(), por: S.user.email.toLowerCase() }); toast(estado === 'resuelto' ? 'Marcado como resuelto' : estado === 'visto' ? 'Marcado como visto' : 'Vuelve a Nuevos'); }
    catch (e) { console.error(e); toast('No se pudo guardar.'); }
  }


  /* ---------- Instalar la app (PWA) ----------
     Android/Chrome: se guarda el aviso del navegador (beforeinstallprompt) y "Instalar" lo abre.
     iPhone/iPad (Safari): no hay botón posible; se muestran los dos pasos (Compartir → Agregar a inicio).
     No se ofrece si ya está instalada (abre sola) ni en computadoras. Cerrar = vuelve en 30 días; "No mostrar más" = nunca. */
  let promptInstalar = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalar = e; if (S.route.name === 'home' && S.loaded) renderHome(); });
  window.addEventListener('appinstalled', () => { promptInstalar = null; instGuardar('never'); if (S.route.name === 'home' && S.loaded) renderHome(); });
  const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const yaInstalada = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const puedeInstalar = () => !yaInstalada() && (!!promptInstalar || esIOS());
  function instEstado() { try { return localStorage.getItem('ppam-instalar') || ''; } catch (e) { return ''; } }
  function instGuardar(v) { try { localStorage.setItem('ppam-instalar', v); } catch (e) { /* nada */ } }
  function instalarHTML() {
    if (!puedeInstalar()) return '';
    const st = instEstado();
    if (st === 'never' || (st && st > new Date().toISOString())) return '';
    return `<div class="inst" id="instBan"><img src="./icon-192.png" alt=""><span class="tx"><b>Instalá la app PPAM</b>Abrila desde la pantalla de inicio, como cualquier app.</span><button type="button" class="go" data-instalar>Instalar</button><button type="button" class="x" data-instcerrar aria-label="Cerrar">×</button></div>`;
  }
  async function instalar() {
    if (promptInstalar) {
      const e = promptInstalar; promptInstalar = null;
      try { e.prompt(); const r = await e.userChoice; if (r && r.outcome === 'accepted') instGuardar('never'); } catch (er) { /* nada */ }
      if (S.route.name === 'home') renderHome();
      return;
    }
    const SH = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
    const PL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
    const ov = sheet(`<div class="inst-h"><img src="./icon-192.png" alt=""><div><h3>Instalá la app PPAM</h3><p class="hint" style="margin:2px 0 0">En iPhone son dos pasos, en Safari:</p></div></div>
      <div class="inst-st"><span class="n">1</span><span>Tocá <span class="k">${SH} Compartir</span> en la barra de abajo de Safari.</span></div>
      <div class="inst-st"><span class="n">2</span><span>Bajá y elegí <span class="k">${PL} Agregar a inicio</span>, después <b>Agregar</b>.</span></div>
      <p class="hint" style="margin:10px 0 14px">Listo: vas a ver el ícono de la PPAM en tu pantalla de inicio.</p>
      <button type="button" class="btn" data-cerrar>Entendido</button><button type="button" class="btn alt" id="instNunca">No mostrar más</button>`);
    ov.querySelector('#instNunca').addEventListener('click', () => { instGuardar('never'); ov.remove(); if (S.route.name === 'home') renderHome(); });
  }


  /* ---------- Mapa de Entre Ríos en el Inicio (Leaflet + OpenStreetMap) ----------
     Lista | Mapa debajo de "Campañas". El mapa se arma una sola vez y se reutiliza (no se pierde el zoom al
     refrescar el Inicio). La provincia queda resaltada (contorno en mapa-er.js, que se carga recién al abrir el mapa).
     Los pines se agrupan por cercanía en pantalla: de lejos, por localidad; al acercarse, una por campaña; muy de
     cerca, un pin por punto (carrito o stand). Tocar un grupo acerca hasta separarlo; tocar una campaña o un punto:
     onda dorada, el pin se vuelve su foto de portada y sube la tarjeta con "Ver turnos". No gasta lecturas. */
  S.vista = (() => { try { return localStorage.getItem('ppam-vista') || 'lista'; } catch (e) { return 'lista'; } })();
  S.mapa = { sel: null, yo: null, el: null, map: null, capa: null, cs: [] };
  // Centro aproximado de las localidades (para campañas sin puntos marcados en el mapa).
  const CIUDADES_ER = { 'parana': [-31.744, -60.517], 'concordia': [-31.392, -58.021], 'gualeguaychu': [-33.009, -58.517], 'concepcion del uruguay': [-32.483, -58.237], 'gualeguay': [-33.142, -59.31], 'victoria': [-32.618, -60.155], 'villaguay': [-31.865, -59.027], 'la paz': [-30.744, -59.645], 'chajari': [-30.75, -57.98], 'colon': [-32.224, -58.144], 'nogoya': [-32.394, -59.787], 'federal': [-30.955, -58.783], 'federacion': [-30.979, -57.923], 'diamante': [-32.066, -60.639], 'crespo': [-32.028, -60.307], 'rosario del tala': [-32.303, -59.145], 'san jose de feliciano': [-30.386, -58.752], 'feliciano': [-30.386, -58.752], 'san salvador': [-31.625, -58.505], 'villa elisa': [-32.163, -58.4], 'san jose': [-32.2, -58.212], 'basavilbaso': [-32.373, -58.879], 'urdinarrain': [-32.686, -58.894], 'larroque': [-33.036, -59.001], 'islas del ibicuy': [-33.744, -59.172], 'ibicuy': [-33.744, -59.172], 'viale': [-31.869, -60.007], 'hasenkamp': [-31.513, -59.836], 'maria grande': [-31.666, -59.904], 'san benito': [-31.783, -60.441], 'oro verde': [-31.825, -60.517], 'colonia avellaneda': [-31.767, -60.405], 'cerrito': [-31.582, -60.074], 'santa elena': [-30.946, -59.787], 'bovril': [-31.343, -59.445], 'ramirez': [-32.172, -60.2], 'general ramirez': [-32.172, -60.2], 'lucas gonzalez': [-32.384, -59.529], 'villa paranacito': [-33.72, -58.658], 'gilbert': [-32.53, -58.934], 'ubajay': [-31.795, -58.312], 'los conquistadores': [-30.594, -58.465], 'san jaime de la frontera': [-30.338, -58.31] };
  const lev = (a, b) => { if (Math.abs(a.length - b.length) > 2) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const capNombre = (x) => String(x || '').trim().replace(/\s+/g, ' ').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  const sinTilde = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const COL_MAPA = { ok: '#1F7A55', poco: '#B8924A', full: '#8A939C' };
  function estadoCamp(c) {
    const dias = diasDe(c); if (!dias.length) return { est: 'full', faltan: 0, txt: 'Sin turnos por delante' };
    const k = cobertura(c, dias.filter(d => d <= addDays(dias[0], 6)));
    const est = k.faltan <= 0 ? 'full' : (k.faltan <= 3 || k.ocup / Math.max(1, k.total) >= .75) ? 'poco' : 'ok';
    const cuando = dias[0] <= addDays(hoy(), 6) ? 'esta semana' : 'la primera semana';
    return { est, faltan: k.faltan, txt: k.faltan > 0 ? `${k.faltan === 1 ? 'Falta 1 lugar' : 'Faltan ' + k.faltan + ' lugares'} ${cuando}` : `Completo ${cuando}` };
  }
  // Campañas con ubicación: sus puntos marcados o, si no hay, el centro de su localidad.
  function campsMapa(cs) {
    return cs.map(c => {
      const pts = Object.keys(c.puntos || {}).map(id => Object.assign({ id }, c.puntos[id])).filter(p => p.lat != null && p.lng != null);
      let lat, lng;
      if (pts.length) { lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length; lng = pts.reduce((a, p) => a + p.lng, 0) / pts.length; }
      else { const cc = CIUDADES_ER[sinTilde(c.ciudad)]; if (!cc) return null; [lat, lng] = cc; }
      return { c, e: estadoCamp(c), lat, lng, pts };
    }).filter(Boolean);
  }
  const fueraDelMapa = (cs) => cs.filter(c => !Object.values(c.puntos || {}).some(p => p.lat != null && p.lng != null) && !CIUDADES_ER[sinTilde(c.ciudad)]);
  function mapaHTML() { return `<div class="mapw" id="mapw"><div class="empty" style="padding:40px 0">Cargando el mapa…</div></div><div class="mleg"><span><i style="background:${COL_MAPA.ok}"></i>Hay lugar</span><span><i style="background:${COL_MAPA.poco}"></i>Quedan pocos</span><span><i style="background:${COL_MAPA.full}"></i>Completo</span><span class="mhint">Tocá un pin para ver la campaña</span></div>`; }
  let cargandoER = null;
  function cargarER() {
    if (window.PPAM_ER) return Promise.resolve();
    if (!cargandoER) cargandoER = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = './mapa-er.js?v=' + VERSION; sc.onload = res; sc.onerror = () => { cargandoER = null; rej(new Error('mapa')); }; document.head.appendChild(sc); });
    return cargandoER;
  }
  async function dibujarMapa(cs) {
    S.mapa.cs = campsMapa(cs);
    try { await Promise.all([cargarLeaflet(), cargarER()]); }
    catch (e) { const w = $('mapw'); if (w) w.innerHTML = '<div class="empty" style="padding:40px 12px">No se pudo cargar el mapa. Revisá la conexión y probá de nuevo.</div>'; return; }
    const w = $('mapw'); if (!w) return;
    if (!S.mapa.el) crearMapaInicio();
    w.innerHTML = ''; w.appendChild(S.mapa.el);
    S.mapa.map.invalidateSize();
    const firma = S.mapa.cs.map(x => x.c.id).sort().join();
    if (S.mapa.firma !== firma) { S.mapa.firma = firma; verTodo(false); }
    pinesMapa();
  }
  function crearMapaInicio() {
    const L = window.L, el = document.createElement('div');
    el.className = 'mapin';
    el.innerHTML = `<div id="lmap"></div>
      <div class="mctl"><button type="button" data-mz="1" aria-label="Acercar" title="Acercar">+</button><button type="button" data-mz="-1" aria-label="Alejar" title="Alejar">−</button><button type="button" data-cerca aria-label="Cerca mío" title="Cerca mío">${I('gps', 'width:17px;height:17px')}</button><button type="button" data-mtodo aria-label="Ver todas las campañas" title="Ver todas las campañas">${I('fit', 'width:17px;height:17px')}</button></div>
      <div class="msheet" id="msheet"><div class="grab"></div><div id="msBody"></div></div>`;
    S.mapa.el = el;
    document.body.appendChild(el);   // Leaflet necesita el contenedor en la página para medirlo
    const m = L.map(el.querySelector('#lmap'), { zoomControl: false, minZoom: 7, maxZoom: 18, zoomSnap: .25, wheelPxPerZoomLevel: 90 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(m);
    const ER = window.PPAM_ER, prov = ER.prov.map(r => r.map(([x, y]) => [y, x]));
    const oscuro = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    L.polygon([[[-89, -179], [-89, 179], [89, 179], [89, -179]], ...prov], { stroke: false, fillColor: oscuro ? '#0F1A19' : '#F6F5F1', fillOpacity: .72, interactive: false }).addTo(m);
    L.polygon(prov, { color: '#12433F', weight: 2.2, fill: false, interactive: false }).addTo(m);
    const deps = ER.deps.map(d => L.polygon(d.r.map(r => r.map(([x, y]) => [y, x])), { color: '#12433F', weight: .8, opacity: .25, fill: false, interactive: false }).addTo(m));
    S.mapa.bounds = L.polygon(prov).getBounds();
    m.setMaxBounds(S.mapa.bounds.pad(.6));
    S.mapa.map = m; S.mapa.capa = L.layerGroup().addTo(m);
    m.on('zoomend', () => { if (!S.mapa.sel) pinesMapa(); });
    m.on('zoom', () => { const z = m.getZoom(); deps.forEach(l => l.setStyle({ opacity: z < 10 ? .25 : 0 })); });
    m.on('click', () => cerrarPin());
    if (S.mapa.yo) pintarYo();
  }
  // Encuadra todas las campañas (si no hay ninguna ubicada, la provincia entera).
  function verTodo(anim) {
    const m = S.mapa.map; if (!m) return; cerrarPin();
    const ll = S.mapa.cs.flatMap(x => x.pts.length ? x.pts.map(p => [p.lat, p.lng]) : [[x.lat, x.lng]]);
    const b = ll.length ? window.L.latLngBounds(ll) : S.mapa.bounds;
    const opt = { paddingTopLeft: [50, 70], paddingBottomRight: [60, 40], maxZoom: ll.length ? 13 : 9 };
    if (anim) m.flyToBounds(b, Object.assign({ duration: .6 }, opt)); else m.fitBounds(b, opt);
  }
  // Lo que se muestra según el zoom: campañas o, muy de cerca, sus puntos.
  function itemsMapa() {
    const z = S.mapa.map.getZoom();
    if (z >= 14.5) return S.mapa.cs.flatMap(x => x.pts.length ? x.pts.map(p => ({ tipo: 'pt', key: x.c.id + ':' + p.id, lat: p.lat, lng: p.lng, xs: [x], lab: p.nombre || x.c.nombre, p })) : [{ tipo: 'camp', key: x.c.id, lat: x.lat, lng: x.lng, xs: [x], lab: x.c.nombre }]);
    return S.mapa.cs.map(x => ({ tipo: 'camp', key: x.c.id, lat: x.lat, lng: x.lng, xs: [x], lab: x.c.nombre }));
  }
  function agruparMapa(list) {
    const m = S.mapa.map, out = [], R = 46;
    list.forEach(it => {
      const p = m.latLngToLayerPoint([it.lat, it.lng]);
      const g = out.find(o => o.p.distanceTo(p) < R);
      if (g) { g.items.push(it); it.xs.forEach(x => { if (!g.xs.includes(x)) g.xs.push(x); }); } else out.push({ p, items: [it], xs: [...it.xs] });
    });
    const z = m.getZoom();
    return out.map(g => {
      const n = g.items.length, ciu = [...new Set(g.xs.map(x => x.c.ciudad || ''))];
      const lugar = ciu.length === 1 ? ciu[0] : ciu.length + ' localidades';
      const lab = z < 11 ? lugar : n === 1 ? g.items[0].lab : g.xs.length === 1 ? g.xs[0].c.nombre : lugar;
      const sub = n > 1 ? `· ${n}${g.xs.length === 1 && g.items[0].tipo === 'pt' ? ' puntos' : ''}` : '';
      const est = g.xs.some(x => x.e.est === 'ok') ? 'ok' : g.xs.some(x => x.e.est === 'poco') ? 'poco' : 'full';
      return Object.assign(g, { n, lab, sub, est, tipo: g.items[0].tipo, lat: g.items.reduce((a, i) => a + i.lat, 0) / n, lng: g.items.reduce((a, i) => a + i.lng, 0) / n, key: g.items.map(i => i.key).sort().join('|') });
    });
  }
  const pinSvgMapa = (c, txt) => `<svg class="pin" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37c-9-12-14-18-14-24a14 14 0 0 1 28 0c0 6-5 12-14 24z" fill="${c}" stroke="#fff" stroke-width="2"/>${txt ? `<text x="15" y="18" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">${txt}</text>` : '<circle cx="15" cy="13" r="5" fill="#fff"/>'}</svg>`;
  function pinesMapa() {
    const L = window.L, m = S.mapa.map; if (!m) return;
    S.mapa.capa.clearLayers();
    const gs = agruparMapa(itemsMapa()); S.mapa.grupos = gs;
    gs.forEach(g => {
      const fan = g.tipo === 'pt' && g.n === 1 ? fotoPunto(g.xs[0], g.items[0].p, 0)
        : g.xs.slice(0, 3).map((x, j, a) => `<span class="ph" style="left:${(j - (a.length - 1) / 2) * 50}px;transition-delay:${(.1 + j * .08).toFixed(2)}s"><span class="phi"${fotoAttr(x.c.id, x.c.portada, `background-image:${colorDe(x.c)};`)}>${x.c.portada ? '' : esc(iniciales(x.c.nombre))}</span></span>`).join('');
      const html = `<div class="pp${g.tipo === 'pt' ? ' pt' : ''}${S.mapa.sel === g.key ? ' sel' : ''}" data-mk="${esc(g.key)}"><span class="rip"></span>${pinSvgMapa(COL_MAPA[g.est], g.n > 1 ? g.n : '')}<span class="fan">${fan}</span><span class="lab">${esc(g.lab)}${g.sub ? `<small>${esc(g.sub)}</small>` : ''}</span></div>`;
      const mk = L.marker([g.lat, g.lng], { icon: L.divIcon({ className: 'ppi', html, iconSize: [0, 0] }), title: g.lab + (g.sub ? ' ' + g.sub : ''), riseOnHover: true });
      mk.on('click', (ev) => { L.DomEvent.stopPropagation(ev); tocarPin(g, mk); });
      mk.addTo(S.mapa.capa); g.mk = mk;
    });
  }
  // La foto de un punto (la primera de sus fotos; si no tiene, la portada de la campaña).
  function fotoPunto(x, p, left) {
    const f = (p.fotos || [])[0], c = x.c;
    const attr = f ? fotoAttr(c.id, f, `background-image:${colorDe(c)};`) : fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`);
    return `<span class="ph" style="left:${left}px;transition-delay:.1s"><span class="phi"${attr}>${f || c.portada ? '' : esc(iniciales(p.nombre || c.nombre))}</span></span>`;
  }
  function tocarPin(g, mk) {
    const m = S.mapa.map;
    if (g.n > 1) {   // un grupo: acercar hasta que se separe
      cerrarPin(true);
      const b = window.L.latLngBounds(g.items.map(i => [i.lat, i.lng]));
      m.flyTo(b.getCenter(), Math.min(17, Math.max(m.getBoundsZoom(b.pad(.9)), m.getZoom() + 1.25)), { duration: .7 });
      return;
    }
    const x = g.xs[0], c = x.c;
    if (S.mapa.sel === g.key) { cerrarPin(); return; }
    document.querySelectorAll('.pp.sel').forEach(e => e.classList.remove('sel'));
    S.mapa.sel = g.key;
    const el = g.tipo !== 'pt' && mk.getElement() && mk.getElement().querySelector('.pp');
    if (el) { el.classList.add('sel'); el.classList.toggle('conpts', g.tipo !== 'pt' && x.pts.length > 0); el.classList.remove('ripgo'); void el.offsetWidth; el.classList.add('ripgo'); }
    S.mapa.el.classList.add('dim');
    // Los carritos y stands de la campaña elegida, con su nombre, y el mapa encuadrado sobre ellos.
    if (g.tipo === 'pt') (S.mapa.grupos || []).forEach(gr => { if (gr.mk && gr.xs.length === 1 && gr.xs[0].c.id === c.id && S.mapa.capa.hasLayer(gr.mk)) S.mapa.capa.removeLayer(gr.mk); });   // sus carritos reemplazan al pin de la campaña
    puntosCamp(x, g.tipo === 'pt' ? g.key : null);
    const H = m.getSize().y;
    if (g.tipo !== 'pt' && x.pts.length > 1) m.flyToBounds(window.L.latLngBounds(x.pts.map(p => [p.lat, p.lng])), { paddingTopLeft: [40, 70], paddingBottomRight: [40, Math.round(H * .45)], maxZoom: 16.5, duration: .7 });
    else { const z = Math.max(m.getZoom(), g.tipo === 'pt' ? m.getZoom() : 15); const pt = m.project([g.lat, g.lng], z).add([0, H * .22]); m.flyTo(m.unproject(pt, z), z, { duration: .6 }); }
    const npt = (c.puntos ? Object.keys(c.puntos).length : 0);
    if (g.tipo === 'pt' && g.items[0].p) {
      const p = g.items[0].p, f = (p.fotos || [])[0];
      $('msBody').innerHTML = `<h4>${esc(c.ciudad || '')} · ${esc(c.nombre)}</h4><div class="mcc"><span class="im"${f ? fotoAttr(c.id, f, `background-image:${colorDe(c)};`) : fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}></span><span class="tx"><b>${esc(p.nombre || 'Punto')}</b><small>${esc([(TIPOS[p.tipo] || TIPOS.otro)[1], p.detalle || p.direccion].filter(Boolean).join(' · '))}</small><span class="f ${x.e.est}">${esc(x.e.txt)}</span></span></div><div class="macc">${tieneLugar(p) ? `<button type="button" class="sbtn" data-lugar="${esc(c.id)}|${esc(p.id)}">${I('pin', 'width:15px;height:15px')}Ver lugar${(p.fotos || []).length > 1 ? ` (${p.fotos.length} fotos)` : ''}</button>` : ''}<button type="button" class="go" data-go="#/c/${esc(c.id)}">Ver turnos</button></div>`;
    } else $('msBody').innerHTML = `<h4>${esc(c.ciudad || '')}${g.tipo === 'pt' ? ' · ' + esc(g.items[0].lab) : ''}</h4><div class="mcc"><span class="im"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}></span><span class="tx"><b>${esc(c.nombre)}</b><small>${esc([c.ciudad, rangoCorto(c), npt + (npt === 1 ? ' punto' : ' puntos')].filter(Boolean).join(' · '))}</small><span class="f ${x.e.est}">${esc(x.e.txt)}</span></span><button type="button" class="go" data-go="#/c/${esc(c.id)}">Ver turnos</button></div>${x.pts.length < npt ? `<p class="mnota">${x.pts.length ? `${npt - x.pts.length} de ${npt} puntos todavía no están marcados en el mapa.` : `Los puntos de esta campaña todavía no están marcados en el mapa: aparece en el centro de ${esc(c.ciudad || 'su localidad')}.`}</p>` : ''}`;
    const sh = $('msheet'); sh.classList.remove('on'); void sh.offsetWidth; sh.classList.add('on');
    // Que se vea la tarjeta: si el mapa queda cortado abajo (por la barra), se acomoda la página.
    const r = $('mapw') && $('mapw').getBoundingClientRect(), tb = ($('tabbar') && $('tabbar').offsetHeight) || 0;
    if (r && r.bottom > window.innerHeight - tb) window.scrollBy({ top: r.bottom - (window.innerHeight - tb) + 8, behavior: 'smooth' });
  }
  // Pines chicos de los puntos de la campaña elegida (se ven aunque el mapa esté lejos).
  function puntosCamp(x, menos) {   // menos: el punto elegido (se muestra con su foto)
    const L = window.L;
    if (S.mapa.ptsCapa) S.mapa.ptsCapa.remove();
    S.mapa.ptsCapa = L.layerGroup(x.pts.map(p => {
      const esSel = x.c.id + ':' + p.id === menos;
      const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'ppi', html: `<div class="pp pt pso${esSel ? ' sel ripgo' : ''}">${pinSvgMapa(COL_MAPA[x.e.est], '')}<span class="fan">${fotoPunto(x, p, 0)}</span><span class="lab">${esc(p.nombre || 'Punto')}</span></div>`, iconSize: [0, 0] }), title: p.nombre || 'Punto', zIndexOffset: 500 });
      mk.on('click', (ev) => {   // tocar un carrito de la campaña: su foto y sus datos
        L.DomEvent.stopPropagation(ev);
        const it = { tipo: 'pt', key: x.c.id + ':' + p.id, lat: p.lat, lng: p.lng, xs: [x], lab: p.nombre || x.c.nombre, p };
        if (S.mapa.sel === it.key) { cerrarPin(); return; }
        S.mapa.sel = null; tocarPin({ tipo: 'pt', n: 1, xs: [x], items: [it], lat: p.lat, lng: p.lng, key: it.key }, mk);
      });
      return mk;
    })).addTo(S.mapa.map);
  }
  function cerrarPin(sinRedibujar) {
    if (!S.mapa.el) return;
    if (S.mapa.ptsCapa) { S.mapa.ptsCapa.remove(); S.mapa.ptsCapa = null; }
    const habia = !!S.mapa.sel;
    S.mapa.sel = null;
    S.mapa.el.classList.remove('dim'); $('msheet') && $('msheet').classList.remove('on');
    document.querySelectorAll('.pp.sel').forEach(e => e.classList.remove('sel'));
    if (habia && !sinRedibujar) pinesMapa();
  }
  function pintarYo() {
    const L = window.L, m = S.mapa.map; if (!m || !S.mapa.yo) return;
    if (S.mapa.yoMk) S.mapa.yoMk.remove();
    S.mapa.yoMk = L.marker([S.mapa.yo.lat, S.mapa.yo.lng], { icon: L.divIcon({ className: 'ppi', html: '<div class="yo"></div>', iconSize: [0, 0] }), interactive: false, zIndexOffset: -100 }).addTo(m);
  }
  function cercaMio() {
    if (!navigator.geolocation) { toast('Este celular no comparte la ubicación.'); return; }
    toast('Buscando dónde estás…');
    navigator.geolocation.getCurrentPosition((pos) => {
      S.mapa.yo = { lat: pos.coords.latitude, lng: pos.coords.longitude }; pintarYo();
      const m = S.mapa.map; if (!m || !S.mapa.cs.length) return;
      const here = window.L.latLng(S.mapa.yo.lat, S.mapa.yo.lng);
      const best = S.mapa.cs.map(x => ({ x, d: here.distanceTo([x.lat, x.lng]) / 1000 })).sort((a, b) => a.d - b.d)[0];
      toast(`La más cercana: ${best.x.c.nombre}, ${best.x.c.ciudad || ''} (${best.d < 1 ? 'acá cerca' : Math.round(best.d) + ' km'})`);
      cerrarPin(true);
      m.flyTo([best.x.lat, best.x.lng], 14, { duration: 1 });
      m.once('moveend', () => { pinesMapa(); const g = (S.mapa.grupos || []).find(g => g.xs.length === 1 && g.xs[0].c.id === best.x.c.id); if (g) tocarPin(g, g.mk); });
    }, () => toast('No se pudo saber dónde estás. Revisá el permiso de ubicación.'), { timeout: 10000, maximumAge: 300000 });
  }

  /* ---------- Clics ---------- */
  // Botones que eligen una opción (día, filtro, pestaña): su estado se anuncia con aria-pressed
  const GRUPOS = '.seg2 button, .days button, .tabs button, .bsch button';
  function marcarEstados() { document.querySelectorAll(GRUPOS).forEach(b => b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false')); }
  new MutationObserver(() => { clearTimeout(marcarEstados.t); marcarEstados.t = setTimeout(marcarEstados, 0); }).observe(document.body, { childList: true, subtree: true });
  // Si la pantalla se vuelve a dibujar después de tocar un botón, el foco vuelve al botón equivalente
  const CLAVES = ['dia', 'cdia', 'cf', 'cdf', 'aj', 'hf', 'tab', 'vista', 'plegar', 'sem', 'bsat'];
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = CLAVES.find(x => b.dataset[x] !== undefined); if (!k) return;
    const sel = `[data-${k}="${CSS.escape(b.dataset[k])}"]`;
    setTimeout(() => { if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected) return; const n = document.querySelector(sel); if (n) n.focus({ preventScroll: true }); }, 0);
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a[data-go]'); if (!t) return;
    const ds = t.dataset;
    if (t.id === 'backBtn') { const r = S.route; go((r.name === 'coord' && r.cid) || r.name === 'admin' || r.name === 'soporte' ? '#/coord' : r.name === 'turno' ? '#/mis' : '#/'); return; }
    if (t.id === 'shareBtn') {
      const c = S.campanas[S.route.cid]; if (!c) return;
      const link = linkCampana(c), txt = `PPAM · ${c.nombre} (${c.ciudad || ''}). Anotate en un turno: ${link}`;
      const ov = sheet(`<h3>Compartir la campaña</h3><p class="hint">${esc(c.nombre)}</p><button type="button" class="btn" id="shWa">${I('chat')}Mandar por WhatsApp</button><button type="button" class="btn alt" id="shCopy">${I('copy')}Copiar enlace</button>${navigator.share && !window.__ppamMock ? `<button type="button" class="btn alt" id="shMas">${I('share')}Más opciones…</button>` : ''}<button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
      ov.querySelector('#shWa').addEventListener('click', () => { ov.remove(); compartir(txt); });
      ov.querySelector('#shCopy').addEventListener('click', () => { ov.remove(); copiar(link); });
      const m = ov.querySelector('#shMas'); if (m) m.addEventListener('click', () => { ov.remove(); navigator.share({ title: c.nombre, text: txt }).catch((er) => { if (er && er.name !== 'AbortError') copiar(link); }); });
      return;
    }
    if (t.id === 'userBtn') {
      if (!S.user) { login(); return; }
      const ov = sheet(`<div class="acct"><span class="av big">${esc(iniciales(S.user.displayName || S.user.email))}</span><div><h3>${esc(S.user.displayName || 'Mi cuenta')}</h3><p class="hint">${esc(S.user.email)}</p></div></div><button type="button" class="btn" id="uMis">Mis turnos</button>${puedeInstalar() ? '<button type="button" class="btn alt" id="uInst">Instalar la app</button>' : ''}<button type="button" class="btn alt" id="uOut">Cerrar sesión</button><button type="button" class="linkish ubor" id="uBor">Borrar mis datos de este celular</button>`);
      if (ov.querySelector('#uInst')) ov.querySelector('#uInst').addEventListener('click', () => { ov.remove(); instalar(); });
      ov.querySelector('#uMis').addEventListener('click', () => { ov.remove(); go('#/mis'); });
      ov.querySelector('#uOut').addEventListener('click', async () => { ov.remove(); await cerrarSesion(); });
      ov.querySelector('#uBor').addEventListener('click', () => { if (!confirm('¿Borrar de este celular tus datos guardados (nombre, celular, congregación) y tus búsquedas? Tus turnos no se tocan.')) return; borrarDatosLocales(); ov.remove(); toast('Listo: se borraron tus datos de este celular'); });
      return;
    }
    if (t.id === 'coordBtn') { go('#/coord'); return; }
    if (t.id === 'privBtn') { privacidad(); return; }
    if (t.id === 'comoBtn') { go('#/ayuda'); return; }
    if (t.closest('[data-cguia]')) { try { localStorage.setItem('ppam-guia-coord', '1'); } catch (e) { /* nada */ } renderCoord(); return; }
    if (ds.instalar !== undefined) { instalar(); return; }
    if (ds.vista) { S.vista = ds.vista; S.mapa.sel = null; try { localStorage.setItem('ppam-vista', ds.vista); } catch (er) { /* nada */ } renderHome(); return; }
    if (ds.cerca !== undefined) { cercaMio(); return; }
    if (ds.mz) { if (S.mapa.map) S.mapa.map.zoomIn(+ds.mz); return; }
    if (ds.mtodo !== undefined) { verTodo(true); return; }
    if (ds.instcerrar !== undefined) { instGuardar(new Date(Date.now() + 30 * 864e5).toISOString()); renderHome(); return; }
    if (t.id === 'repBtn' || t.closest('#repBtn')) { reportar(); return; }
    if (ds.rpfiltro) { S.sop.filtro = ds.rpfiltro; render(); return; }
    if (ds.rpdet !== undefined) { S.sop.detalle = !S.sop.detalle; render(); return; }
    if (ds.rpestado) { const [id, est] = ds.rpestado.split('|'); cambiarReporte(id, est); return; }
    if (ds.go) { const ov = t.closest('.ov'); if (ov) ov.remove(); go(ds.go); return; }
    if (ds.login !== undefined) { login(); return; }
    if (ds.ciudad) { S.ciudad = ds.ciudad; renderHome(); return; }
    if (ds.dia) { S.dia = ds.dia; renderCamp(); return; }
    if (ds.cf) { S.campFiltro = ds.cf; renderCamp(); return; }
    if (ds.ccretry) { S.ccErr[ds.ccretry] = false; listenCC(ds.ccretry); renderCamp(); return; }
    if (ds.plegar) { S.plegados = S.plegados || {}; const k = S.route.cid + '|' + ds.plegar; S.plegados[k] = !S.plegados[k]; renderCamp(); return; }
    if (ds.pedir) { pedir(ds.pedir); return; }
    if (ds.mio) { go('#/mis'); return; }
    if (ds.lugar) { const [cid, pid] = ds.lugar.split('|'); verLugar(cid, pid); return; }
    if (ds.copiar) { copiar(ds.copiar); return; }
    if (ds.ics) { agendar(ds.ics); return; }
    if (ds.comp) { compartirTurno(ds.comp); return; }
    if (ds.invitar) { invitarTurno(ds.invitar); return; }
    if (ds.nota) { editarNota(ds.nota); return; }
    if (ds.cancelar) { cancelarPedido(ds.cancelar); return; }
    if (ds.tab) { S.sucio = false; S.coord.tab = ds.tab; renderCoord(); return; }
    if (ds.confirmar) { cambiarEstado(ds.confirmar, 'confirmado'); return; }
    if (ds.rechazar) { if (confirm('¿No confirmar este pedido? Se libera el lugar.')) cambiarEstado(ds.rechazar, 'rechazado'); return; }
    if (ds.quitar) { if (confirm('¿Quitar a esta persona del turno? Se libera el lugar.')) cambiarEstado(ds.quitar, 'rechazado'); return; }
    if (ds.sem) { const c = S.campanas[S.route.cid], dias = diasDe(c); const i = Math.max(0, Math.min(dias.length - 1, dias.indexOf(S.coord.semana) + (+ds.sem))); S.coord.semana = dias[i]; renderCoord(); return; }
    if (ds.cdia) { S.coord.dia = ds.cdia; renderCoord(); return; }
    if (ds.cdf) { S.coord.diaF = ds.cdf; renderCoord(); return; }
    if (ds.anotar) { const [tid, f] = ds.anotar.split('|'); anotarHermano(S.campanas[S.route.cid], tid, f || S.coord.dia, () => { S.coord.tab = 'dia'; S.coord.dia = f || S.coord.dia; S.coord.flash = 'dt-' + tid; if (S.route.name === 'coord') renderCoord(); }); return; }
    if (ds.cir) { const [d, tid] = ds.cir.split('|'); S.coord.dia = d; S.coord.tab = 'dia'; S.coord.diaF = 'todos'; S.coord.flash = 'dt-' + tid; renderCoord(); return; }
    if (t.id === 'busBtn') { abrirBuscador(); return; }
    if (ds.voluntarios !== undefined) { const c = S.campanas[S.route.cid]; compartir(textoVoluntarios(c, diasDe(c))); return; }
    if (ds.listadia !== undefined) { const c = S.campanas[S.route.cid]; compartir(textoDia(c, Object.values(S.coord.pedidos))); return; }
    if (ds.punto !== undefined) { editarPunto(S.campanas[S.route.cid], ds.punto || null); return; }
    if (ds.turno !== undefined) { editarTurno(S.campanas[S.route.cid], ds.turno || null, ds.tpto); return; }
    if (ds.cph) { copiarHorarios(S.campanas[S.route.cid], ds.cph); return; }
    if (ds.aj) { S.sucio = false; S.coord.aj = ds.aj; renderCoord(); return; }
    if (ds.hf && !t.closest('.hgov')) { S.audF = ds.hf; renderCoord(); return; }
    if (ds.restaurar && !t.closest('.hgov')) { restaurar(ds.restaurar); return; }
    if (ds.histgen !== undefined) { S.audF = 'todo'; abrirHistorialGeneral(); return; }
    if (ds.nueva !== undefined) { nuevaCampana(); return; }
    if (ds.coords) { editarCoordinadores(ds.coords); return; }
  });

  document.addEventListener('change', (e) => { if (e.target.id === 'fCiudad') { S.ciudad = e.target.value; renderHome(); } });

  // Versión nueva: el service worker se busca sin caché al abrir (y cada vez que se vuelve a la app);
  // cuando la nueva toma el control, la página se recarga sola una vez para mostrarla.
  if ('serviceWorker' in navigator && !window.__ppamMock && location.protocol === 'https:') {
    const habia = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    let recargo = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!habia || recargo) return;
      recargo = true;
      // si hay un formulario o ventana abierta, se espera a que la cierre para no perder lo escrito
      const intentar = () => { if (document.querySelector('.ov, .bsov')) { setTimeout(intentar, 2000); return; } location.reload(); };
      intentar();
    });
  }
  // Si hay clave de App Check, primero se carga su parte del SDK (si falla la carga, la app sigue igual)
  (function arrancar() {
    const k = window.PPAM_FIREBASE && window.PPAM_FIREBASE.appCheckKey;
    if (!k || window.__ppamMock || !window.firebase) return init();
    const sc = document.createElement('script'); sc.src = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-check-compat.js';
    sc.onload = sc.onerror = () => init(); document.head.appendChild(sc);
  })();
})();
