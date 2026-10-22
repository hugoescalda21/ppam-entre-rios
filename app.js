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
     fotos/{cid}__{id}     {cid, data (imagen JPEG achicada, data:…), creado}
     hermanos/{hid}        hermano habilitado: nombre, apellido, congregacion, celular, cod (código de su link), uid (celular en uso)
     links/{cod}           {hid, nombre, congregacion, turnos, usado}  ← lo lee quien conoce el código
     sesiones/{uid}        {hid, cod, at}: qué hermano usa este celular (sesión anónima de Firebase)
   La web está cerrada: entran los hermanos habilitados con su link personal (un celular a la vez)
   y los coordinadores, administradores y soporte con Google.
   ===================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  // Pantalla ancha (PC, tablet acostada): menú al costado y pantallas en columnas. En el celular no cambia nada.
  const mqPC = window.matchMedia ? window.matchMedia('(min-width: 1100px)') : { matches: false };
  const PC = () => !!mqPC.matches;
  if (mqPC.addEventListener) mqPC.addEventListener('change', () => { if (S.route) try { render(); } catch (e) { /* todavía cargando */ } });
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
  const fmtHora = (h) => String(h || '').replace(/^0(\d)/, '$1').replace(/:00$/, '');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const I = (n, st) => `<svg class="ic"${st ? ` style="${st}"` : ''} aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const iniciales = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map(x => x.charAt(0).toUpperCase()).join('') || '·';

  /* ---------- Estado ---------- */
  const S = {
    db: null, auth: null, user: null, isAdmin: false, coordDe: [],
    acceso: 'cargando', yo: null, esHermano: false, hermano: null, otro: null, herUnsub: null, datosUnsub: null, canje: null,
    campanas: {}, loaded: false, publico: { congregaciones: [], ciudades: [] },
    ciudad: 'todas', route: { name: 'home' }, dia: null,
    cc: {}, ccUnsub: {}, fotos: {},
    mis: {}, misUnsub: null,
    coord: { cid: null, tab: 'pedidos', pedidos: {}, cupos: {}, unsub: [] , semana: null },
    admins: [], coordEmails: {}, pend: {}, pendUnsub: {},
    isSoporte: false, soporteEmails: [], sop: { reportes: {}, errores: {}, unsub: [], filtro: 'nuevo', detalle: false, limpio: false }, ultimoError: null
  };
  const VERSION = '57';
  window.__ppam = S;   // para las pruebas

  function toast(msg) { if (/^No se pudo/.test(msg)) registrarError('aviso', msg); const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
  // Datos del formulario recordados en este celular, separados por cuenta (en un celular compartido nadie ve los del otro)
  const perfilKey = () => (S.yo ? 'ppam-perfil:' + S.yo : '');
  try { localStorage.removeItem('ppam-perfil'); } catch (e) { /* el formato viejo no sabía de quién era: se descarta */ }
  // Para un hermano habilitado, sus datos vienen de lo que cargó el coordinador (lo guardado en el celular manda)
  function perfil() {
    const h = S.hermano, base = h ? { nombre: h.nombre, apellido: h.apellido, congregacion: h.congregacion, celular: h.celular } : {};
    const k = perfilKey(); if (!k) return base;
    try { return Object.assign(base, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) { return base; }
  }
  // Nombre de quien usa la app (hermano o cuenta de Google)
  const nombreYo = () => (S.hermano ? (S.hermano.nombre + ' ' + S.hermano.apellido).trim() : S.user ? (S.user.displayName || S.user.email || '') : '');
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
    S.auth.onAuthStateChanged(onUser);
    setInterval(() => { if (S.route.name === 'home' && S.acceso === 'si') renderHome(); }, 60000);
    window.addEventListener('hashchange', () => { S.sucio = false; S.pendRender = false; const antes = S.route; readRoute(); transicion(antes, S.route); if (S.route.name !== 'coord' && S.coord.unsub.length) { S.coord.unsub.forEach(f => f()); S.coord.unsub = []; S.coord.cid = null; S.coord.pedidos = {}; S.coord.cupos = {}; S.coord.aud = {}; } render(); });
    readRoute();
    // Si en 12 segundos no se sabe quién es, se avisa (mala señal)
    setTimeout(() => { if (S.acceso === 'cargando' && S.route.name !== 'canje') { window.__ppamOk = true; $('app').removeAttribute('aria-busy'); $('app').innerHTML = '<div class="empty carga-err"><b>No pudimos cargar las campañas.</b><br>Revisá la conexión y probá de nuevo.</div><button type="button" class="btn" id="reintentar">Reintentar</button>'; $('reintentar').addEventListener('click', () => location.reload()); } }, 12000);
  }
  // Campañas y lista de congregaciones: solo con acceso (las reglas no las entregan a nadie más)
  function iniciarDatos() {
    if (S.datosUnsub) return;
    const u1 = S.db.collection('campanas').onSnapshot((qs) => {
      const o = {}; qs.forEach(d => { o[d.id] = Object.assign({ id: d.id }, d.data()); }); S.campanas = o; const primera = !S.loaded; S.loaded = true; window.__ppamOk = true; $('app').removeAttribute('aria-busy'); if (primera) { render(); setTimeout(() => { if (S.route.name === 'home') bienvenida(); else if (S.route.name === 'camp' && S.campanas[S.route.cid]) introCampana(S.campanas[S.route.cid]); }, 60); } else refrescar(render);
    }, (e) => { console.error(e); if (S.loaded) return; window.__ppamOk = true; $('app').removeAttribute('aria-busy'); $('app').innerHTML = '<div class="empty carga-err"><b>No pudimos cargar las campañas.</b><br>Revisá la conexión y probá de nuevo.</div><button type="button" class="btn" id="reintentar">Reintentar</button>'; $('reintentar').addEventListener('click', () => location.reload()); });
    const u2 = S.db.doc('config/publico').onSnapshot((d) => { S.publico = Object.assign({ congregaciones: [], ciudades: [] }, d.exists ? d.data() : {}); if (S.route.name === 'admin' || (S.route.name === 'home' && S.loaded)) render(); }, () => {});
    S.datosUnsub = () => { u1(); u2(); };
  }
  function pararDatos() {
    if (S.datosUnsub) { S.datosUnsub(); S.datosUnsub = null; }
    Object.keys(S.ccUnsub).forEach(k => { if (typeof S.ccUnsub[k] === 'function') S.ccUnsub[k](); }); S.ccUnsub = {}; S.cc = {};
    S.campanas = {}; S.loaded = false;
  }
  async function onUser(u) {
    S.user = u || null; S.isAdmin = false; S.coordDe = []; S.isSoporte = false;
    S.yo = null; S.esHermano = !!(u && u.isAnonymous); S.hermano = null; S.otro = null; S.acceso = 'cargando';
    if (S.herUnsub) { S.herUnsub(); S.herUnsub = null; }
    if (S.herm && S.herm.unsub) S.herm.unsub(); S.herm = null;   // lista de hermanos (coordinadores)
    S.sop.unsub.forEach(f => f()); S.sop.unsub = []; S.sop.on = false; S.sop.okR = S.sop.okE = false; S.sop.reportes = {}; S.sop.errores = {};
    if (S.misUnsub) { S.misUnsub(); S.misUnsub = null; } S.mis = {};
    // lo que vio la cuenta anterior no queda en memoria
    S.coord.unsub.forEach(f => f()); S.coord.unsub = []; S.coord.cid = null; S.coord.pedidos = {}; S.coord.cupos = {}; S.coord.aud = {};
    Object.keys(S.pendUnsub).forEach(k => { if (typeof S.pendUnsub[k] === 'function') S.pendUnsub[k](); }); S.pendUnsub = {}; S.pend = {};
    S.bus = { t: 0, peds: {}, cupos: {}, cargando: null };
    if (!u) { S.acceso = 'no'; pararDatos(); }
    else if (u.isAnonymous) {
      // Celular de un hermano: ¿qué hermano es y sigue siendo este su celular?
      let ses = null;
      try { const d = await S.db.doc('sesiones/' + u.uid).get(); ses = d.exists ? d.data() : null; } catch (e) { /* sin sesión */ }
      if (S.user !== u) return;
      if (ses) { escucharHermano(u, ses); return; }
      if (S.entrando) return;   // está entrando con su link: la sesión se crea en un momento
      S.acceso = 'no'; pararDatos();
    } else {
      try { const r = await S.db.doc('roles/' + u.email.toLowerCase()).get(); S.coordDe = (r.exists && r.data().campanas) || []; } catch (e) { /* sin rol */ }
      try { const a = await S.db.doc('config/admins').get(); S.isAdmin = true; S.admins = (a.exists && a.data().emails) || []; } catch (e) { S.isAdmin = false; }
      try { const so = await S.db.doc('config/soporte').get(); S.soporteEmails = (so.exists && so.data().emails) || []; S.isSoporte = S.soporteEmails.includes(u.email.toLowerCase()); } catch (e) { S.isSoporte = false; }
      if (S.user !== u) return;
      if (S.isAdmin || S.coordDe.length || S.isSoporte) { S.acceso = 'si'; S.yo = u.uid; iniciarDatos(); escucharMis(); }
      else { S.acceso = 'nocoord'; pararDatos(); }
    }
    renderTop(); render();
    // coordinadores, administradores y soporte: su parte de la app se baja enseguida, en segundo plano
    if (S.user && (S.isAdmin || S.coordDe.length || S.isSoporte)) cargarCoord().catch(() => {});
  }
  // El hermano entra solo si este celular es el que tiene atado (un celular a la vez) y no está dado de baja
  const sesionOk = (h, u, ses) => !!(h && h.uid === u.uid && h.cod === ses.cod && !h.baja);
  // Aplica lo que dice el hermano (de la base o de la copia del celular): adentro, o afuera porque su link se usó en otro lado / lo dieron de baja
  function aplicarHermano(h, u, ses) {
    if (sesionOk(h, u, ses)) {
      S.hermano = h; S.otro = null; S.acceso = 'si';
      if (S.yo !== ses.hid) { S.yo = ses.hid; escucharMis(); }
      iniciarDatos();
    } else {
      S.acceso = h && h.baja ? 'baja' : h ? 'otro' : 'no'; S.otro = h; S.hermano = null; S.yo = null;
      if (S.misUnsub) { S.misUnsub(); S.misUnsub = null; } S.mis = {};
      pararDatos();
    }
  }
  function escucharHermano(u, ses) {
    if (S.herUnsub) S.herUnsub();
    S.ses = ses;
    let primera = true;
    S.herUnsub = S.db.doc('hermanos/' + ses.hid).onSnapshot((d) => {
      const h = d.exists ? d.data() : null, antes = S.acceso;
      aplicarHermano(h, u, ses);
      if (primera || antes !== S.acceso || S.acceso !== 'si') { primera = false; renderTop(); render(); }
      // Lo que vino de la copia del celular puede estar viejo (por ejemplo, si el link se usó después en otro navegador): se confirma con la base
      if (S.acceso === 'si' && d.metadata && d.metadata.fromCache) revisarSesion();
    }, () => { S.acceso = 'no'; pararDatos(); renderTop(); render(); });
  }
  // Pregunta a la base (no a la copia del celular) si este celular sigue siendo el del hermano. Sin señal, se da por buena.
  async function revisarSesion() {
    if (!S.esHermano || !S.ses || !S.user) return true;
    const u = S.user, ses = S.ses;
    let d;
    try { d = await S.db.doc('hermanos/' + ses.hid).get({ source: 'server' }); } catch (e) { return true; }
    if (S.user !== u) return false;
    const h = d.exists ? d.data() : null;
    if (sesionOk(h, u, ses)) return true;
    const antes = S.acceso; aplicarHermano(h, u, ses);
    if (antes !== S.acceso) { document.querySelectorAll('.ov').forEach(x => x.remove()); renderTop(); render(); }
    return false;
  }
  function escucharMis() {
    if (S.misUnsub) { S.misUnsub(); S.misUnsub = null; }
    if (!S.yo) return;
    S.misUnsub = S.db.collection('pedidos').where('uid', '==', S.yo).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.mis = o; S.misErr = false; refrescar(render); }, (e) => { console.error(e); S.misUnsub = null; if (S.esHermano && /permission/i.test(e.code || '')) { revisarSesion().then((ok) => { if (ok) registrarError('aviso', 'Mis turnos: ' + e.code + ' (con acceso)'); }); } else registrarError('aviso', 'Mis turnos: ' + (e.code || e.message || e)); S.misErr = true; if (S.route.name === 'mis' || S.route.name === 'home') render(); });
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
    const cod = (location.hash || '').match(/[?&]cod=([A-Za-z0-9-]+)/);
    if (cod) S.route = { name: 'canje', cod: cod[1].toUpperCase().replace(/[^A-Z0-9]/g, '') };
    else if (h[0] === 'c' && h[1]) S.route = h[2] && h[3] ? { name: 'camp', cid: h[1], fecha: h[2], tid: decodeURIComponent(h[3]) } : { name: 'camp', cid: h[1] };
    else if (h[0] === 't' && h[1]) S.route = { name: 'turno', pid: decodeURIComponent(h[1]) };
    else if (h[0] === 'k' && h[1]) S.route = { name: 'carrito', cod: h[1].toUpperCase().replace(/[^A-Z0-9]/g, '') };
    else if (h[0] === 'mis') S.route = { name: 'mis' };
    else if (h[0] === 'coord') S.route = { name: 'coord', cid: h[1] || null };
    else if (h[0] === 'admin') S.route = { name: 'admin' };
    else if (h[0] === 'hermanos') S.route = { name: 'hermanos' };
    else if (h[0] === 'soporte') S.route = { name: 'soporte' };
    else if (h[0] === 'ayuda') S.route = { name: 'ayuda', q: h[1] || '' };
    else S.route = { name: 'home' };
    window.scrollTo(0, 0);
  }
  const go = (h) => { if (location.hash === h) { readRoute(); render(); } else location.hash = h; };

  function renderTop() {
    const r = S.route, c = r.cid && S.campanas[r.cid];
    document.body.className = 'r-' + r.name + (S.acceso === 'si' || r.name === 'ayuda' ? '' : ' cerrado');
    const esCoord = !!(S.user && (S.isAdmin || S.coordDe.length || S.isSoporte));
    const atras = r.name === 'camp' || r.name === 'turno' || r.name === 'ayuda' || r.name === 'admin' || (r.name === 'soporte' && (S.isAdmin || S.coordDe.length)) || (r.name === 'coord' && r.cid) || r.name === 'hermanos';
    $('backBtn').classList.toggle('hidden', !atras);
    $('brand').classList.toggle('hidden', r.name !== 'home' && S.loaded);
    $('shareBtn').classList.toggle('hidden', r.name !== 'camp' || !c);
    const ub = $('userBtn');
    const conCuenta = S.acceso === 'si' || S.acceso === 'nocoord';
    ub.className = conCuenta ? 'av' : 'login';
    ub.textContent = conCuenta ? iniciales(nombreYo()) : 'Coordinadores';
    ub.setAttribute('aria-label', conCuenta ? 'Mi cuenta' : 'Ingresar como coordinador');
    ub.classList.toggle('hidden', !conCuenta && (S.esHermano || r.name === 'canje'));
    $('coordBtn').classList.toggle('hidden', !esCoord);
    $('busBtn').classList.toggle('hidden', S.acceso !== 'si');
    [['tabHome', ['home', 'camp']], ['tabMis', ['mis', 'turno']], ['tabAyuda', ['ayuda']], ['coordBtn', ['coord', 'admin', 'soporte', 'hermanos']]].forEach(([id, rs]) => $(id).classList.toggle('on', rs.includes(r.name)));
    let k = '', t = '', s = '';
    if (r.name === 'camp' && c) { k = c.ciudad || ''; t = c.nombre; s = campRango(c); }
    else if (r.name === 'mis') { t = 'Mis turnos'; s = 'Tus turnos, su estado y cómo llegar.'; }
    else if (r.name === 'turno') { t = 'Tu turno'; }
    else if (r.name === 'coord') { k = 'Coordinación'; t = c ? c.nombre : 'Tus campañas'; s = c ? (c.ciudad || '') + ' · ' + campRango(c) : ''; }
    else if (r.name === 'admin') { k = 'Administración'; t = 'Campañas y equipo'; }
    else if (r.name === 'hermanos') { k = 'Coordinación'; t = 'Hermanos habilitados'; s = 'De todas las congregaciones'; }
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

  const tieneUbic = (p) => p.lat != null || !!p.direccion || !!p.mapsUrl;
  const tieneLugar = (p) => tieneUbic(p) || !!(p.fotos || []).length || !!p.indicaciones || !!p.retiro || !!p.pubs || Object.values(p.comod || {}).some(Boolean);
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
  // Comodidades del punto (las marca el coordinador). El estacionamiento y el baño pueden tener su lugar en el mapa y una nota.
  const COMOD = [['sombra', 'Sombra', 'sombra'], ['sentarse', 'Para sentarse', 'silla'], ['estac', 'Estacionamiento', 'auto'], ['bano', 'Baño cerca', 'bano']];
  const lugarDe = (p, k) => { const l = ((p && p.lugares) || {})[k]; return l && (l.lat != null || l.nota) ? l : null; };
  const metros = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r, x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const distTxt = (m) => m < 1000 ? `unos ${Math.max(10, Math.round(m / 10) * 10)} m` : `unos ${(m / 1000).toFixed(1).replace('.', ',')} km`;
  const minTxt = (m) => { const n = Math.max(1, Math.round(m / 80)); return n === 1 ? '1 minuto' : n + ' minutos'; };
  const tipoTxt = (p) => (p.tipo === 'stand' ? 'stand' : p.tipo === 'carrito' ? 'carrito' : 'punto');
  // "Cómo llegar" pregunta cómo vas cuando el coordinador ubicó un estacionamiento
  const llegarAttr = (cid, pid) => { const p = ((S.campanas[cid] || {}).puntos || {})[pid], e = p && (p.lugares || {}).estac; return e && e.lat != null ? ` data-llegar="${esc(cid)}|${esc(pid)}"` : ''; };
  function comodHTML(cid, pid) {
    const p = S.campanas[cid].puntos[pid], cm = p.comod || {};
    const xs = COMOD.filter(([k]) => cm[k]).map(([k, txt, ic]) => lugarDe(p, k)
      ? `<button type="button" class="cmd ir" data-comod="${esc(cid)}|${esc(pid)}|${k}">${I(ic, 'width:15px;height:15px')}${k === 'bano' ? 'Baño' : txt}<span class="go">${I('chev', 'width:12px;height:12px')}</span></button>`
      : `<span class="cmd">${I(ic, 'width:15px;height:15px')}${txt}</span>`);
    const pc = pubsCarritoHTML(S.campanas[cid], pid);
    return (xs.length ? `<div class="cmds">${xs.join('')}</div>` : '') + (pc || (p.pubs ? `<div class="info pubs"><b>Publicaciones en el ${tipoTxt(p) === 'punto' ? 'lugar' : tipoTxt(p)}</b>${esc(p.pubs)}</div>` : ''));
  }
  // Con la cuenta de publicaciones prendida: las tapas de lo que lleva el carrito habitual del punto
  function pubsCarritoHTML(c, pid) {
    if (!conPubs(c)) return '';
    const k = Object.values(c.carritos || {}).find(x => x.habitual === pid && Object.keys(x.items || {}).length); if (!k) return '';
    const ids = Object.keys(k.items);
    if (!S.pubs) return '<div class="info pubs" id="vlPubs"><b>Publicaciones en el carrito</b>Cargando…</div>';
    const vis = ids.filter(x => S.pubs[x]); if (!vis.length) return '';
    return `<div class="info pubs tps"><b>Publicaciones en el ${esc(tipoTxt(c.puntos[pid]) === 'punto' ? 'lugar' : tipoTxt(c.puntos[pid]))}</b><div class="tapas">${vis.map(x => `<figure>${tapaHTML(x, 'g')}<figcaption>${esc(pubNombre(x))}</figcaption></figure>`).join('')}</div></div>`;
  }
  function verComod(cid, pid, k) {
    const c = S.campanas[cid], p = c && c.puntos && c.puntos[pid], l = p && lugarDe(p, k); if (!l) return;
    const auto = k === 'estac', tp = tipoTxt(p), conMapa = l.lat != null && p.lat != null, m = conMapa ? metros(p, l) : 0;
    const url = l.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}&travelmode=${auto ? 'driving' : 'walking'}` : '';
    const ov = sheet(`<h3>${auto ? 'Estacionamiento' : 'Baño'}</h3><span class="sub">Cerca del ${esc(tp)} ${esc(p.nombre)} · ${esc(c.nombre)}</span>
      ${l.lat != null ? '<div class="cmapa" id="cmMap"><div class="mapmsg">Cargando el mapa…</div></div>' : ''}
      ${conMapa ? `<div class="cdist">${I('pie')}<span><b>${distTxt(m)}</b> caminando ${auto ? 'hasta el' : 'desde el'} ${esc(tp)} · ${minTxt(m)}</span></div>` : ''}
      ${l.nota ? `<div class="info"><b>Nota del coordinador</b>${esc(l.nota)}</div>` : ''}
      ${url ? `<div class="lugar-acts"><a class="go" href="${esc(url)}" target="_blank" rel="noopener">${I('nav')}${auto ? 'Cómo llegar en auto' : 'Cómo llegar caminando'}</a></div>` : ''}
      <button type="button" class="btn alt" data-cerrar style="margin-top:12px">Volver</button>`);
    if (l.lat == null) return;
    cargarLeaflet().then((L) => {
      const el = ov.querySelector('#cmMap'); if (!el || !ov.isConnected) return;
      el.innerHTML = '';
      const map = L.map(el, { zoomControl: false, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      const pin = (cls, txt) => L.divIcon({ className: 'cpin ' + cls, html: `<i><b>${txt}</b></i>`, iconSize: [30, 30], iconAnchor: [15, 30] });
      const pts = [[l.lat, l.lng]];
      L.marker(pts[0], { icon: pin(k, auto ? 'P' : 'WC'), title: auto ? 'Estacionamiento' : 'Baño' }).addTo(map);
      if (p.lat != null) { pts.push([p.lat, p.lng]); L.marker(pts[1], { icon: pin('pt', ''), title: p.nombre }).addTo(map); L.polyline(pts, { color: '#12433F', weight: 3, dashArray: '6 7' }).addTo(map); }
      if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 18 }); else map.setView(pts[0], 17);
      setTimeout(() => map.invalidateSize(), 80);
    }).catch(() => { const el = ov.querySelector('#cmMap'); if (el) el.innerHTML = '<div class="mapmsg">No se pudo cargar el mapa. Usá el botón de Cómo llegar.</div>'; });
  }
  function comoVas(cid, pid) {
    const c = S.campanas[cid], p = c.puntos[pid], e = p.lugares.estac, tp = tipoTxt(p);
    const ov = sheet(`<h3>¿Cómo vas?</h3><p class="hint">${esc([p.nombre, c.nombre, p.direccion].filter(Boolean).join(' · '))}</p>
      <a class="opt" href="${esc(comoLlegarUrl(p, c))}" target="_blank" rel="noopener"><span class="ii">${I('pie', 'width:22px;height:22px')}</span><span><b>Caminando o en colectivo</b><small>Te lleva directo al ${esc(tp)}</small></span>${I('chev')}</a>
      <a class="opt" href="https://www.google.com/maps/dir/?api=1&amp;destination=${e.lat},${e.lng}&amp;travelmode=driving" target="_blank" rel="noopener"><span class="ii">${I('auto', 'width:22px;height:22px')}</span><span><b>En auto</b><small>Te lleva al estacionamiento${p.lat != null ? ' · después ' + distTxt(metros(p, e)) + ' caminando' : ''}</small></span>${I('chev')}</a>
      <button type="button" class="btn alt" data-cerrar style="margin-top:14px">Cancelar</button>`);
    ov.querySelectorAll('a.opt').forEach(a => a.addEventListener('click', () => setTimeout(() => ov.remove(), 0)));
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-llegar]'); if (!a) return;
    const [cid, pid] = a.dataset.llegar.split('|'), p = ((S.campanas[cid] || {}).puntos || {})[pid], est = p && (p.lugares || {}).estac;
    if (!est || est.lat == null) return;
    e.preventDefault(); e.stopPropagation(); comoVas(cid, pid);
  }, true);

  /* Pronóstico del tiempo para el turno (Open-Meteo: gratis y sin cuenta). Solo cuando faltan 7 días o menos y el punto está en el mapa. */
  S.clima = {};
  const CLIMA = [[[0], 'Despejado', 'sol'], [[1], 'Mayormente soleado', 'sol'], [[2], 'Parcialmente nublado', 'solnube'], [[3], 'Nublado', 'nube'], [[45, 48], 'Niebla', 'niebla'], [[51, 53, 55, 56, 57], 'Llovizna', 'lluvia'], [[61, 63, 65, 66, 67, 80, 81, 82], 'Lluvia', 'lluvia'], [[71, 73, 75, 77, 85, 86], 'Nieve', 'nube'], [[95, 96, 99], 'Tormenta', 'tormenta']];
  const climaHoras = (p) => { const a = Math.floor(minutos(p.desde) / 60), b = Math.max(a + 1, Math.ceil(minutos(p.hasta) / 60)); return [a, b]; };
  function climaTurno(p, pt) {
    const k = `${(+pt.lat).toFixed(2)},${(+pt.lng).toFixed(2)},${p.fecha},${p.desde},${p.hasta}`, ya = S.clima[k];
    if (ya && Date.now() - ya.t < 3600e3) return Promise.resolve(ya.v);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${(+pt.lat).toFixed(3)}&longitude=${(+pt.lng).toFixed(3)}&hourly=temperature_2m,precipitation_probability,weather_code&timezone=America%2FArgentina%2FBuenos_Aires&start_date=${p.fecha}&end_date=${p.fecha}`;
    return fetch(url).then(r => (r.ok ? r.json() : null)).then(j => {
      const hh = j && j.hourly; if (!hh || !hh.time) return null;
      const [a, b] = climaHoras(p), ix = hh.time.map((t, i) => [+t.slice(11, 13), i]).filter(([h]) => h >= a && h < b).map(([, i]) => i);
      if (!ix.length) return null;
      const temps = ix.map(i => hh.temperature_2m[i]).filter(x => x != null), probs = ix.map(i => (hh.precipitation_probability || [])[i]).filter(x => x != null), codes = ix.map(i => (hh.weather_code || [])[i]).filter(x => x != null);
      if (!temps.length) return null;
      const code = codes.length ? Math.max(...codes) : 0, d = CLIMA.find(([cs]) => cs.includes(code)) || CLIMA[3];
      return { temp: Math.round(Math.max(...temps)), prob: probs.length ? Math.max(...probs) : null, txt: d[1], ic: d[2] };
    }).catch(() => null).then(v => { S.clima[k] = { t: Date.now(), v }; return v; });
  }
  const climaHTML = (p, v) => `<span class="ico ${esc(v.ic)}">${I(v.ic, 'width:26px;height:26px')}</span><span class="tx"><b>${esc(v.txt)}</b><small>${esc(cap(DOW_L[parseIso(p.fecha).getDay()]))} ${parseIso(p.fecha).getDate()} · de ${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))}${v.prob != null ? ` · ${v.prob}% de lluvia` : ''}</small></span><span class="t num">${v.temp}°</span>`;

  /* Compañeros de turno: el nombre de quienes eligieron mostrarlo, solo para los confirmados de ese mismo turno.
     companeros/{turno}: n.{cuenta} = "Nombre Apellido · Congregación". Nunca el celular. Las reglas cuidan quién lo lee. */
  S.comp = {};
  async function compartirNombre(cid, fecha, tid, si, d) {
    const id = cupoId(cid, fecha, tid), ref = S.db.doc('companeros/' + id);
    try {
      if (si) await ref.set({ cid, fecha, n: { [S.yo]: (`${d.nombre} ${d.apellido}`.trim().slice(0, 80) + (d.congregacion ? ' · ' + String(d.congregacion).slice(0, 58) : '')) } }, { merge: true });
      else await ref.update({ ['n.' + S.yo]: S.del() });
      delete S.comp[id]; return true;
    } catch (e) { console.error(e); return false; }
  }
  async function cargarComp(p) {
    const id = cupoId(p.cid, p.fecha, p.tid); let d = S.comp[id];
    if (!d || Date.now() - d.t > 60000) {
      try { const sn = await S.db.doc('companeros/' + id).get(); d = { t: Date.now(), n: (sn.exists && sn.data().n) || {} }; }
      catch (e) { d = { t: Date.now(), err: true }; }
      S.comp[id] = d;
    }
    const el = $('comp'); if (!el || S.route.pid !== p.id) return;
    if (d.err) { el.remove(); return; }
    el.innerHTML = compHTML(p, d.n);
  }
  function compHTML(p, n) {
    const oc = ocupDe(p.cid, p.fecha, p.tid), otros = Object.keys(oc).filter(u => u !== S.yo && oc[u] === 'c');
    const con = otros.filter(u => n[u]), sin = otros.length - con.length, mio = !!n[S.yo];
    let h = '<div class="h">Van con vos</div>';
    if (!otros.length) h += '<p class="vacio">Por ahora no hay otros hermanos confirmados en este turno.</p>';
    h += con.map(u => { const [nom, cong] = String(n[u]).split(' · '); return `<div class="r"><span class="cav">${esc(iniciales(nom))}</span><span class="tx"><b>${esc(nom)}</b>${cong ? `<small>${esc(cong)}</small>` : ''}</span></div>`; }).join('');
    if (sin) h += `<div class="r"><span class="cav anon">${sin}</span><span class="tx"><b>${sin === 1 ? '1 hermano más' : sin + ' hermanos más'}</b><small>${sin === 1 ? 'Prefirió' : 'Prefirieron'} no mostrar su nombre</small></span></div>`;
    h += `<div class="cyo"><span>${mio ? '✓ Tus compañeros de este turno ven tu nombre' : 'Tus compañeros de este turno no ven tu nombre'}</span><button type="button" class="sbtn" data-compartir="${esc(p.id)}|${mio ? 0 : 1}">${mio ? 'Dejar de mostrarlo' : 'Mostrarlo'}</button></div>`;
    return h;
  }

  /* ---------- Publicaciones y carritos (se prende por campaña: "Llevar la cuenta de las publicaciones") ----------
     publicaciones/{id}: la lista de toda la provincia (nombre, tipo, idioma, edición, foto de la tapa). La carga el administrador.
     campanas/{cid}.carritos.{k}: cada carrito físico con su número, color, código del QR, lugar habitual y cantidades.
     entregas/{turno}: lo que se dejó en cada turno (un registro por turno, solo cantidades). */
  const KCOLORES = [['azul', '#2563EB'], ['verde', '#16A34A'], ['rojo', '#DC2626'], ['amarillo', '#CA8A04'], ['violeta', '#7C3AED'], ['naranja', '#EA580C'], ['celeste', '#0891B2'], ['rosa', '#DB2777'], ['gris', '#4B5563'], ['marrón', '#92400E']];
  const TIPOS_PUB = ['Revista', 'Folleto', 'Libro', 'Tarjeta', 'Otro'];
  const colorHex = (k) => (KCOLORES.find(x => x[0] === (k && k.color)) || KCOLORES[0])[1];
  const kNombre = (k) => k ? `Carrito ${k.n}${k.color ? ' · ' + k.color : ''}` : 'Carrito';
  const kNum = (k, cls) => `<span class="knum ${cls || ''}" style="background:${colorHex(k)}" aria-hidden="true">${esc(String(k ? k.n : '?'))}</span>`;
  const conPubs = (c) => !!(c && c.pubsOn);
  S.pubs = null; S.ent = {};
  function cargarPubs(forzar) {
    if (S.pubs && !forzar) return Promise.resolve(S.pubs);
    if (cargarPubs.p && !forzar) return cargarPubs.p;
    cargarPubs.p = S.db.collection('publicaciones').get().then(qs => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.pubs = o; cargarPubs.p = null; return o; }).catch(e => { cargarPubs.p = null; console.error(e); S.pubs = S.pubs || {}; return S.pubs; });
    return cargarPubs.p;
  }
  const pubNombre = (id) => ((S.pubs || {})[id] || {}).nombre || 'Publicación';
  const pubSub = (x) => [x.tipo, x.idioma, x.edicion].filter(Boolean).join(' · ');
  function tapaHTML(id, cls) {
    const x = (S.pubs || {})[id] || {};
    return x.foto ? `<span class="tapa ${cls || ''}" style="background-image:url('${x.foto}')" role="img" aria-label="${esc(x.nombre || '')}"></span>`
      : `<span class="tapa sin t-${esc(String(x.tipo || 'Otro').toLowerCase())} ${cls || ''}" aria-hidden="true">${I('libro', 'width:16px;height:16px')}</span>`;
  }
  const resumenItems = (items) => { const xs = Object.keys(items || {}).filter(id => items[id] > 0); return xs.length ? xs.map(id => `${items[id]} ${pubNombre(id)}`).join(' · ') : 'No se dejó nada'; };
  // Un carrito por el código de su QR (en las campañas que este celular ve)
  function carritoDe(cod) {
    cod = String(cod || '').toUpperCase();
    for (const c of Object.values(S.campanas)) { const ks = c.carritos || {}; for (const kid of Object.keys(ks)) if (ks[kid].cod === cod) return { c, kid, k: ks[kid] }; }
    return null;
  }
  // Turnos en los que se puede contar lo entregado: confirmados, en una campaña con la cuenta prendida,
  // desde 15 minutos antes de terminar hasta el final del día siguiente.
  function turnosParaContar() {
    const ahora = new Date(), h0 = hoy(), m = ahora.getHours() * 60 + ahora.getMinutes();
    return Object.keys(S.mis || {}).map(id => Object.assign({ id }, S.mis[id])).filter(p => p.estado === 'confirmado' && conPubs(S.campanas[p.cid]) &&
      ((p.fecha === h0 && m >= minutos(p.hasta) - 15) || p.fecha === addDays(h0, -1))).sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
  }
  async function cargarEnt(p, forzar) {
    const id = cupoId(p.cid, p.fecha, p.tid), ya = S.ent[id];
    if (ya && !forzar && Date.now() - ya.t < 60000) return ya;
    try { const sn = await S.db.doc('entregas/' + id).get(); S.ent[id] = { t: Date.now(), d: sn.exists ? sn.data() : null }; }
    catch (e) { S.ent[id] = { t: Date.now(), err: true }; }
    return S.ent[id];
  }
  // Inicio: "Terminó tu turno: escaneá el carrito y contá lo que se dejó"
  function avisoContarHTML() {
    const ps = turnosParaContar().filter(p => { const e = S.ent[cupoId(p.cid, p.fecha, p.tid)]; return e && !e.err && !e.d; });
    return ps.map(p => { const pt = ((S.campanas[p.cid] || {}).puntos || {})[p.punto] || {}; return `<div class="avcont"><span class="ii">${I('qr', 'width:22px;height:22px')}</span><span class="tx"><b>Terminó tu turno · ${esc(pt.nombre || '')}</b><small>Escaneá el carrito y contá lo que se dejó</small></span><button type="button" class="sbtn pri" data-contar="${esc(p.id)}">Escanear</button></div>`; }).join('');
  }
  function revisarAvisoContar() {
    const ps = turnosParaContar().filter(p => !S.ent[cupoId(p.cid, p.fecha, p.tid)]);
    if (!ps.length) return;
    cargarPubs();
    Promise.all(ps.map(p => cargarEnt(p))).then(() => { if (S.route.name === 'home') renderHome(); });
  }
  // Detalle del turno: lo entregado (o el botón para contarlo)
  function entregaHTML(p) {
    const c = S.campanas[p.cid]; if (!conPubs(c) || p.estado !== 'confirmado') return '';
    const id = cupoId(p.cid, p.fecha, p.tid), e = S.ent[id], abierto = turnosParaContar().some(x => x.id === p.id);
    if (!e) return abierto || p.fecha <= hoy() ? '<div class="entr" id="entr"></div>' : '';
    if (e.err) return '';
    if (e.d) {
      const k = (c.carritos || {})[e.d.k], hora = e.d.at && (e.d.at.toDate ? e.d.at.toDate() : new Date(e.d.at));
      return `<div class="entr ok" id="entr"><div class="h">✓ Lo entregado en este turno</div><p class="res">${esc(resumenItems(e.d.items))}</p><div class="q"><span>${k ? esc(kNombre(k)) + ' · ' : ''}Lo cargó ${esc(e.d.porNombre || '')}${hora && !isNaN(hora) ? ' · ' + pad(hora.getHours()) + ':' + pad(hora.getMinutes()) : ''}</span>${abierto ? `<button type="button" class="sbtn" data-corregir="${esc(p.id)}">Corregir</button>` : ''}</div>${abierto && conMant(c) && k ? `<button type="button" class="linkish probl" data-probk="${esc(p.id)}">${I('alert', 'width:14px;height:14px')}Informar un problema del carrito</button>` : ''}</div>`;
    }
    if (!abierto) return p.fecha === hoy() ? '<div class="entr" id="entr"><p class="nota0">Al terminar el turno vas a poder contar lo que se dejó en el carrito.</p></div>' : '';
    return `<div class="entr pend" id="entr"><b>¿Cómo te fue? Contá lo que se dejó</b><p>Escaneá el QR del carrito que usaste. Lo carga uno solo por turno.</p><button type="button" class="btn" data-contar="${esc(p.id)}">${I('qr')}Escanear carrito</button></div>`;
  }
  /* El escáner: la cámara dentro de la app (así siempre está la sesión del hermano). Si no hay cámara, se elige el número. */
  const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  function cargarJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (cargarJsQR.p) return cargarJsQR.p;
    cargarJsQR.p = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = JSQR; sc.onload = () => (window.jsQR ? res(window.jsQR) : rej(new Error('jsqr'))); sc.onerror = () => { cargarJsQR.p = null; rej(new Error('jsqr')); }; document.head.appendChild(sc); });
    return cargarJsQR.p;
  }
  const codDeTexto = (t) => { const m = String(t || '').match(/#\/k\/([A-Za-z0-9]{6,12})/) || String(t || '').trim().match(/^([A-Za-z0-9]{8})$/); return m ? m[1].toUpperCase() : ''; };
  function escanear(c, listo) {
    const ks = Object.keys((c && c.carritos) || {}).map(kid => [kid, c.carritos[kid]]).sort((a, b) => a[1].n - b[1].n);
    const ov = document.createElement('div'); ov.className = 'esc';
    ov.innerHTML = `<div class="top"><button type="button" data-esc-x>${I('x', 'width:16px;height:16px')}Cerrar</button><h3>Escanear carrito</h3></div>
      <div class="cam"><video playsinline muted></video><div class="frame"></div><div class="msg" aria-live="polite">Abriendo la cámara…</div></div>
      <div class="bot"><p>¿No funciona la cámara? Elegí el número que está debajo del QR:</p><div class="ch">${ks.map(([kid, k]) => `<button type="button" data-kman="${esc(kid)}" style="background:${colorHex(k)}" aria-label="${esc(kNombre(k))}">${esc(String(k.n))}</button>`).join('') || '<small>Esta campaña todavía no tiene carritos.</small>'}</div></div>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('video'), msg = ov.querySelector('.msg');
    let stream = null, vivo = true, det = null, cv = null;
    const cerrar = () => { vivo = false; if (stream) stream.getTracks().forEach(t => t.stop()); ov.remove(); };
    const listoCon = (kid, modo) => { cerrar(); listo(kid, modo); };
    ov.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.escX !== undefined) cerrar(); else if (b.dataset.kman) listoCon(b.dataset.kman, 'mano'); });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
    modal(ov, ov);
    const leido = (txt) => {
      const cod = codDeTexto(txt); if (!cod) return false;
      const r = carritoDe(cod);
      if (!r) { msg.textContent = 'Ese QR no es de un carrito de la PPAM.'; return false; }
      if (c && r.c.id !== c.id) { msg.textContent = `Ese carrito es de otra campaña (${r.c.nombre}).`; return false; }
      listoCon(r.kid, 'qr'); return true;
    };
    const buscar = async () => {
      if (!vivo) return;
      try {
        if (video.readyState >= 2) {
          if (det) { const r = await det.detect(video); if (r && r[0] && leido(r[0].rawValue)) return; }
          else if (window.jsQR) {
            cv = cv || document.createElement('canvas'); const w = video.videoWidth, h = video.videoHeight;
            if (w && h) { cv.width = w; cv.height = h; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(video, 0, 0, w, h); const r = window.jsQR(g.getImageData(0, 0, w, h).data, w, h); if (r && leido(r.data)) return; }
          }
        }
      } catch (e) { /* sigue intentando */ }
      setTimeout(buscar, 250);
    };
    (async () => {
      try {
        if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) throw new Error('sin cámara');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!vivo) { stream.getTracks().forEach(t => t.stop()); return; }
        video.srcObject = stream; await video.play().catch(() => {});
        if ('BarcodeDetector' in window) { try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) det = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { det = null; } }
        if (!det) await cargarJsQR();
        msg.textContent = 'Apuntá al QR del carrito'; buscar();
      } catch (e) { ov.classList.add('sincam'); msg.textContent = 'No se pudo abrir la cámara. Elegí el número del carrito abajo.'; }
    })();
  }
  // Contar lo que se dejó (con el carrito ya elegido)
  async function contar(p, kid, modo) {
    const c = S.campanas[p.cid], k = ((c && c.carritos) || {})[kid]; if (!k) { toast('No encontramos ese carrito.'); return; }
    await cargarPubs();
    const id = cupoId(p.cid, p.fecha, p.tid), prev = ((S.ent[id] || {}).d) || null, ant = (prev && prev.items) || {};
    const ids = [...new Set([...Object.keys(k.items || {}), ...Object.keys(ant)])].filter(x => (S.pubs || {})[x]);
    const ov = sheet(`<div class="kok">${kNum(k, 'big')}<span class="tx"><b>${esc(kNombre(k))}</b><small>${modo === 'qr' ? '✓ Escaneado' : 'Elegido a mano'}</small></span><button type="button" class="sbtn" id="ctOtro">No es este</button></div>${repHTML(k)}
      <h3 style="margin-top:14px">¿Cuánto se dejó?</h3><p class="hint">${esc(cap(fmtDia(p.fecha)))} · ${esc(p.desde)} a ${esc(p.hasta)}${prev ? ` · ya lo cargó ${esc(prev.porNombre || '')}: si algo está mal, corregilo` : ''}</p>
      <div class="ctl">${ids.length ? ids.map(x => `<div class="it">${tapaHTML(x)}<span class="tx"><b>${esc(pubNombre(x))}</b><small>${esc(pubSub(S.pubs[x]))}</small></span><span class="stp"><button type="button" data-mn="${esc(x)}" aria-label="Uno menos">−</button><input type="number" inputmode="numeric" min="0" max="999" value="${ant[x] || 0}" data-cnt="${esc(x)}" aria-label="Cantidad de ${esc(pubNombre(x))}"><button type="button" data-mas="${esc(x)}" aria-label="Uno más">+</button></span></div>`).join('') : '<p class="hint">Este carrito todavía no tiene publicaciones cargadas. Avisale al coordinador.</p>'}</div>
      <button type="button" class="btn" id="ctOk"${ids.length ? '' : ' disabled'}>Guardar lo entregado</button><button type="button" class="btn alt" data-cerrar>Cancelar</button><p class="fine">Se cuenta en el ${esc(kNombre(k).toLowerCase())}. Solo cantidades, nunca datos de las personas.</p>`);
    const q = (s) => ov.querySelector(s);
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-mn],[data-mas]'); if (!b) return; const x = b.dataset.mn || b.dataset.mas, inp = ov.querySelector(`[data-cnt="${CSS.escape(x)}"]`); inp.value = Math.max(0, Math.min(999, (parseInt(inp.value, 10) || 0) + (b.dataset.mn ? -1 : 1))); });
    q('#ctOtro').addEventListener('click', () => { ov.remove(); escanear(c, (k2, m2) => contar(p, k2, m2)); });
    q('#ctOk').addEventListener('click', async () => {
      const items = {}; ov.querySelectorAll('[data-cnt]').forEach(inp => { const n = Math.max(0, Math.min(999, parseInt(inp.value, 10) || 0)); if (n) items[inp.dataset.cnt] = n; });
      const b = q('#ctOk'); b.disabled = true; b.textContent = 'Guardando…';
      try {
        await conTiempo(S.db.doc('entregas/' + id).set({ cid: p.cid, fecha: p.fecha, tid: p.tid, k: kid, modo, items, por: S.yo, porNombre: nombreYo().slice(0, 80), at: S.ahora() }));
        S.ent[id] = { t: Date.now(), d: { cid: p.cid, fecha: p.fecha, tid: p.tid, k: kid, modo, items, por: S.yo, porNombre: nombreYo(), at: new Date().toISOString() } };
        ov.remove(); render();
        if (conMant(c)) quedoBien(c, kid, id); else toast('¡Gracias! Quedó guardado lo entregado');
      } catch (e) { console.error(e); b.disabled = false; b.textContent = 'Guardar lo entregado'; toast(e && e.code === 'sin-respuesta' ? 'Hay poca señal: se guarda solo cuando vuelva la conexión.' : 'No se pudo guardar. Probá de nuevo.'); }
    });
  }
  // Empezar a contar desde un turno (o desde un QR escaneado afuera de la app)
  function contarTurno(p) { const c = S.campanas[p.cid]; cargarPubs(); escanear(c, (kid, modo) => contar(p, kid, modo)); }
  async function alAbrirCarrito(cod) {
    const r = carritoDe(cod);
    if (!r) { sheet(`<h3>No encontramos ese carrito</h3><p class="hint">Puede que lo hayan borrado o que sea de una campaña que ya terminó.</p><button type="button" class="btn alt" data-cerrar>Cerrar</button>`); return; }
    if (S.isAdmin || S.coordDe.includes(r.c.id)) { fichaCarrito(r.c.id, r.kid); return; }
    const ps = turnosParaContar().filter(p => p.cid === r.c.id);
    if (!ps.length) { sheet(`<div class="kok">${kNum(r.k, 'big')}<span class="tx"><b>${esc(kNombre(r.k))}</b><small>${esc(r.c.nombre)}</small></span></div>${repHTML(r.k)}<p class="hint" style="margin-top:14px">No tenés un turno para cargar con este carrito. Se puede contar lo entregado desde 15 minutos antes de que termine tu turno confirmado hasta el día siguiente.</p><button type="button" class="btn alt" data-cerrar>Cerrar</button>`); return; }
    await Promise.all(ps.map(p => cargarEnt(p)));
    if (ps.length === 1) { contar(ps[0], r.kid, 'qr'); return; }
    const ov = sheet(`<h3>¿De qué turno?</h3><p class="hint">${esc(kNombre(r.k))} · ${esc(r.c.nombre)}</p>${ps.map((p, i) => `<button type="button" class="btn alt" data-tq="${i}">${esc(cap(fmtDia(p.fecha)))} · ${esc(p.desde)} a ${esc(p.hasta)}</button>`).join('')}<button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    ov.querySelectorAll('[data-tq]').forEach(b => b.addEventListener('click', () => { ov.remove(); contar(ps[+b.dataset.tq], r.kid, 'qr'); }));
  }
  // Alguien que no tiene la app abierta escanea el QR de un carrito con la cámara del celular
  function renderQRPublico() {
    cerrada(`<div class="lk">${I('qr', 'width:30px;height:30px')}</div><h2>Este carrito es de la predicación pública</h2><p>¿Querés saber más sobre lo que enseña la Biblia? En jw.org encontrás la Biblia, artículos y videos gratis, en muchos idiomas.</p>
      <a class="btn" href="https://www.jw.org/es/" target="_blank" rel="noopener">Ir a jw.org</a>
      <div class="codok qrher">${I('help', 'width:18px;height:18px')}<span><b>¿Sos publicador?</b>Abrí la app PPAM con tu link y tocá "Escanear carrito" para cargar lo que se dejó.</span></div>`);
  }

  /* ---------- Mantenimiento de los carritos (se prende por campaña) ----------
     problemas/{id}: lo que informa un hermano (o el coordinador en una revisión). Lo ve y sigue el coordinador. */
  const conMant = (c) => !!(c && c.mantOn);
  const PROB_TIPOS = ['Rueda', 'Freno', 'Estante', 'Lona o cartel', 'Está sucio', 'Le falta algo', 'Otro'];
  // Foto chica para un problema (se achica en el celular antes de subirse)
  function fotoChica(file, max) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight; const k = Math.min(1, (max || 640) / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
        let q = 0.75, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 130000 && q > 0.3) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        if (out.length > 145000) rej(new Error('grande')); else res(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagen')); };
      img.src = url;
    });
  }
  function quedoBien(c, kid, turno) {
    const k = (c.carritos || {})[kid]; if (!k) return;
    const ov = sheet(`<div class="kok">${kNum(k, 'big')}<span class="tx"><b>${esc(kNombre(k))}</b><small>${esc(c.nombre)}</small></span></div><h3 style="margin-top:14px">¿El carrito quedó bien?</h3><p class="hint">Si algo se rompió o falta, avisá: el coordinador lo ve enseguida.</p>
      <div class="sino"><button type="button" class="btn" data-cerrar>Sí, todo bien</button><button type="button" class="btn alt prob" id="qbNo">Tiene un problema</button></div>`);
    ov.querySelector('#qbNo').addEventListener('click', () => { ov.remove(); informarProblema(c, kid, turno); });
  }
  function informarProblema(c, kid, turno) {
    const k = (c.carritos || {})[kid]; if (!k) return;
    const st = { tipos: new Set(), foto: '' };
    const ov = sheet(`<h3>¿Qué le pasa al ${esc(kNombre(k).toLowerCase())}?</h3><p class="hint">Elegí lo que corresponda. El coordinador lo ve enseguida.</p>
      <div class="pchs">${PROB_TIPOS.map(t => `<button type="button" data-pt="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}</div>
      <div class="fld"><label for="prN">Contalo en pocas palabras (opcional)</label><textarea id="prN" rows="2" maxlength="300" placeholder="Por ejemplo: la rueda de adelante está floja"></textarea></div>
      <div class="lbl">Foto (opcional)</div><div class="up" id="prF"></div>
      <label class="ck" style="margin-top:12px"><input type="checkbox" id="prNo"> <span><b>No se puede usar</b> (que no lo lleve nadie hasta que lo arreglen)</span></label>
      <p class="err hidden" id="prErr"></p>
      <button type="button" class="btn" id="prOk">Avisar al coordinador</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const q = (s) => ov.querySelector(s);
    const pintarF = () => {
      q('#prF').innerHTML = st.foto ? `<div class="img" style="background-image:url('${st.foto}')"><button type="button" id="prFX" aria-label="Quitar foto">✕</button></div>` : `<label class="add">${I('camera', 'width:20px;height:20px;margin:0 auto 3px;display:block')}Agregar foto<input type="file" accept="image/*" id="prFile"></label>`;
      if (q('#prFX')) q('#prFX').addEventListener('click', () => { st.foto = ''; pintarF(); });
      if (q('#prFile')) q('#prFile').addEventListener('change', async (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; try { st.foto = await fotoChica(f, 640); pintarF(); } catch (er) { toast('No se pudo usar esa foto. Probá con otra.'); } });
    };
    pintarF();
    ov.querySelectorAll('[data-pt]').forEach(b => b.addEventListener('click', () => { const t = b.dataset.pt; if (st.tipos.has(t)) st.tipos.delete(t); else st.tipos.add(t); b.classList.toggle('on', st.tipos.has(t)); b.setAttribute('aria-pressed', st.tipos.has(t) ? 'true' : 'false'); }));
    q('#prOk').addEventListener('click', async () => {
      if (!st.tipos.size) { q('#prErr').textContent = 'Elegí qué le pasa (por lo menos una opción).'; q('#prErr').classList.remove('hidden'); return; }
      const d = { cid: c.id, k: kid, tipo: [...st.tipos].join(', ').slice(0, 80), noUsar: q('#prNo').checked, por: S.yo, porNombre: nombreYo().slice(0, 80), at: S.ahora(), estado: 'nuevo' };
      const nota = q('#prN').value.trim().slice(0, 300); if (nota) d.nota = nota;
      if (st.foto) d.foto = st.foto;
      if (turno) d.turno = turno;
      const b = q('#prOk'); b.disabled = true; b.textContent = 'Enviando…';
      try { await conTiempo(S.db.collection('problemas').doc(Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).set(d)); ov.remove(); toast('Gracias: el coordinador ya lo ve'); }
      catch (e) { console.error(e); b.disabled = false; b.textContent = 'Avisar al coordinador'; toast(e && e.code === 'sin-respuesta' ? 'Hay poca señal: se manda solo cuando vuelva la conexión.' : 'No se pudo enviar. Probá de nuevo.'); }
    });
  }
  const repHTML = (k) => k && k.estado === 'rep' ? `<div class="krep">${I('alert', 'width:18px;height:18px;flex-shrink:0;margin-top:1px')}<span><b>Este carrito está en reparación</b>${k.motivo ? esc(k.motivo) + '. ' : ''}No lo lleves hasta que el coordinador lo marque como arreglado.</span></div>` : '';
  const waLink = (cel, txt) => { let x = String(cel || '').replace(/\D/g, ''); if (x.length === 10) x = '549' + x; return 'https://wa.me/' + x + '?text=' + encodeURIComponent(txt); };

  // Varias novedades juntas (por ejemplo, los lugares de cada campaña) se dibujan una sola vez.
  // Mientras alguien escribe en un formulario de la pantalla (p. ej. Datos de la campaña), los cambios que llegan
  // no redibujan: se guardan para después, así no se pierde lo escrito.
  function ocupado() { const f = document.querySelector('#app [data-editable]'); if (!f) { S.sucio = false; return false; } const a = document.activeElement; return !!S.sucio || (f.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'file'); }
  function refrescar(fn) { if (ocupado()) { S.pendRender = true; return; } fn(); }
  function refrescarPend() { if (S.pendRender && !ocupado()) { S.pendRender = false; render(); } }
  document.addEventListener('input', (e) => { if (e.target.type !== 'file' && e.target.closest && e.target.closest('#app [data-editable]')) S.sucio = true; });
  document.addEventListener('focusout', () => setTimeout(refrescarPend, 0));
  function luego() { if (luego.t) return; luego.t = setTimeout(() => { luego.t = 0; refrescar(render); }, 0); }
  // Mientras cargan las campañas: la forma de la pantalla en gris (se nota que está cargando, no que no anda)
  const esqueleto = () => `<div class="sk" aria-hidden="true"><div class="skw"><i style="width:55%;height:22px"></i><i style="width:85%"></i><i style="width:70%"></i><i class="skb"></i></div><div class="skt"><i style="width:35%;height:18px"></i></div>${[1, 2].map(() => '<div class="skc"><span class="skth"></span><span><i style="width:60%;height:15px"></i><i style="width:80%"></i><i style="width:45%"></i></span></div>').join('')}</div><p class="sr-only" role="status">Cargando las campañas…</p>`;
  // Transiciones al navegar (no en las actualizaciones de datos): deslizar al avanzar/volver, fundido entre pestañas
  const PROF = { home: 0, mis: 0, ayuda: 0, admin: 0, soporte: 0, coord: 0, camp: 1, turno: 2 };
  const prof = (r) => (PROF[r.name] || 0) + (r.name === 'coord' && r.cid ? 1 : 0);
  S.anim = '';
  function transicion(a, b) {
    if (!a || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    S.anim = prof(b) > prof(a) ? 'adelante' : prof(b) < prof(a) ? 'atras' : 'tab';
  }
  // Presentación de la campaña: la primera vez que se abre (en este celular), la portada en grande con sus datos; después se achica sola
  document.addEventListener('click', (e) => { const card = e.target.closest && e.target.closest('.cc.camp'); S.desdeThumb = card ? card.querySelector('.th') : null; }, true);
  function introCampana(c, enTransicion) {
    const k = 'ppam-vista:' + c.id;
    try { if (localStorage.getItem(k) || matchMedia('(prefers-reduced-motion: reduce)').matches) return false; localStorage.setItem(k, '1'); } catch (e) { return false; }
    const n = faltanDias(c), pts = Object.values(c.puntos || {}).length, dias = diasDe(c), lib = dias.length ? cobertura(c, dias.filter(d => d <= addDays(dias[0], 6))).faltan : 0;
    const fk = c.portada ? fotoKey(c.id, c.portada) : '', foto = fk && S.fotos[fk];
    const pts1 = pts === 1 ? '1 punto' : pts + ' puntos';
    const it = document.createElement('div'); it.className = 'intro' + (foto ? ' foto' : ''); it.setAttribute('role', 'button'); it.setAttribute('aria-label', 'Ver la campaña');
    it.style.backgroundImage = foto ? `url("${foto}")` : colorDe(c);
    it.innerHTML = `${foto ? '' : `<span class="ii">${I(Object.values(c.puntos || {}).some(p => p.tipo === 'carrito') ? 'cart' : 'stand', 'width:64px;height:64px')}</span>`}<div class="itx"><small>${esc(c.ciudad || '')}</small><h2>${esc(c.nombre)}</h2><p>${esc(campRango(c))}</p><span class="ist">${n ? empiezaTxt(n) : 'En curso'}</span><p class="idat">${esc(pts1)}${lib ? ` · <b>${lib} ${lib === 1 ? 'lugar libre' : 'lugares libres'}</b> esta semana` : ''}</p><small class="isal">Tocá para seguir</small></div>`;
    if (enTransicion) it.style.viewTransitionName = 'portada';
    document.body.appendChild(it);
    let listo = false;
    const cerrar = () => {
      if (listo) return; listo = true;
      if (!document.startViewTransition) { it.classList.add('sale'); setTimeout(() => it.remove(), 300); return; }
      it.style.viewTransitionName = 'portada'; document.documentElement.dataset.vt = 'intro';
      const t = document.startViewTransition(() => { it.remove(); $('tb').style.viewTransitionName = 'portada'; });
      t.finished.finally(() => { $('tb').style.viewTransitionName = ''; delete document.documentElement.dataset.vt; });
    };
    it.addEventListener('click', cerrar);
    const prog = () => setTimeout(cerrar, 1900);
    if (enTransicion) S.introPend = prog; else prog();
    return true;
  }
  function render() {
    if (S.anim) {
      const dir = S.anim; S.anim = '';
      if (document.startViewTransition) {
        // Al abrir una campaña desde su tarjeta, la foto chica "crece" hasta la portada (o hasta la presentación, la primera vez)
        const th = dir === 'adelante' && S.route.name === 'camp' ? S.desdeThumb : null; S.desdeThumb = null;
        if (th && th.isConnected) th.style.viewTransitionName = 'portada';
        document.documentElement.dataset.vt = dir;
        const t = document.startViewTransition(() => { render(); if (th) { const c = S.campanas[S.route.cid]; if (!(c && introCampana(c, true))) $('tb').style.viewTransitionName = 'portada'; } });
        t.finished.finally(() => { delete document.documentElement.dataset.vt; $('tb').style.viewTransitionName = ''; if (th) th.style.viewTransitionName = ''; if (S.introPend) { const f = S.introPend; S.introPend = null; f(); } });
        return;
      }
      const app = $('app'); app.classList.remove('entra'); void app.offsetWidth; app.classList.add('entra'); setTimeout(() => app.classList.remove('entra'), 600);
    }
    renderTop();
    const r = S.route;
    if (r.name === 'canje') return renderCanje();
    if (r.name === 'ayuda' && S.acceso !== 'cargando') return renderAyuda();
    if (S.acceso === 'cargando') { $('app').innerHTML = esqueleto(); return; }
    if (r.name === 'carrito' && S.acceso !== 'si') return renderQRPublico();
    if (S.acceso !== 'si') return renderCerrado();
    if (!S.loaded) { $('app').innerHTML = esqueleto(); return; }
    if (r.name === 'carrito') { const cod = r.cod; go('#/'); setTimeout(() => alAbrirCarrito(cod), 0); return; }
    if (r.name === 'camp') return renderCamp();
    if (r.name === 'mis') return renderMis();
    if (r.name === 'turno') return renderTurno();
    if (r.name === 'coord') return renderCoord();
    if (r.name === 'admin') return renderAdmin();
    if (r.name === 'hermanos') return renderHermanos();
    if (r.name === 'soporte') return renderSoporte();
    if (r.name === 'ayuda') return renderAyuda();
    renderHome();
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
      console.error(e); if (S.esHermano && /permission/i.test(e.code || '')) { revisarSesion().then((ok) => { if (ok) registrarError('aviso', 'Cupos: ' + e.code + ' (con acceso)'); }); } else registrarError('aviso', 'Cupos: ' + (e.code || e.message || e)); S.ccErr[cid] = true; S.ccUnsub[cid] = null; if (S.route.name === 'camp' && S.route.cid === cid) luego();
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
    if (!conf) hint = '<div class="hint">Un coordinador lo revisa y te confirma. Lo vas a ver acá y en Mis turnos.' + (p.fecha <= addDays(hoy(), 2) ? ' <b>Si falta poco y todavía no te confirmaron, avisale al coordinador de tu congregación.</b>' : '') + '</div>';
    else if (esHoy && pt.retiro) hint = `<div class="hint">${esc(retiroLabel(pt))}: ${esc(pt.retiro)}</div>`;
    let acts;
    if (!conf) acts = `<button type="button" class="btn gh" data-go="#/t/${esc(p.id)}">Ver detalle</button><button type="button" class="btn gh sm" data-cancelar="${esc(p.id)}">Cancelar</button>`;
    else if (esHoy && url) acts = `<a class="btn w big2" href="${esc(url)}" target="_blank" rel="noopener"${llegarAttr(p.cid, p.punto)}>${I('nav')}Cómo llegar</a><button type="button" class="btn gh sm" data-go="#/t/${esc(p.id)}">Detalle</button>`;
    else acts = (url ? `<a class="btn w" href="${esc(url)}" target="_blank" rel="noopener"${llegarAttr(p.cid, p.punto)}>${I('nav')}Cómo llegar</a>` : '') + `<button type="button" class="btn gh" data-go="#/t/${esc(p.id)}">Ver detalle</button>`;
    return `<div class="ticket${conf ? '' : ' pend'}"><div class="top">${top}</div><div class="t num">${esc(p.desde)} – ${esc(p.hasta)}</div>${esHoy ? '' : `<div class="cuando">${esc(cuando)}</div>`}<div class="p">${I('pin')}${esc(c.nombre || '')}${pt.nombre ? ' · ' + esc(pt.nombre) : ''}</div>${hint}<div class="sep"></div><div class="acts">${acts}</div></div>`;
  }
  function libresSemana(cs) {
    let n = 0, mejor = null, max = 0, semana = false;
    cs.forEach(c => { const ds = diasDe(c).filter(d => d <= addDays(hoy(), 6)); if (!ds.length) return; semana = true; listenCC(c.id); const k = cobertura(c, ds); n += k.faltan; if (k.faltan > max) { max = k.faltan; mejor = c; } });
    return { n, mejor, semana };
  }
  // La campaña que tiene turnos primero después de esta semana (con sus lugares libres de esa primera semana, como en su tarjeta)
  function proximaCampana(cs) {
    let mejor = null;
    cs.forEach(c => { const ds = diasDe(c); if (!ds.length || ds[0] <= addDays(hoy(), 6)) return; if (!mejor || ds[0] < mejor.dia) mejor = { c, dia: ds[0], ds }; });
    if (!mejor) return null;
    listenCC(mejor.c.id);
    const n = Math.round((parseIso(mejor.dia) - parseIso(hoy())) / 864e5);
    return Object.assign(mejor, { n, libres: cobertura(mejor.c, mejor.ds.filter(d => d <= addDays(mejor.dia, 6))).faltan });
  }
  const nombreCorto = (c) => String(c.nombre || '').replace(/^Campaña (de Predicación Pública|Especial)\s*[-–]?\s*/i, '').replace(/^.*?"(.+)"$/, '$1').trim() || c.nombre;
  /* ---------- Bienvenida: 3 pasos, solo la primera vez (se vuelve a ver con "¿Cómo funciona?") ---------- */
  const PASOS = [
    { t: 'Elegí una campaña', d: 'En el inicio están las campañas de toda la provincia. Tocá la de tu ciudad.' },
    { t: 'Elegí día y horario', d: 'Tocá un día y después un horario que tenga lugar.' },
    { t: 'Confirmá tus datos y anotate', d: 'Tu nombre, congregación y celular ya los cargó el responsable. Solo los ven los coordinadores de esa campaña.' },
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
  /* ---------- Ayuda: preguntas frecuentes (texto fijo, sin lecturas a Firebase) ---------- */
  const AYUDA = [
    { g: 'Anotarme', qs: [
      ['link', '¿Cómo entro a la página?', 'Con el link personal que te mandó por WhatsApp el responsable de tu congregación: lo tocás, confirmás y listo, sin contraseña ni cuenta de Google. Guardá ese mensaje: si cambiás de celular o se te cierra, tocás el mismo link y entrás de nuevo. Funciona en un celular a la vez.'],
      ['reenvio', '¿Puedo pasarle mi link a otro hermano?', 'No: es solo para vos. Si otra persona lo usa, a vos se te cierra la página en tu celular y el responsable lo ve. Cada hermano recibe su propio link cuando el comité de servicio de su congregación lo aprueba.'],
      ['espera', 'Mi turno dice "Esperando confirmación", ¿qué significa?', 'Que tu pedido llegó bien y un coordinador de la campaña lo tiene que confirmar. Mientras tanto el lugar queda guardado para vos. Cuando lo confirme, en Mis turnos va a decir "Confirmado".'],
      ['completo', 'Un horario dice "Completo", ¿qué hago?', 'Elegí otro horario u otro día: los que tienen lugar dicen cuántos quedan libres. Con el filtro "Con lugar" ves solo esos, y con la lupa de arriba buscás lugares libres para hoy o mañana en toda la provincia.'],
      ['acompanado', '¿Puedo anotarme con mi esposa o con otro hermano?', 'Sí. Cada uno se anota con su propio link en el mismo horario. Al anotarte podés dejar una nota para el coordinador, por ejemplo "Voy con mi esposa". Desde tu turno, "Invitar a alguien a este turno" le manda el enlace por WhatsApp.'],
      ['varios', '¿Puedo anotarme en más de un turno?', 'Sí, en los que quieras. Si dos turnos se superponen en el horario, la app te avisa antes de confirmar.']
    ] },
    { g: 'Mis turnos', qs: [
      ['confirmado', '¿Cómo sé si me confirmaron?', 'Entrá a Mis turnos: cada turno dice "Esperando confirmación" o "Confirmado". También lo ves en el inicio. La app no manda notificaciones; si hace falta, el coordinador te escribe por WhatsApp.'],
      ['llegar', '¿Cómo llego al lugar?', 'En tu turno, "Llegar" abre Google Maps con el lugar marcado. En la campaña, "Ver lugar" muestra fotos e indicaciones del punto.'],
      ['agendar', '¿Cómo lo agendo en el calendario del celular?', 'En tu turno tocá "Agendar": se descarga un archivo que tu celular abre con el calendario, con el día, el horario y el lugar.'],
      ['cancelar', 'No puedo ir, ¿cómo cancelo?', 'Entrá a Mis turnos, tocá el turno y después "Cancelar". El lugar se libera enseguida para otro hermano. Avisá con tiempo: así el coordinador puede cubrirlo. Si la campaña tiene un WhatsApp de contacto, en el detalle del turno está el botón "Avisar al coordinador que no puedo ir", que le manda el mensaje ya escrito.'],
      ['contar', '¿Cómo cargo lo que se dejó en el carrito?', 'Si tu campaña lleva la cuenta de las publicaciones, al terminar el turno aparece "Escaneá el carrito y contá lo que se dejó". Tocá Escanear, apuntá al QR pegado en el carrito y poné cuántas se dejaron de cada una. Lo carga uno solo por turno: si tu compañero ya lo hizo, ves lo que puso y lo podés corregir. Si la cámara no funciona, elegí el número del carrito, que está debajo del QR.']
    ] },
    { g: 'Mis datos y la app', qs: [
      ['datos', '¿Quién ve mis datos?', 'Solo los coordinadores de la campaña en la que te anotaste, para organizar los turnos. Los demás hermanos ven cuántos lugares quedan, pero no quién está anotado, salvo que elijas mostrar tu nombre a tus compañeros de turno.'],
      ['companeros', '¿Puedo saber con quién voy?', 'Sí, si tus compañeros eligieron mostrar su nombre. Al pedir el turno marcá "Que mis compañeros de turno vean mi nombre". Lo ven solo los hermanos confirmados en ese mismo horario y lugar: nombre, apellido y congregación, nunca el celular. Lo podés cambiar cuando quieras desde el detalle del turno, y se borra cuando el turno pasa.'],
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
  /* ---------- Web cerrada: sin acceso no se ve nada ---------- */
  function cerrada(h) { window.__ppamOk = true; $('app').removeAttribute('aria-busy'); $('app').innerHTML = `<div class="cerr">${h}</div>`; }
  const cuando = (ts) => { const d = ts && (ts.toDate ? ts.toDate() : new Date(ts)); if (!d || isNaN(d)) return ''; const f = isoOf(d), hh = `${d.getHours()}:${pad(d.getMinutes())}`; return f === hoy() ? `Hoy a las ${hh}` : f === addDays(hoy(), -1) ? `Ayer a las ${hh}` : `El ${cap(fmtDia(f))} a las ${hh}`; };
  function renderCerrado() {
    const coord = '<p class="fine cerr-co"><button type="button" class="linkish" data-login>Soy coordinador · entrar con Google</button></p>';
    if (S.acceso === 'otro') {
      const h = S.otro || {};
      return cerrada(`<div class="lk warn">${I('alert', 'width:30px;height:30px')}</div><h2>Tu acceso se abrió en otro celular</h2><p>${esc(cuando(h.ultimo) || 'Hace un rato')} alguien entró con tu link desde otro teléfono${h.disp ? ` (${esc(h.disp)})` : ''}, así que en este se cerró.</p>
        <div class="codok">${I('check', 'width:18px;height:18px')}<span><b>¿Fuiste vos?</b>Tocá el link del WhatsApp para volver a usar este celular.</span></div>
        <div class="codok mal">${I('x', 'width:18px;height:18px')}<span><b>¿No fuiste vos?</b>Avisale al responsable de tu congregación: te manda un link nuevo y el viejo deja de servir.</span></div>`);
    }
    if (S.acceso === 'baja') return cerrada(`<div class="lk warn">${I('alert', 'width:30px;height:30px')}</div><h2>Tu acceso fue dado de baja</h2><p>Si creés que es un error, hablá con el responsable de tu congregación.</p>`);
    if (S.acceso === 'nocoord') return cerrada(`<div class="lk warn">${I('users', 'width:30px;height:30px')}</div><h2>Esta cuenta no coordina ninguna campaña</h2><p>${esc(S.user.email)} no está como coordinador. Los publicadores entran con el link personal que les manda el responsable de su congregación, sin cuenta de Google.</p><button type="button" class="btn alt" id="ncOut">Salir</button>`), $('ncOut').addEventListener('click', () => cerrarSesion());
    cerrada(`<div class="lk">${I('link', 'width:30px;height:30px')}</div><h2>Predicación pública en Entre Ríos</h2><p>Para entrar, tocá el link que te mandó por WhatsApp el responsable de tu congregación.</p>
      <div class="codok">${I('help', 'width:18px;height:18px')}<span><b>¿Cambiaste de celular o se te cerró?</b>Buscá ese mismo mensaje en WhatsApp y tocá el link otra vez. Si no lo encontrás, pedile uno nuevo al responsable.</span></div>${coord}`);
  }
  /* ---------- Entrar con el link personal (#/?cod=XXXXXXXX) ---------- */
  async function cargarCanje(cod) {
    S.canje = { cod, estado: 'cargando' };
    try {
      if (!S.auth.currentUser) await S.auth.signInAnonymously();
      const d = await S.db.doc('links/' + cod).get();
      if (!S.canje || S.canje.cod !== cod) return;
      if (!d.exists) S.canje.estado = 'malo';
      else { S.canje.link = d.data(); S.canje.estado = 'listo'; }
    } catch (e) { console.error(e); if (S.canje && S.canje.cod === cod) S.canje.estado = /permission|insufficient/i.test(e && (e.code || e.message) || '') ? 'malo' : 'error'; }
    if (S.route.name === 'canje') render();
  }
  function renderCanje() {
    const cod = S.route.cod;
    if (!S.canje || S.canje.cod !== cod) { cargarCanje(cod); }
    const k = S.canje;
    if (k.estado === 'cargando' || k.estado === 'entrando') { $('app').innerHTML = `<div class="cerr"><div class="lk">${I('link', 'width:30px;height:30px')}</div><h2>${k.estado === 'entrando' ? 'Entrando…' : 'Un momento…'}</h2></div>`; return; }
    if (k.estado === 'malo') return cerrada(`<div class="lk warn">${I('alert', 'width:30px;height:30px')}</div><h2>Este link ya no sirve</h2><p>Puede ser que el responsable te haya mandado uno más nuevo, o que se haya dado de baja. Buscá el último mensaje o pedile uno nuevo al responsable de tu congregación.</p>`);
    if (k.estado === 'error') return cerrada(`<div class="lk warn">${I('alert', 'width:30px;height:30px')}</div><h2>No pudimos revisar tu link</h2><p>Revisá la conexión y probá de nuevo.</p><button type="button" class="btn" id="cjRe">Reintentar</button>`), $('cjRe').addEventListener('click', () => { S.canje = null; render(); });
    const l = k.link, ya = S.esHermano && S.acceso === 'si' && S.yo === l.hid;
    if (ya) { history.replaceState(null, '', location.pathname + '#/'); readRoute(); render(); return; }
    const ini = iniciales((l.nombre || '') + ' ' + (l.apellido || ''));
    const otra = l.usado ? `<h2>Hola de nuevo, ${esc(l.nombre)}</h2><p>Ya entraste antes desde otro celular.</p>` : `<h2>¡Hola, ${esc(l.nombre)}!</h2><p>Tu congregación te habilitó para la predicación pública.</p>`;
    const migra = !l.usado && l.turnos ? `<div class="codok">${I('cal', 'width:18px;height:18px')}<span><b>${l.turnos === 1 ? 'Tu turno pasa' : `Tus ${l.turnos} turnos pasan`} a tu acceso nuevo</b>Los pediste con tu cuenta de Google. Desde ahora entrás solo con este link.</span></div>` : '';
    cerrada(`<div class="lk">${I(l.usado ? 'users' : 'check', 'width:30px;height:30px;stroke-width:2.2')}</div>${otra}<div class="yoc"><span class="av">${esc(ini)}</span><span><b>${esc(l.nombre)}</b><small>${esc(l.congregacion || '')}</small></span></div>${migra}
      <button type="button" class="btn" id="cjOk">${l.usado ? 'Entrar desde este celular' : 'Confirmar ingreso'}</button><p class="fine">${l.usado ? 'Tu acceso se pasa a este celular y el otro se cierra. Tus turnos siguen igual.' : 'Sin contraseña ni cuenta de Google.'}</p>`);
    $('cjOk').addEventListener('click', () => entrarConLink(cod, l));
  }
  async function entrarConLink(cod, l) {
    S.canje.estado = 'entrando'; S.entrando = true; render();
    try {
      // quien usaba la página con Google (o un coordinador probando su link) deja su cuenta en este celular
      if (S.auth.currentUser && !S.auth.currentUser.isAnonymous) await S.auth.signOut();
      if (!S.auth.currentUser) await S.auth.signInAnonymously();
      const u = S.auth.currentUser, b = S.db.batch();
      b.set(S.db.doc('sesiones/' + u.uid), { hid: l.hid, cod, at: S.ahora() });
      b.update(S.db.doc('hermanos/' + l.hid), Object.assign({ uid: u.uid, ultimo: S.ahora(), disp: dispositivo().slice(0, 80) }, l.usado ? { aviso: true } : {}));
      b.update(S.db.doc('links/' + cod), { usado: true });
      await conTiempo(b.commit());
      S.canje = null; history.replaceState(null, '', location.pathname + '#/'); readRoute();
      S.user = u; S.esHermano = true; S.acceso = 'cargando'; render();
      escucharHermano(u, { hid: l.hid, cod });
    } catch (e) {
      console.error(e); registrarError('aviso', 'Entrar con link: ' + (e.code || e.message || e));
      S.canje.estado = /permission|insufficient/i.test(e && (e.code || e.message) || '') ? 'malo' : 'error'; render();
    } finally { S.entrando = false; }
  }
  function renderAyuda() {
    const esCoord = !!(S.user && (S.isAdmin || S.coordDe.length));
    const grupos = AYUDA.filter(g => !g.coord || esCoord);
    // En PC: índice de temas a la izquierda
    let h = PC() ? `<div class="pcw ayc"><nav class="aynav" aria-label="Temas de ayuda"><b>Temas</b>${grupos.map((g, i) => `<button type="button" data-ayg="${i}"${i ? '' : ' class="on"'}>${esc(g.g)}</button>`).join('')}</nav><div class="pcw ayd">` : '';
    h += `<button type="button" class="btn alt" id="ayBv" style="margin:4px 0 6px">${I('star', 'width:18px;height:18px')}Ver la bienvenida otra vez</button>`;
    grupos.forEach((g, i) => {
      h += `<div class="sec" id="ayg-${i}">${esc(g.g)}</div><div class="card faq">${g.qs.map(([id, q, a]) => `<details name="faq" id="faq-${id}"${S.route.q === id ? ' open' : ''}><summary>${esc(q)}${I('chev', 'width:16px;height:16px')}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
    });
    h += `<div class="card" style="padding:14px 16px;margin-top:14px"><b>¿No encontraste tu respuesta?</b><p class="hint" style="margin:4px 0 10px">Contanos qué pasó y te ayuda el equipo de soporte.</p><button type="button" class="sbtn" id="ayRep">${I('alert', 'width:15px;height:15px')}Reportar un problema</button></div>`;
    $('app').innerHTML = h + (PC() ? '</div></div>' : '');
    $('app').querySelectorAll('[data-ayg]').forEach(b => b.addEventListener('click', () => { const s = $('ayg-' + b.dataset.ayg); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('app').querySelectorAll('[data-ayg]').forEach(x => x.classList.toggle('on', x === b)); }));
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
    const prox = S.yo ? misProximos() : [];
    let h = instalarHTML() + avisoContarHTML();
    revisarAvisoContar();
    if (prox.length) {
      h += `<div class="lbl">${prox[0].fecha === hoy() ? 'Hoy' : 'Tu próximo turno'}</div>` + ticket(prox[0]);
      if (prox.length > 1) {
        const otros = prox.slice(1, 3).map(p => { const d = parseIso(p.fecha); return `${DOW[d.getDay()].toLowerCase()} ${d.getDate()}`; });
        h += `<button type="button" class="more" data-go="#/mis"><span><b>Tenés ${prox.length - 1} ${prox.length === 2 ? 'turno' : 'turnos'} más</b><small>${esc(cap(otros.join(' y ')))}${prox.length > 3 ? '…' : ''}</small></span><span class="lk">Ver todos${I('chev', 'width:15px;height:15px')}</span></button>`;
      }
    } else if (!(S.vista === 'mapa' && S.publico.mapa !== false && vis.length)) {   // en modo Mapa, el mapa es el protagonista
      const { n, mejor, semana } = libresSemana(vis);
      const donde = S.ciudad !== 'todas' ? 'En ' + S.ciudad : 'En Entre Ríos';
      const px = (!semana || !n) ? proximaCampana(vis) : null;
      const pxTxt = (p) => `<b>${esc(nombreCorto(p.c))}</b> · ${esc(p.c.ciudad || '')} · ${esc(campRango(p.c).split(' · ')[0])}`;
      const pxLib = (p) => p.libres > 0 ? ` Hay <b>${p.libres === 1 ? '1 lugar libre' : p.libres + ' lugares libres'}</b> la primera semana.` : '';
      if (S.yo && !semana && !px) { /* sin campañas por delante: la lista lo explica */ }
      else {
      h += `${S.yo ? '<div class="lbl">Todavía no tenés turnos</div>' : '<div style="height:6px"></div>'}<div class="welcome">`;
      if (S.yo && !semana) {
        h += `<h4>${px.c.desde > hoy() ? 'La próxima campaña empieza' : 'Los próximos turnos son'} ${px.n === 1 ? 'mañana' : `en ${px.n} días`}</h4><p>${pxTxt(px)}.<br>Ya podés anotarte.${pxLib(px)}</p><button type="button" class="btn p" data-go="#/c/${esc(px.c.id)}">Ver turnos</button></div>`;
      } else if (S.yo && !n) {
        const llenas = vis.filter(c => diasDe(c).some(d => d <= addDays(hoy(), 6)));
        h += `<h4>Esta semana ya está todo cubierto</h4><p>${llenas.length === 1 ? `Los turnos de <b>${esc(nombreCorto(llenas[0]))}</b>${llenas[0].ciudad ? ' (' + esc(llenas[0].ciudad) + ')' : ''} ya están completos.` : 'Todos los turnos de esta semana ya están completos.'}${px ? `<br>La próxima: ${pxTxt(px)}, ${px.n === 1 ? 'mañana' : `en ${px.n} días`}.${pxLib(px)}` : ''}</p>${px ? `<button type="button" class="btn p" data-go="#/c/${esc(px.c.id)}">Ver la próxima campaña</button>` : ''}</div>`;
      } else {
      h += S.yo ? `<h4>¿Te sumás esta semana?</h4><p>${esc(donde)} ${n === 1 ? 'hay <b>1 lugar libre</b>' : `hay <b>${n} lugares libres</b>`} en los próximos 7 días.</p>`
        : `<h4>Sumate a un turno</h4><p>Elegí una campaña, un día y un horario. Un coordinador te confirma.</p><div class="stats"><div><b class="num">${vis.length}</b><small>${vis.length === 1 ? 'campaña activa' : 'campañas activas'}${S.ciudad !== 'todas' ? ' en ' + esc(S.ciudad) : ''}</small></div><div><b class="num">${n}</b><small>lugares libres esta semana</small></div></div>`;
      if (mejor) h += `<button type="button" class="btn p" data-go="#/c/${esc(mejor.id)}">Ver turnos libres</button>`;
      h += '</div>';
      }
      }
    }
    // Coordinadores: pedidos por confirmar
    if (S.user && (S.isAdmin || S.coordDe.length)) {
      const mias = list.filter(c => S.isAdmin || S.coordDe.includes(c.id));
      mias.forEach(c => listenPend(c.id));
      const n = mias.reduce((a, c) => a + (S.pend[c.id] || 0), 0);
      const dest = mias.length === 1 ? '#/coord/' + mias[0].id : '#/coord';
      h += `<button type="button" class="coordbar" data-go="${esc(dest)}"><span class="n num${n ? '' : ' cero'}">${n}</span><span class="tx">${n === 1 ? 'Pedido por confirmar' : n ? 'Pedidos por confirmar' : 'Coordinación · todo al día'}<small>${esc(mias.length === 1 ? mias[0].nombre : mias.length + ' campañas')}</small></span>${I('chev')}</button>`;
    }
    const izq = h; h = '';
    h += `<div class="sh"><b>Campañas</b>${ciudades.length > 1 ? `<label class="flt">${esc(S.ciudad === 'todas' ? 'Toda la provincia' : S.ciudad)}${I('down', 'width:14px;height:14px')}<select id="fCiudad" aria-label="Filtrar por ciudad">${['todas', ...ciudades].map(x => `<option value="${esc(x)}"${x === S.ciudad ? ' selected' : ''}>${x === 'todas' ? 'Toda la provincia' : esc(x)}</option>`).join('')}</select></label>` : ''}</div>`;
    const conMapa = S.publico.mapa !== false;   // Administración → "Mostrar el mapa en el Inicio"
    if (!conMapa && S.vista === 'mapa') S.vista = 'lista';
    if (vis.length && conMapa) h += `<div class="seg2" role="group" aria-label="Ver como"><button type="button" data-vista="lista" class="${S.vista !== 'mapa' ? 'on' : ''}">${I('list', 'width:15px;height:15px')}Lista</button><button type="button" data-vista="mapa" class="${S.vista === 'mapa' ? 'on' : ''}">${I('pin', 'width:15px;height:15px')}Mapa</button></div>`;
    if (vis.length && S.vista === 'mapa') {
      h += mapaHTML();
      // Las que no se pueden ubicar (sin puntos marcados y ciudad desconocida) siguen apareciendo, debajo del mapa.
      const fuera = fueraDelMapa(vis);
      if (fuera.length) h += `<div class="lbl" style="margin-top:4px">${fuera.length === 1 ? 'Sin ubicación en el mapa' : fuera.length + ' campañas sin ubicación en el mapa'}</div><div class="pcw ccs">` + fuera.map(campCard).join('') + '</div>';
    }
    else h += vis.length ? '<div class="pcw ccs">' + vis.map(campCard).join('') + '</div>' : '<div class="card"><div class="empty"><b>Por ahora no hay campañas programadas.</b><br>Cuando haya una, la vas a ver acá y te vas a poder anotar.</div></div>';
    // En PC: lo tuyo (próximo turno, invitación) a la izquierda y las campañas a la derecha
    $('app').innerHTML = /class="(ticket|welcome|coordbar)/.test(izq) ? `<div class="pcw hcols"><div class="pcw hizq">${izq}</div><div class="pcw hder">${h}</div></div>` : izq + h;
    if (vis.length && S.vista === 'mapa') dibujarMapa(vis);
  }
  // Campañas que todavía no empezaron: cuánto falta (días; "mañana")
  const faltanDias = (c) => c.desde && c.desde > hoy() ? Math.round((parseIso(c.desde) - parseIso(hoy())) / 864e5) : 0;
  const empiezaTxt = (n) => n === 1 ? 'Empieza mañana' : `Empieza en ${n} días`;
  const empiezaTag = (c) => { const n = faltanDias(c); return n ? `<span class="pronto">${I('clock', 'width:12px;height:12px')}${empiezaTxt(n)}</span>` : ''; };
  function campCard(c) {
    listenCC(c.id);
    const dias = diasDe(c), pts = Object.values(c.puntos || {});
    let cob = '<small class="falt">Todavía sin turnos cargados</small>';
    if (dias.length) {
      const k = cobertura(c, dias.filter(d => d <= addDays(dias[0], 6)));
      const pct = k.total ? Math.round(k.ocup * 100 / k.total) : 0;
      const cuando = dias[0] <= addDays(hoy(), 6) ? 'en los próximos 7 días' : 'la primera semana';
      cob = `<span class="meter"><i style="--w:${pct}%"></i><span class="num">${pct}%</span></span><small class="falt">${k.faltan > 0 ? `${k.faltan} ${k.faltan === 1 ? 'lugar libre' : 'lugares libres'} ${cuando}` : `Todo cubierto ${cuando}`}</small>`;
    }
    return `<button type="button" class="cc camp" data-go="#/c/${esc(c.id)}"><span class="th${c.portada ? '' : ' sinf'}"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}>${c.portada ? '' : I(pts.some(p => p.tipo === 'carrito') ? 'cart' : pts.some(p => p.tipo === 'stand') ? 'stand' : 'pin', 'width:26px;height:26px')}</span><span class="tx">${empiezaTag(c)}<b>${esc(c.nombre)}</b><small>${esc([c.ciudad, rangoCorto(c), pts.length + (pts.length === 1 ? ' punto' : ' puntos')].filter(Boolean).join(' · '))}</small>${cob}</span>${I('chev')}</button>`;
  }
  const ESTADOS = { pendiente: 'Esperando confirmación', confirmado: 'Confirmado', rechazado: 'No confirmado' };

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
    const fd = faltanDias(c);
    let h = '<div class="pcw ccols"><div class="pcw cizq">';
    h += fd ? `<div class="cuenta" role="note"><div class="cn"><b class="num">${fd}</b><small>${fd === 1 ? 'día' : 'días'}</small></div><div><b>${fd === 1 ? 'La campaña empieza mañana' : `Faltan ${fd} días para que empiece`}</b><span>Ya podés anotarte: elegí un día y un horario.</span></div></div>` : '';
    const botonDia = (d) => {
      const x = parseIso(d), k = cobertura(c, [d]);
      const nivel = k.faltan <= 0 ? 'lleno' : k.faltan / k.total <= 0.34 ? 'poco' : 'libre';
      const llenos = k.total ? Math.round(k.ocup * 3 / k.total) : 0;
      return `<button type="button" class="day ${nivel}${d === S.dia ? ' on' : ''}" data-dia="${d}"${PC() ? ` aria-label="${esc(cap(fmtDia(d)))}"` : ''}><small>${DOW[x.getDay()]}</small><b class="num">${x.getDate()}</b><span class="cap3">${[0, 1, 2].map(i => `<i class="${i < llenos ? 'f' : ''}"></i>`).join('')}</span></button>`;
    };
    const leyenda = '<span class="leyenda"><i class="c"></i>confirmado<i class="p"></i>pedido<i></i>libre</span>';
    if (PC()) {
      // En PC: el mes entero como calendario (con flechas si la campaña dura más de un mes)
      const meses = [...new Set(dias.map(d => d.slice(0, 7)))];
      const mes = S.dia.slice(0, 7), im = meses.indexOf(mes), y = +mes.slice(0, 4), mo = +mes.slice(5, 7) - 1;
      const enMes = new Set(dias.filter(d => d.slice(0, 7) === mes)), nDias = new Date(y, mo + 1, 0).getDate(), off = (new Date(y, mo, 1).getDay() + 6) % 7;
      h += `<div class="month cal-h"><b>${cap(MES[mo])} ${y}</b>${meses.length > 1 ? `<span class="calnav"><button type="button" class="sbtn" data-calmes="-1" aria-label="Mes anterior"${im <= 0 ? ' disabled' : ''}>${I('back', 'width:15px;height:15px')}</button><button type="button" class="sbtn" data-calmes="1" aria-label="Mes siguiente"${im >= meses.length - 1 ? ' disabled' : ''}>${I('chev', 'width:15px;height:15px')}</button></span>` : ''}</div>${leyenda}`;
      h += `<div class="days mcal">${['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(x => `<span class="wd" aria-hidden="true">${x}</span>`).join('')}${'<span></span>'.repeat(off)}`;
      for (let n = 1; n <= nDias; n++) { const d = mes + '-' + pad(n); h += enMes.has(d) ? botonDia(d) : `<span class="nd" aria-hidden="true">${n}</span>`; }
      h += '</div>';
    } else {
      h += `<div class="month"><b>${cap(MES[md.getMonth()])}</b>${leyenda}</div>`;
      h += `<div class="days">${dias.map(botonDia).join('')}</div>`;
    }
    h += '</div><div class="pcw cder">';
    const ts = turnosDelDia(c, S.dia);
    const orden = ordenPuntos(c).filter(pid => ts.some(t => t.punto === pid));
    const filas = orden.map(pid => {
      const p = c.puntos[pid], items = ts.filter(t => t.punto === pid).map(t => {
        const oc = ocupDe(c.id, S.dia, t.id), n = cupoDe(c, t), vals = Object.values(oc), conf = vals.filter(v => v === 'c').length;
        const mio = S.yo && oc[S.yo], paso = yaEmpezo(S.dia, t), falta = paso || cargando || errCupos ? 0 : Math.max(0, n - vals.length);
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
        const txt = x.mio ? (x.mio === 'c' ? 'Tu turno' : 'Pedido') : x.paso ? 'Ya empezó' : cargando ? 'Cargando' : errCupos ? 'Sin datos' : x.falta <= 0 ? 'Completo' : x.falta === 1 ? '1 libre' : x.falta + ' libres';
        const seats = Array.from({ length: Math.max(x.n, x.conf + x.pend) }, (_, k) => `<i class="${k < x.conf ? 'c' : k < x.conf + x.pend ? 'p' : ''}"></i>`).join('');
        return `<button type="button" class="chip ${est}" ${x.mio ? `data-mio="${esc(x.t.id)}"` : `data-pedir="${esc(x.t.id)}"`}${!x.mio && x.falta <= 0 ? ' disabled' : ''}><b class="num">${esc(x.t.desde)}</b><span class="cs"><small>a ${esc(x.t.hasta)}</small>${seats}</span><em>${txt}</em></button>`;
      }).join('')}</div>`;
      h += '</div>';
    });
    if (filas.length && !vistos) h += '<div class="card"><div class="empty">Ese día ya no quedan lugares. Probá con otro día.</div></div>';
    $('app').innerHTML = h + '</div></div>';
    if (enlace && (S.ccOk || {})[c.id]) { enlace.hecho = true; setTimeout(() => { const oc = ocupDe(c.id, S.dia, enlace.tid); if (S.yo && oc[S.yo]) return; if (Object.keys(oc).length >= cupoDe(c, Object.assign({ id: enlace.tid }, c.turnos[enlace.tid]))) { toast('Ese turno ya se completó. Elegí otro horario.'); return; } pedir(enlace.tid); }, 0); }
  }
  function verLugar(cid, pid) {
    const c = S.campanas[cid], p = c && c.puntos && c.puntos[pid];
    if (!p) return;
    const tp = TIPOS[p.tipo] || TIPOS.otro, url = comoLlegarUrl(p, c);
    const dir = p.direccion || (p.lat != null ? `${p.lat}, ${p.lng}` : '');
    const fotos = (p.fotos || []).map(f => `<div${fotoAttr(cid, f)}></div>`).join('');
    const ovL = sheet(`${fotos ? `<div class="fotos">${fotos}</div>` : ''}<h3>${esc(p.nombre)}</h3><span class="sub">${esc(tp[1])} · ${cupoDe(c, { punto: pid })} por turno</span>
      ${mapaLugar(p, c)}
      <div class="dir">${I('pin')}<div><b>${esc(c.nombre)}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</b>${dir ? '<br>' + esc(dir) : ''}${p.detalle ? '<br>' + esc(p.detalle) : ''}</div></div>
      ${comodHTML(cid, pid)}
      ${url ? `<div class="lugar-acts"><a class="go" href="${esc(url)}" target="_blank" rel="noopener"${llegarAttr(cid, pid)}>${I('nav')}Cómo llegar</a>${dir ? `<button type="button" class="sbtn" data-copiar="${esc(dir)}">${I('copy')}Copiar dirección</button>` : ''}</div>` : ''}
      ${p.indicaciones ? `<div class="info"><b>Cómo encontrarlo</b>${esc(p.indicaciones)}</div>` : ''}
      ${p.retiro ? `<div class="info"><b>${retiroLabel(p)}</b>${esc(p.retiro)}</div>` : ''}
      <button type="button" class="btn alt" data-cerrar style="margin-top:14px">Cerrar</button>`);
    if (ovL.querySelector('#vlPubs') && !S.pubs) cargarPubs().then(() => { const el = ovL.querySelector('#vlPubs'); if (el) el.outerHTML = pubsCarritoHTML(c, pid); });
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
  const NOTA_ATAJOS = ['Puedo llevar el carrito', 'Es mi primera vez', 'Llego unos minutos tarde'];
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
    if (!S.yo) return;
    const pf = perfil(), p = c.puntos[t.punto];
    const congs = (S.publico.congregaciones || []).slice().sort((a, b) => a.localeCompare(b, 'es'));
    const opts = congs.map(x => `<option${x === pf.congregacion ? ' selected' : ''}>${esc(x)}</option>`).join('') + `<option value="__otra"${pf.congregacion && !congs.includes(pf.congregacion) ? ' selected' : ''}>Otra…</option>`;
    const libres = cupoDe(c, t) - Object.keys(ocupDe(c.id, S.dia, t.id)).length;
    const choca = Object.values(S.mis || {}).filter(m => m.fecha === S.dia && m.estado !== 'rechazado' && !(m.cid === c.id && m.tid === t.id) && minutos(m.desde) < minutos(t.hasta) && minutos(t.desde) < minutos(m.hasta));
    const avisoChoca = choca.length ? `<div class="aviso-mapa choca">${I('alert', 'width:16px;height:16px;flex-shrink:0;margin-top:2px')}<span><b>Se superpone con otro turno tuyo</b>${choca.map(m => `${esc(m.desde)} a ${esc(m.hasta)} · ${esc((((S.campanas[m.cid] || {}).puntos || {})[m.punto] || {}).nombre || '')}`).join('; ')}. Si igual querés este, después cancelá el otro desde Mis turnos.</span></div>` : '';
    const ov = sheet(`<h3>Confirmá tu turno</h3><p class="hint">Un coordinador lo revisa y te confirma.</p>${avisoChoca}
      <div class="sum"><div>${I('cal')}${esc(cap(fmtDia(S.dia)))}</div><div>${I('clock')}<span class="num">${esc(t.desde)} – ${esc(t.hasta)}</span><small>${libres === 1 ? 'Queda 1 lugar' : `Quedan ${libres} lugares`}</small></div><div>${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin')}${esc(p.nombre)} · ${esc(c.nombre)}</div></div>
      <div class="two"><div class="fld"><label for="pNom">Nombre</label><input id="pNom" autocomplete="given-name" value="${esc(pf.nombre || nombreYo().split(' ')[0] || '')}"></div>
      <div class="fld"><label for="pApe">Apellido</label><input id="pApe" autocomplete="family-name" value="${esc(pf.apellido || nombreYo().split(' ').slice(1).join(' ') || '')}"></div></div>
      <div class="fld"><label for="pCong">Congregación</label><select id="pCong">${congs.length ? '<option value="">Elegí tu congregación</option>' : ''}${opts}</select></div>
      <div class="fld${pf.congregacion && !congs.includes(pf.congregacion) ? '' : ' hidden'}" id="pOtraF"><label for="pOtra">¿Cuál?</label><input id="pOtra" value="${esc(pf.congregacion && !congs.includes(pf.congregacion) ? pf.congregacion : '')}" placeholder="Nombre de tu congregación y ciudad"></div>
      <div class="fld"><label for="pCel">Celular (WhatsApp)</label><input id="pCel" type="tel" autocomplete="tel" value="${esc(pf.celular || '')}" placeholder="343 555-0000"><small class="celok" id="pCelOk"></small></div>
      ${notaCampo('')}
      <label class="ck comp-ck"><input type="checkbox" id="pComp"${pf.compartir ? ' checked' : ''}> <span><b>Que mis compañeros de turno vean mi nombre</b><small>Solo los que van en este mismo horario y lugar, cuando el coordinador confirme. Nunca tu celular.</small></span></label>
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
      const compartir = q('#pComp').checked, fecha = S.dia;
      guardarPerfil({ nombre, apellido, congregacion, celular, acepto: true, compartir });
      const b = q('#pGo'); b.disabled = true; b.textContent = 'Enviando…';
      // Antes de mandar: ¿este celular sigue siendo el del hermano? (si su link se usó en otro navegador, acá ya no vale)
      if (S.esHermano && !(await revisarSesion())) { ov.remove(); toast('Tu acceso se cerró en este celular. Tocá tu link de WhatsApp para volver a entrar.'); registrarError('aviso', 'Pedir turno: acceso cerrado en este celular'); return; }
      try {
        await conTiempo(enviarPedido(c, t, fecha, { nombre, apellido, congregacion, celular, nota }));
        ov.remove();
        if (compartir) compartirNombre(c.id, fecha, t.id, true, { nombre, apellido, congregacion });
        const pid = cupoId(c.id, S.dia, t.id) + '__' + S.yo;
        sheet(`<div class="ok-big"><div class="o">${I('check', 'width:30px;height:30px;stroke-width:2.6')}</div><h3>¡Listo! Te anotaste</h3><p>${esc(cap(fmtDia(S.dia)))} · ${esc(t.desde)} a ${esc(t.hasta)} · ${esc(p.nombre)}</p><p><span class="tag pendiente">Esperando confirmación</span><br>Cuando un coordinador lo confirme lo vas a ver en el inicio y en Mis turnos.</p></div><div class="okacts"><button type="button" class="sbtn" data-ics="${esc(pid)}">${I('cal', 'width:16px;height:16px')}Agendar</button><button type="button" class="sbtn" data-comp="${esc(pid)}">${I('share', 'width:16px;height:16px')}Compartir</button><button type="button" class="sbtn" data-invitar="${esc(pid)}">${I('chat', 'width:16px;height:16px')}Invitar</button></div><button type="button" class="btn" data-go="#/t/${esc(pid)}" data-cerrar>Ver mi turno</button><button type="button" class="btn alt" data-cerrar>Listo</button>`);
      } catch (e) {
        if (e && e.code === 'sin-respuesta') { ov.remove(); sheet(`<h3>Todavía no hay respuesta</h3><p class="hint">Parece que hay poca señal. Tu pedido queda guardado en este celular y se manda solo cuando vuelva la conexión.</p><p class="hint">Fijate en <b>Mis turnos</b> en un rato: si aparece "Esperando confirmación", llegó bien.</p><button type="button" class="btn" data-cerrar>Entendido</button>`); return; }
        console.error(e); b.disabled = false; b.textContent = 'Anotarme en este turno';
        const negado = /permission|insufficient/i.test(e && (e.code || e.message) || '');
        if (negado && S.esHermano && !(await revisarSesion())) { ov.remove(); toast('Tu acceso se cerró en este celular. Tocá tu link de WhatsApp para volver a entrar.'); registrarError('aviso', 'Pedir turno: acceso cerrado en este celular'); return; }
        const lleno = Object.keys(ocupDe(c.id, S.dia, t.id)).length >= cupoDe(c, t);
        registrarError('aviso', 'Pedir turno: ' + ((e && (e.code || e.message)) || e) + (lleno ? ' (turno completo)' : ''));
        err(negado && lleno ? 'Ese turno se acaba de completar. Elegí otro.' : negado ? 'No se pudo anotar en este turno. Probá de nuevo; si vuelve a pasar, avisale al coordinador.' : 'No se pudo enviar. Revisá la conexión y probá de nuevo.');
      }
    });
  }
  // Sin señal, Firebase guarda el envío y lo manda solo cuando vuelve la conexión: no esperamos para siempre
  const SIN_RESPUESTA = 15000;
  const conTiempo = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('sin respuesta'), { code: 'sin-respuesta' })), SIN_RESPUESTA))]);
  async function enviarPedido(c, t, fecha, datos) {
    const yo = S.yo, id = cupoId(c.id, fecha, t.id);
    const batch = S.db.batch();
    batch.set(S.db.doc('cupos/' + id), { cid: c.id, fecha, tid: t.id, ocupados: { [yo]: 'p' } }, { merge: true });
    batch.set(S.db.doc('pedidos/' + id + '__' + yo), {
      cid: c.id, fecha, tid: t.id, punto: t.punto, desde: t.desde, hasta: t.hasta, uid: yo, ...(S.esHermano ? {} : { email: S.user.email.toLowerCase() }),
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
      batch.set(S.db.collection('auditoria').doc(Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), { cid: p.cid, tipo: 'cancelo', texto: ('canceló su turno: ' + pTxt(c, p)).slice(0, 400), por: S.esHermano ? 'link' : S.user.email.toLowerCase(), uid: S.yo, at: S.ahora(), ref: pid });
      const cid0 = cupoId(p.cid, p.fecha, p.tid), compartido = perfil().compartir || !!((S.comp[cid0] || {}).n || {})[S.yo];
      try { await conTiempo(batch.commit()); ov.remove(); toast('Turno cancelado'); if (compartido) compartirNombre(p.cid, p.fecha, p.tid, false); if (S.route.name === 'turno') go('#/mis'); }
      catch (e) { if (e && e.code === 'sin-respuesta') { ov.remove(); toast('Hay poca señal: la cancelación se manda sola cuando vuelva la conexión.'); return; } console.error(e); b.disabled = false; b.textContent = 'Sí, cancelar el turno'; toast('No se pudo cancelar. Probá de nuevo.'); }
    });
  }
  S.del = () => (window.__ppamMock ? window.__ppamMock.del() : firebase.firestore.FieldValue.delete());
  S.ahora = () => (window.__ppamMock ? new Date().toISOString() : firebase.firestore.FieldValue.serverTimestamp());
  const fTxt = (f) => { const x = parseIso(f); return `${DOW[x.getDay()]} ${x.getDate()}/${x.getMonth() + 1}`; };
  const pTxt = (c, p) => `${p.nombre} ${p.apellido} · ${fTxt(p.fecha)} ${fmtHora(p.desde)}–${fmtHora(p.hasta)} · ${((c.puntos || {})[p.punto] || {}).nombre || ''}`;

  /* ---------- Mis turnos ---------- */
  function renderMis() {
    if (!S.yo) return renderCerrado();
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
    const grupo = (ps, modo) => '<div class="pcw tcs">' + ps.map(p => misCard(p, modo)).join('') + '</div>';
    if (deHoy.length) h += '<div class="lbl">Hoy</div>' + grupo(deHoy, 'hoy');
    if (prox.length) h += `<div class="lbl sp">Próximos <span>${prox.length}</span></div>` + grupo(prox, '');
    if (!deHoy.length && !prox.length) h += '<div class="welcome"><h4>No tenés turnos por delante</h4><p>Elegí una campaña y anotate en un horario libre.</p><button type="button" class="btn p" data-go="#/">Ver campañas</button></div>';
    if (pas.length) {
      const hechosMes = pas.filter(p => p.estado === 'confirmado' && p.fecha.slice(0, 7) === mes).length;
      h += `<div class="lbl sp">Realizados <span>${esc(cap(MES[parseIso(pas[0].fecha).getMonth()]))}</span></div>` + grupo(pas.slice(0, 20), 'done');
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
    const chip = done ? (conf ? `<span class="est dn">${I('check')}Hecho</span>` : `<span class="est dn">${rech ? 'No confirmado' : 'Sin confirmar'}</span>`)
      : `<span class="est ${conf ? 'ok' : rech ? 'rj' : 'pe'}"><i></i>${esc(ESTADOS[p.estado] || p.estado)}</span>`;
    let acts = '';
    if (url) acts += `<a class="go" href="${esc(url)}" target="_blank" rel="noopener"${llegarAttr(p.cid, p.punto)}>${I('nav')}Cómo llegar</a>`;
    acts += `<button type="button" class="sbtn" data-go="#/t/${esc(p.id)}">Detalle</button>`;
    if (!done && !rech) acts += `<button type="button" class="sbtn bad" data-cancelar="${esc(p.id)}">Cancelar</button>`;
    return `<div class="tc ${modo}"><div class="tcl"><div class="cal ${done ? 'd' : conf ? '' : 'p'}"><small>${DOW[d.getDay()]}</small><b class="num">${d.getDate()}</b><i>${MES[d.getMonth()].slice(0, 3)}</i></div>${foto ? `<div class="thumb"${fotoAttr(p.cid, foto)}></div>` : ''}</div><div class="bd">${modo === 'hoy' ? `<span class="hoyb">${I('clock')}${esc(cuandoTexto(p).replace(/^Hoy · /, ''))}</span>` : ''}<div class="h num">${esc(p.desde)} – ${esc(p.hasta)}</div><div class="m">${I(pt.tipo === 'carrito' ? 'cart' : pt.tipo === 'stand' ? 'stand' : 'pin')}<span>${esc([c.nombre, pt.nombre, c.ciudad].filter(Boolean).join(' · '))}</span></div><div class="st1">${chip}</div></div><div class="acts3">${acts}</div></div>`;
  }
  function renderTurno() {
    if (!S.yo) return renderCerrado();
    const pid = S.route.pid, p = S.mis[pid] && Object.assign({ id: pid }, S.mis[pid]);
    if (!p) { $('app').innerHTML = '<div class="card"><div class="empty">Ese turno ya no está en tu lista.</div></div><button type="button" class="btn" data-go="#/mis">Ver mis turnos</button>'; return; }
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, conf = p.estado === 'confirmado', rech = p.estado === 'rechazado';
    const url = rech ? '' : comoLlegarUrl(pt, c), d = parseIso(p.fecha), pasado = p.fecha < hoy();
    listenCC(p.cid);   // para saber quiénes están confirmados en el turno (compañeros)
    const conClima = !rech && pt.lat != null && p.fecha >= hoy() && p.fecha <= addDays(hoy(), 6);
    const climaK = conClima ? S.clima[`${(+pt.lat).toFixed(2)},${(+pt.lng).toFixed(2)},${p.fecha},${p.desde},${p.hasta}`] : null;
    let h = '<div class="pcw tur">';
    h += pt.lat != null ? mapaLugar(pt, c, 'big')
      : `<div class="mapa big foto"${fotoAttr(p.cid, (pt.fotos || [])[0], `background-image:${colorDe(c.id ? c : { id: p.cid })};`)}></div>`;
    h += `<div class="det"><div class="st ${esc(p.estado)}"><i></i>${conf ? 'Confirmado por un coordinador' : rech ? 'No fue confirmado' : 'Esperando confirmación'}${!conf && !rech ? ' <a class="qhelp" href="#/ayuda/espera">¿Qué significa?</a>' : ''}</div>`;
    h += `<h2>${esc(cap(DOW_L[d.getDay()]))} ${d.getDate()} de ${MES[d.getMonth()]} · <span class="num">${esc(p.desde)} a ${esc(p.hasta)}</span></h2>`;
    h += `<div class="m">${esc([c.nombre, pt.nombre, pt.direccion].filter(Boolean).join(' · '))}</div>`;
    if (!conf && !rech && !pasado) h += `<p class="espera">${I('clock', 'width:15px;height:15px;flex-shrink:0;margin-top:2px')}<span>Un coordinador lo revisa y te confirma. Si falta poco para el turno y todavía no te confirmaron, avisale al coordinador de tu congregación.</span></p>`;
    if (!rech) h += `<div class="tl"><span class="ok"><span class="dot">${I('check')}</span>Pedido</span><span class="ln on"></span><span class="${conf ? 'ok' : ''}"><span class="dot">${conf ? I('check') : ''}</span>Confirmado</span><span class="ln${pasado ? ' on' : ''}"></span><span class="${pasado ? 'ok' : ''}"><span class="dot">${pasado ? I('check') : ''}</span>El día</span></div>`;
    if (conClima && !(climaK && !climaK.v)) h += `<div class="clima" id="clima" aria-live="polite">${climaK && climaK.v ? climaHTML(p, climaK.v) : ''}</div>`;
    h += entregaHTML(p);
    if (conMant(c) && !conPubs(c) && conf && (p.fecha === hoy() || p.fecha === addDays(hoy(), -1))) h += `<button type="button" class="linkish probl" data-probesc="${esc(p.id)}">${I('alert', 'width:14px;height:14px')}Informar un problema del carrito</button>`;
    h += '<div class="grid4">';
    h += url ? `<a class="pr" href="${esc(url)}" target="_blank" rel="noopener"${llegarAttr(p.cid, p.punto)}>${I('nav')}Llegar</a>` : `<button type="button" disabled>${I('nav')}Llegar</button>`;
    h += `<button type="button" data-ics="${esc(p.id)}">${I('cal')}Agendar</button><button type="button" data-comp="${esc(p.id)}">${I('share')}Compartir</button>`;
    h += !rech && !pasado ? `<button type="button" data-cancelar="${esc(p.id)}">${I('x')}Cancelar</button>` : `<button type="button" disabled>${I('x')}Cancelar</button>`;
    h += '</div>';
    if (conf && !pasado) { const ck = S.comp[cupoId(p.cid, p.fecha, p.tid)]; if (!(ck && ck.err)) h += `<div class="comp" id="comp">${ck ? compHTML(p, ck.n) : ''}</div>`; }
    if (!rech && !pasado) h += `<button type="button" class="btn alt inv" data-invitar="${esc(p.id)}">${I('chat')}Invitar a alguien a este turno</button>`;
    if (!rech && !pasado && c.contacto) h += `<a class="btn avisar" href="${esc(waLink(c.contacto, `Hola, soy ${p.nombre} ${p.apellido}${p.congregacion ? ' (' + p.congregacion + ')' : ''}. No voy a poder ir a mi turno del ${fmtDia(p.fecha)} de ${p.desde} a ${p.hasta} en ${pt.nombre || ''} (${c.nombre || ''}).`))}" target="_blank" rel="noopener">${I('chat')}Avisar al coordinador que no puedo ir</a>`;
    if (!rech && !pasado) h += `<div class="info nota-info"><b>Nota para el coordinador</b><p>${p.nota ? esc(p.nota) : '<span class="faint">Sin nota.</span>'}</p><button type="button" class="sbtn" data-nota="${esc(p.id)}">${I('edit', 'width:15px;height:15px')}${p.nota ? 'Cambiar' : 'Agregar una nota'}</button></div>`;
    else if (p.nota) h += `<div class="info"><b>Nota para el coordinador</b><p>${esc(p.nota)}</p></div>`;
    if (pt.indicaciones) h += `<div class="info"><b>Cómo encontrarlo</b><p>${esc(pt.indicaciones)}</p></div>`;
    if (pt.retiro) h += `<div class="info"><b>${esc(retiroLabel(pt))}</b><p>${esc(pt.retiro)}</p></div>`;
    if (tieneLugar(pt)) h += `<button type="button" class="btn alt" data-lugar="${esc(p.cid)}|${esc(p.punto)}">${I('pin')}Ver fotos y datos del lugar</button>`;
    h += '</div></div>';
    $('app').innerHTML = h;
    if (conClima && !climaK) climaTurno(p, pt).then(v => { const el = $('clima'); if (!el || S.route.pid !== pid) return; if (v) el.innerHTML = climaHTML(p, v); else el.remove(); });
    if ($('comp')) cargarComp(p);
    if (conPubs(c) && conf && !S.ent[cupoId(p.cid, p.fecha, p.tid)] && $('entr')) Promise.all([cargarEnt(p), cargarPubs()]).then(() => { if (S.route.pid === pid) renderTurno(); });
    else if (conPubs(c) && conf && !S.pubs) cargarPubs().then(() => { if (S.route.pid === pid) renderTurno(); });
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

  /* ---------- Lupa para hermanos: lugares, días y horarios con lugar (nunca personas) ---------- */
  function campsPub() { return Object.values(S.campanas).filter(c => c.activa !== false && (!c.hasta || c.hasta >= hoy())); }
  function pubFila(c, d, t) {
    const p = (c.puntos || {})[t.punto] || {}, oc = ocupDe(c.id, d, t.id), n = cupoDe(c, t), falta = Math.max(0, n - Object.keys(oc).length), mio = S.yo && oc[S.yo], x = parseIso(d);
    return `<button type="button" class="bsr" data-bpedir="${esc(c.id)}|${d}|${esc(t.id)}"${!mio && !falta ? ' disabled' : ''}><span class="f"><small>${DOW[x.getDay()]}</small><b class="num">${x.getDate()}</b><small>${MES[x.getMonth()].slice(0, 3)}</small></span><span class="tx"><b class="num">${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} · ${esc(p.nombre || '')}</b><small>${esc(c.nombre)}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</small></span><span class="st ${mio ? 'ok' : falta ? 'lib' : ''}">${mio ? 'Tu turno' : falta ? (falta === 1 ? 'Queda 1' : 'Quedan ' + falta) : 'Completo'}</span></button>`;
  }
  const libre = (c, d, t) => { if (yaEmpezo(d, t)) return false; const oc = ocupDe(c.id, d, t.id); return Object.keys(oc).length < cupoDe(c, t) && !(S.yo && oc[S.yo]); };
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
      if (d.bpedir) { e.stopPropagation(); busGuardar(inp.value); const [cid, f, tid] = d.bpedir.split('|'); cerrar(); const c = S.campanas[cid]; if (c && S.yo && ocupDe(cid, f, tid)[S.yo]) { go('#/mis'); return; } irAPedir(cid, f, tid); return; }
      if (d.go) { busGuardar(inp.value); cerrar(); }
    });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
  }
  /* ---------- Buscador de coordinación (lupa arriba): hermanos, campañas, puntos y turnos de las campañas que coordina ---------- */
  S.bus = { t: 0, peds: {}, cupos: {}, cargando: null };
  function busRecientes() { try { return JSON.parse(localStorage.getItem('ppam-bus-rec') || '[]'); } catch (e) { return []; } }
  function busGuardar(q) { q = q.trim(); if (q.length < 2) return; try { localStorage.setItem('ppam-bus-rec', JSON.stringify([q].concat(busRecientes().filter(x => x !== q)).slice(0, 5))); } catch (e) {} }
  // La lupa: los publicadores usan la pública; la de coordinadores está en coord.js
  function abrirBuscador() { if (!(S.isAdmin || S.coordDe.length)) { abrirBuscadorPub(); return; } abrirBuscadorCoord(); }
   // evita el doble toque: la misma acción no se manda dos veces mientras se guarda
  function compartir(texto) {
    const url = 'https://wa.me/?text=' + encodeURIComponent(texto);
    window.open(url, '_blank', 'noopener');
  }
  function linkCampana(c) { return location.origin + location.pathname + '#/c/' + c.id; }

  const uidGen = () => Math.random().toString(36).slice(2, 9);
  /* ---------- Mapa para marcar un punto (Leaflet + OpenStreetMap; buscador y direcciones: Nominatim) ---------- */
  const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
   // Entre Ríos (Paraná al centro)
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
  S.geoCiudad = {};



  /* ---------- Privacidad ---------- */
  function privacidad() {
    sheet(`<h3>Cómo se usan tus datos</h3><div class="hint" style="font-size:13.5px;line-height:1.55;">
      <p>Para pedir un turno te pedimos <b>nombre, apellido, congregación y celular</b>. Los ven <b>solo los coordinadores de esa campaña</b> (y los administradores), para organizar los turnos y avisarte si hay un cambio.</p>
      <p>Los demás hermanos solo ven cuántos lugares quedan en cada turno, no quién los ocupa. Si vos lo elegís, tus compañeros confirmados de ese mismo turno ven tu nombre, apellido y congregación (nunca tu celular); lo podés quitar cuando quieras y se borra cuando pasa el turno. Sin estar habilitado no se ve nada.</p>
      <p>No se usan para nada más ni se comparten con nadie. Podés cancelar tu turno cuando quieras desde "Mis turnos", y así se borran tus datos de ese turno.</p>
      <p>Entrás con tu link personal, que te mandó el responsable de tu congregación: así nadie puede pedir turnos a tu nombre. Tus datos los cargó él cuando el comité de servicio te aprobó.</p>
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
      <div class="rp-tec"><b>Pantalla:</b> ${esc(pantallaLabel(pantallaActual()))}<br><b>Celular:</b> ${esc(dispositivo())}<br><b>Versión:</b> ${VERSION}${ult ? ` · <b>Último error:</b> "${esc(ult.msg.slice(0, 80))}"` : ''}${S.yo ? `<br><b>Tu cuenta:</b> ${esc(S.esHermano ? nombreYo() : S.user.email)}` : ''}</div>
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
      if (S.yo) { d.uid = S.yo; if (!S.esHermano) d.email = S.user.email.toLowerCase(); const n = [pf.nombre, pf.apellido].filter(Boolean).join(' ') || nombreYo(); if (n) d.nombre = n.slice(0, 80); }
      const b = q('#rpGo'); b.disabled = true; b.textContent = 'Enviando…';
      try { await S.db.collection('reportes').doc(Date.now().toString(36) + uidGen()).set(d); ov.remove(); toast('¡Gracias! Lo recibió el equipo de soporte.'); }
      catch (e) { console.error(e); b.disabled = false; b.textContent = 'Enviar reporte'; err('No se pudo enviar. Revisá la conexión y probá de nuevo.'); }
    });
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
  const sinTilde = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const COL_MAPA = { ok: '#1F7A55', poco: '#B8924A', full: '#8A939C' };
  function estadoCamp(c) {
    const dias = diasDe(c); if (!dias.length) return { est: 'full', faltan: 0, txt: 'Sin turnos por delante' };
    const k = cobertura(c, dias.filter(d => d <= addDays(dias[0], 6)));
    const est = k.faltan <= 0 ? 'full' : (k.faltan <= 3 || k.ocup / Math.max(1, k.total) >= .75) ? 'poco' : 'ok';
    const cuando = dias[0] <= addDays(hoy(), 6) ? 'esta semana' : 'la primera semana';
    return { est, faltan: k.faltan, txt: k.faltan > 0 ? `${k.faltan === 1 ? '1 lugar libre' : k.faltan + ' lugares libres'} ${cuando}` : `Completo ${cuando}` };
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
    const r = $('mapw') && $('mapw').getBoundingClientRect(), tb = PC() ? 0 : ($('tabbar') && $('tabbar').offsetHeight) || 0;
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
  const CLAVES = ['dia', 'cdia', 'cf', 'cdf', 'aj', 'hf', 'tab', 'vista', 'plegar', 'sem', 'bsat', 'calmes', 'ayg'];
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = CLAVES.find(x => b.dataset[x] !== undefined); if (!k) return;
    const sel = `[data-${k}="${CSS.escape(b.dataset[k])}"]`;
    setTimeout(() => { if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected) return; const n = document.querySelector(sel); if (n) n.focus({ preventScroll: true }); }, 0);
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a[data-go]'); if (!t) return;
    const ds = t.dataset;
    if (t.id === 'backBtn') { const r = S.route; go((r.name === 'coord' && r.cid) || r.name === 'admin' || r.name === 'soporte' || r.name === 'hermanos' ? '#/coord' : r.name === 'turno' ? '#/mis' : '#/'); return; }
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
      if (S.acceso !== 'si' && S.acceso !== 'nocoord') { login(); return; }
      const sub = S.esHermano ? (S.hermano.congregacion || '') : S.user.email;
      const ov = sheet(`<div class="acct"><span class="av big">${esc(iniciales(nombreYo()))}</span><div><h3>${esc(nombreYo() || 'Mi cuenta')}</h3><p class="hint">${esc(sub)}</p></div></div>${S.acceso === 'si' ? '<button type="button" class="btn" id="uMis">Mis turnos</button>' : ''}${S.acceso === 'si' && S.yo ? `<label class="ck comp-ck"><input type="checkbox" id="uComp"${perfil().compartir ? ' checked' : ''}> <span><b>Mostrar mi nombre a mis compañeros de turno</b><small>Queda marcado para los próximos turnos que pidas. En cada turno lo podés cambiar desde su detalle.</small></span></label>` : ''}${puedeInstalar() ? '<button type="button" class="btn alt" id="uInst">Instalar la app</button>' : ''}<button type="button" class="btn alt" id="uOut">${S.esHermano ? 'Salir de este celular' : 'Cerrar sesión'}</button><button type="button" class="linkish ubor" id="uBor">Borrar mis datos de este celular</button>`);
      if (ov.querySelector('#uInst')) ov.querySelector('#uInst').addEventListener('click', () => { ov.remove(); instalar(); });
      if (ov.querySelector('#uMis')) ov.querySelector('#uMis').addEventListener('click', () => { ov.remove(); go('#/mis'); });
      if (ov.querySelector('#uComp')) ov.querySelector('#uComp').addEventListener('change', (e) => { guardarPerfil(Object.assign(perfil(), { compartir: e.target.checked })); toast(e.target.checked ? 'Listo: en tus próximos turnos se va a ver tu nombre' : 'Listo: en tus próximos turnos no se va a ver tu nombre'); });
      ov.querySelector('#uOut').addEventListener('click', async () => { if (S.esHermano && !confirm('Para volver a entrar en este celular vas a necesitar tu link de WhatsApp. ¿Salir?')) return; ov.remove(); await cerrarSesion(); });
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
    if (ds.contar || ds.corregir) { const p = S.mis[ds.contar || ds.corregir] && Object.assign({ id: ds.contar || ds.corregir }, S.mis[ds.contar || ds.corregir]); if (!p) return; const id = cupoId(p.cid, p.fecha, p.tid); if (ds.corregir && S.ent[id] && S.ent[id].d) { contar(p, S.ent[id].d.k, S.ent[id].d.modo || 'qr'); return; } contarTurno(p); return; }
    if (ds.probesc) { const p = S.mis[ds.probesc]; if (!p) return; const c = S.campanas[p.cid]; escanear(c, (kid) => informarProblema(c, kid, cupoId(p.cid, p.fecha, p.tid))); return; }
    if (ds.probk) { const p = S.mis[ds.probk], id = p && cupoId(p.cid, p.fecha, p.tid), e = id && S.ent[id] && S.ent[id].d; if (e) informarProblema(S.campanas[p.cid], e.k, id); return; }
    if (ds.comod) { const [cid, pid, k] = ds.comod.split('|'); verComod(cid, pid, k); return; }
    if (ds.compartir) { const [pid, si] = ds.compartir.split('|'), p = S.mis[pid]; if (!p) return; t.disabled = true; compartirNombre(p.cid, p.fecha, p.tid, si === '1', p).then(ok => { if (!ok) toast('No se pudo cambiar. Probá de nuevo.'); else toast(si === '1' ? 'Tus compañeros de este turno ven tu nombre' : 'Listo: tu nombre ya no se muestra'); render(); }); return; }
    if (ds.calmes) { const c = S.campanas[S.route.cid]; if (!c) return; const dias = diasDe(c).filter(d => turnosDelDia(c, d).some(t => !yaEmpezo(d, t))), meses = [...new Set(dias.map(d => d.slice(0, 7)))], m = meses[meses.indexOf(S.dia.slice(0, 7)) + (+ds.calmes)]; if (m) { S.dia = dias.find(d => d.slice(0, 7) === m); renderCamp(); } return; }
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
  /* ---------- Coordinación, administración y soporte: se cargan aparte (coord.js) solo cuando hacen falta ---------- */
  let coordMod = null, coordCargando = null;
  function cargarCoord() {
    if (coordMod) return Promise.resolve(coordMod);
    if (!coordCargando) coordCargando = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = './coord.js?v=' + VERSION;
      sc.onload = () => { try { coordMod = window.PPAM_COORD({ DOW, parseIso, I, esc, fmtDia, fmtHora, cap, S, ESTADOS, refrescar, $, MES, hoy, go, campRango, colorDe, fotoAttr, diasDe, turnosDelDia, cupoId, cupoDe, isoOf, yaEmpezo, iniciales, sinTilde, modal, busRecientes, busGuardar, sheet, NOTA_MAX, normCel, CEL_ERR, bindCel, toast, fTxt, uidGen, comoLlegarUrl, copiar, minutos, pad, addDays, registrarError, TIPOS, pTxt, linkCampana, fotoKey, render, cargarLeaflet, retiroLabel, VERSION, pantallaLabel, COMOD, metros, distTxt, KCOLORES, TIPOS_PUB, colorHex, kNombre, kNum, conPubs, cargarPubs, pubNombre, pubSub, tapaHTML, resumenItems, conMant, PROB_TIPOS }); res(coordMod); } catch (e) { rej(e); } };
      sc.onerror = () => { coordCargando = null; rej(new Error('coord.js')); };
      document.head.appendChild(sc);
    });
    return coordCargando;
  }
  // Llama a una función de coord.js (si todavía no se cargó, la carga primero)
  function enCoord(n, args) {
    if (coordMod) return coordMod[n](...args);
    if (['renderCoord', 'renderAdmin', 'renderSoporte', 'renderHermanos'].includes(n)) $('app').innerHTML = '<div class="empty">Cargando…</div>';
    cargarCoord().then(mm => mm[n](...args)).catch((e) => { console.error(e); toast('No se pudo cargar esta parte. Revisá la conexión y probá de nuevo.'); });
  }
  function renderCoord(...a) { return enCoord('renderCoord', a); }
  function fichaCarrito(...a) { return enCoord('fichaCarrito', a); }
  function renderHermanos(...a) { return enCoord('renderHermanos', a); }
  function renderAdmin(...a) { return enCoord('renderAdmin', a); }
  function renderSoporte(...a) { return enCoord('renderSoporte', a); }
  function anotarHermano(...a) { return enCoord('anotarHermano', a); }
  function restaurar(...a) { return enCoord('restaurar', a); }
  function abrirHistorialGeneral(...a) { return enCoord('abrirHistorialGeneral', a); }
  function cambiarEstado(...a) { return enCoord('cambiarEstado', a); }
  function textoVoluntarios(...a) { return enCoord('textoVoluntarios', a); }
  function textoDia(...a) { return enCoord('textoDia', a); }
  function copiarHorarios(...a) { return enCoord('copiarHorarios', a); }
  function editarPunto(...a) { return enCoord('editarPunto', a); }
  function editarTurno(...a) { return enCoord('editarTurno', a); }
  function nuevaCampana(...a) { return enCoord('nuevaCampana', a); }
  function editarCoordinadores(...a) { return enCoord('editarCoordinadores', a); }
  function cambiarReporte(...a) { return enCoord('cambiarReporte', a); }
  function abrirBuscadorCoord(...a) { return enCoord('abrirBuscadorCoord', a); }

  // Si hay clave de App Check, primero se carga su parte del SDK (si falla la carga, la app sigue igual)
  (function arrancar() {
    const k = window.PPAM_FIREBASE && window.PPAM_FIREBASE.appCheckKey;
    if (!k || window.__ppamMock || !window.firebase) return init();
    const sc = document.createElement('script'); sc.src = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-check-compat.js';
    sc.onload = sc.onerror = () => init(); document.head.appendChild(sc);
  })();
})();
