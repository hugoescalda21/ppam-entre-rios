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
  const VERSION = '17';
  window.__ppam = S;   // para las pruebas

  function toast(msg) { if (/^No se pudo/.test(msg)) registrarError('aviso', msg); const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
  function perfil() { try { return JSON.parse(localStorage.getItem('ppam-perfil') || '{}'); } catch (e) { return {}; } }
  function guardarPerfil(p) { try { localStorage.setItem('ppam-perfil', JSON.stringify(p)); } catch (e) { /* nada */ } }

  /* ---------- Firebase ---------- */
  function init() {
    if (window.__ppamMock) { S.db = window.__ppamMock.db; S.auth = window.__ppamMock.auth; }
    else {
      if (!window.PPAM_FIREBASE || !window.PPAM_FIREBASE.apiKey) { $('app').innerHTML = '<div class="empty">Falta configurar Firebase (firebase-config.js).</div>'; return; }
      firebase.initializeApp(window.PPAM_FIREBASE);
      S.db = firebase.firestore(); S.auth = firebase.auth();
    }
    S.db.collection('campanas').onSnapshot((qs) => {
      const o = {}; qs.forEach(d => { o[d.id] = Object.assign({ id: d.id }, d.data()); }); S.campanas = o; S.loaded = true; render();
    }, (e) => { console.error(e); $('app').innerHTML = '<div class="empty">No se pudieron cargar las campañas. Revisá la conexión.</div>'; });
    S.db.doc('config/publico').onSnapshot((d) => { S.publico = Object.assign({ congregaciones: [], ciudades: [] }, d.exists ? d.data() : {}); if (S.route.name === 'admin' || (S.route.name === 'home' && S.loaded)) render(); }, () => {});
    S.auth.onAuthStateChanged(onUser);
    setInterval(() => { if (S.route.name === 'home') renderHome(); }, 60000);
    window.addEventListener('hashchange', () => { readRoute(); render(); });
    readRoute();
  }
  async function onUser(u) {
    S.user = u || null; S.isAdmin = false; S.coordDe = []; S.isSoporte = false;
    S.sop.unsub.forEach(f => f()); S.sop.unsub = []; S.sop.on = false; S.sop.okR = S.sop.okE = false; S.sop.reportes = {}; S.sop.errores = {};
    if (S.misUnsub) { S.misUnsub(); S.misUnsub = null; } S.mis = {};
    if (u) {
      S.misUnsub = S.db.collection('pedidos').where('uid', '==', u.uid).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.mis = o; render(); }, () => {});
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
      if (e && /popup/.test(e.code || '')) { await S.auth.signInWithRedirect(prov); return; }
      if (e && e.code !== 'auth/cancelled-popup-request') toast('No se pudo iniciar sesión. Probá de nuevo.');
    }
  }

  /* ---------- Rutas: #/ · #/c/{cid} · #/t/{pedido} · #/mis · #/coord/{cid} · #/admin ---------- */
  function readRoute() {
    const h = (location.hash || '#/').slice(1).split('/').filter(Boolean);
    if (h[0] === 'c' && h[1]) S.route = { name: 'camp', cid: h[1] };
    else if (h[0] === 't' && h[1]) S.route = { name: 'turno', pid: decodeURIComponent(h[1]) };
    else if (h[0] === 'mis') S.route = { name: 'mis' };
    else if (h[0] === 'coord') S.route = { name: 'coord', cid: h[1] || null };
    else if (h[0] === 'admin') S.route = { name: 'admin' };
    else if (h[0] === 'soporte') S.route = { name: 'soporte' };
    else S.route = { name: 'home' };
    window.scrollTo(0, 0);
  }
  const go = (h) => { if (location.hash === h) { readRoute(); render(); } else location.hash = h; };

  function renderTop() {
    const r = S.route, c = r.cid && S.campanas[r.cid];
    document.body.className = 'r-' + r.name;
    const esCoord = !!(S.user && (S.isAdmin || S.coordDe.length || S.isSoporte));
    const atras = r.name === 'camp' || r.name === 'turno' || r.name === 'admin' || (r.name === 'soporte' && (S.isAdmin || S.coordDe.length)) || (r.name === 'coord' && r.cid && (S.isAdmin || S.coordDe.length > 1));
    $('backBtn').classList.toggle('hidden', !atras);
    $('brand').classList.toggle('hidden', r.name !== 'home');
    $('shareBtn').classList.toggle('hidden', r.name !== 'camp' || !c);
    const ub = $('userBtn');
    ub.className = S.user ? 'av' : 'login';
    ub.textContent = S.user ? iniciales(S.user.displayName || S.user.email) : 'Ingresar';
    ub.setAttribute('aria-label', S.user ? 'Mi cuenta' : 'Ingresar');
    $('coordBtn').classList.toggle('hidden', !esCoord);
    [['tabHome', ['home', 'camp']], ['tabMis', ['mis', 'turno']], ['coordBtn', ['coord', 'admin', 'soporte']]].forEach(([id, rs]) => $(id).classList.toggle('on', rs.includes(r.name)));
    let k = '', t = '', s = '';
    if (r.name === 'camp' && c) { k = c.ciudad || ''; t = c.nombre; s = campRango(c); }
    else if (r.name === 'mis') { t = 'Mis turnos'; s = 'Tus turnos, su estado y cómo llegar.'; }
    else if (r.name === 'turno') { t = 'Tu turno'; }
    else if (r.name === 'coord') { k = 'Coordinación'; t = c ? c.nombre : 'Tus campañas'; s = c ? (c.ciudad || '') + ' · ' + campRango(c) : ''; }
    else if (r.name === 'admin') { k = 'Administración'; t = 'Campañas y equipo'; }
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
    return `Del ${a.getDate()} de ${MES[a.getMonth()]} al ${b.getDate()} de ${MES[b.getMonth()]}${c.lugar ? ' · ' + c.lugar : ''}`;
  }
  function rangoCorto(c) {
    if (!c.desde || !c.hasta) return '';
    const a = parseIso(c.desde), b = parseIso(c.hasta), m = (d) => MES[d.getMonth()].slice(0, 3);
    return a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} ${m(b)}` : `${a.getDate()} ${m(a)} al ${b.getDate()} ${m(b)}`;
  }
  function colorDe(c) { const ids = Object.keys(S.campanas).sort(); return COLORES[Math.max(0, ids.indexOf(c.id)) % COLORES.length]; }

  /* ---------- Fotos: se guardan achicadas en fotos/{cid}__{id} y se piden una sola vez ---------- */
  const fotoKey = (cid, fid) => cid + '__' + fid;
  function pedirFoto(k) {
    if (k in S.fotos) return;
    S.fotos[k] = '';
    S.db.doc('fotos/' + k).get().then((d) => { const u = (d.exists && d.data().data) || ''; S.fotos[k] = u; if (u) aplicarFoto(k); }).catch(() => {});
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
    if (p.mapsUrl) return p.mapsUrl;
    if (p.direccion) return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.direccion + (c && c.ciudad ? ', ' + c.ciudad : '') + ', Entre Ríos');
    return '';
  }
  function mapaUrl(p) { const d = 0.0035; return `https://www.openstreetmap.org/export/embed.html?bbox=${p.lng - d},${p.lat - d * 0.6},${p.lng + d},${p.lat + d * 0.6}&layer=mapnik&marker=${p.lat},${p.lng}`; }
  const retiroLabel = (p) => 'Retiro del ' + (p.tipo === 'stand' ? 'stand' : p.tipo === 'carrito' ? 'carrito' : 'material');

  // Varias novedades juntas (por ejemplo, los lugares de cada campaña) se dibujan una sola vez.
  function luego() { if (luego.t) return; luego.t = setTimeout(() => { luego.t = 0; render(); }, 0); }
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
    renderHome();
  }

  /* ---------- Días y turnos de una campaña ---------- */
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
  function listenCC(cid) {
    if (S.ccUnsub[cid]) return;
    S.cc[cid] = S.cc[cid] || {}; S.ccUnsub[cid] = true;
    S.ccUnsub[cid] = S.db.collection('cupos').where('cid', '==', cid).onSnapshot((qs) => {
      const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.cc[cid] = o;
      if (S.route.name === 'home' || (S.route.name === 'camp' && S.route.cid === cid)) luego();
    }, () => {});
  }
  const ocupDe = (cid, fecha, tid) => ((S.cc[cid] || {})[cupoId(cid, fecha, tid)] || {}).ocupados || {};
  function cobertura(c, dias) {
    let total = 0, ocup = 0;
    dias.forEach(d => turnosDelDia(c, d).forEach(t => { const n = cupoDe(c, t); total += n; ocup += Math.min(n, Object.keys(ocupDe(c.id, d, t.id)).length); }));
    return { total, ocup, faltan: total - ocup };
  }

  /* ---------- Pedidos por confirmar (para la franja del coordinador en el inicio) ---------- */
  function listenPend(cid) {
    if (S.pendUnsub[cid]) return;
    S.pendUnsub[cid] = true;
    S.pendUnsub[cid] = S.db.collection('pedidos').where('cid', '==', cid).onSnapshot((qs) => {
      let n = 0; qs.forEach(d => { const x = d.data(); if (x.estado === 'pendiente' && x.fecha >= hoy()) n++; });
      S.pend[cid] = n; if (S.route.name === 'home') luego();
    }, () => {});
  }

  /* ---------- Inicio ---------- */
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
        : `<h4>Sumate a un turno</h4><p>Elegí una campaña, un día y un horario. Un coordinador te confirma.</p><div class="stats"><div><b class="num">${list.length}</b><small>${list.length === 1 ? 'campaña activa' : 'campañas activas'}</small></div><div><b class="num">${n}</b><small>lugares libres esta semana</small></div></div>`;
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
    if (vis.length && conMapa) h += `<div class="seg2" role="tablist"><button type="button" data-vista="lista" class="${S.vista !== 'mapa' ? 'on' : ''}">${I('list', 'width:15px;height:15px')}Lista</button><button type="button" data-vista="mapa" class="${S.vista === 'mapa' ? 'on' : ''}">${I('pin', 'width:15px;height:15px')}Mapa</button></div>`;
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
    return `<button type="button" class="cc camp" data-go="#/c/${esc(c.id)}"><span class="th"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}></span><span class="tx"><b>${esc(c.nombre)}</b><small>${esc([c.ciudad, rangoCorto(c), pts.length + (pts.length === 1 ? ' punto' : ' puntos')].filter(Boolean).join(' · '))}</small>${cob}</span>${I('chev')}</button>`;
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
    const dias = diasDe(c);
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
    h += `<div class="sec">${esc(cap(fmtDia(S.dia)))}</div>`;
    const orden = Object.keys(c.puntos || {}).filter(pid => ts.some(t => t.punto === pid));
    if (!orden.length) h += '<div class="card"><div class="empty">No hay turnos ese día.</div></div>';
    orden.forEach(pid => {
      const p = c.puntos[pid], tp = TIPOS[p.tipo] || TIPOS.otro;
      h += `<div class="pt"><div class="th"${fotoAttr(c.id, (p.fotos || [])[0])}>${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin')}</div><div class="tx"><b>${esc(p.nombre)}</b><small>${esc(tp[1])} · ${cupoDe(c, { punto: pid })} por turno${p.detalle ? ' · ' + esc(p.detalle) : ''}</small></div>${tieneLugar(p) ? `<button type="button" class="loc" data-lugar="${esc(c.id)}|${esc(pid)}">${I('pin', 'width:15px;height:15px')}Ver lugar</button>` : ''}</div><div class="slots">`;
      h += ts.filter(t => t.punto === pid).map(t => {
        const oc = ocupDe(c.id, S.dia, t.id), n = cupoDe(c, t), vals = Object.values(oc), conf = vals.filter(v => v === 'c').length, pend = vals.length - conf;
        const mio = S.user && oc[S.user.uid];
        const falta = n - vals.length, full = falta <= 0;
        const seats = Array.from({ length: Math.max(n, vals.length) }, (_, k) => `<i class="${k < conf ? 'c' : k < conf + pend ? 'p' : ''}"></i>`).join('');
        const btn = mio ? `<button type="button" class="sbtn mine" data-mio="${esc(t.id)}">${oc[S.user.uid] === 'c' ? 'Tu turno' : 'Pedido'}</button>`
          : `<button type="button" class="sbtn pri" data-pedir="${esc(t.id)}" ${full ? 'disabled' : ''}>${full ? 'Completo' : 'Anotarme'}</button>`;
        return `<div class="row slot"><div class="hr"><b class="num">${esc(t.desde)}</b><small>hasta ${esc(t.hasta)}</small></div><div class="tx"><div class="seats">${seats}</div><small>${full ? 'sin lugar' : falta === 1 ? 'falta 1' : 'faltan ' + falta}</small></div>${btn}</div>`;
      }).join('') + '</div>';
    });
    $('app').innerHTML = h;
  }
  function verLugar(cid, pid) {
    const c = S.campanas[cid], p = c && c.puntos && c.puntos[pid];
    if (!p) return;
    const tp = TIPOS[p.tipo] || TIPOS.otro, url = comoLlegarUrl(p, c);
    const dir = p.direccion || (p.lat != null ? `${p.lat}, ${p.lng}` : '');
    const fotos = (p.fotos || []).map(f => `<div${fotoAttr(cid, f)}></div>`).join('');
    sheet(`${fotos ? `<div class="fotos">${fotos}</div>` : ''}<h3>${esc(p.nombre)}</h3><span class="sub">${esc(tp[1])} · ${cupoDe(c, { punto: pid })} por turno</span>
      ${p.lat != null ? `<div class="mapa"><iframe loading="lazy" title="Mapa de ${esc(p.nombre)}" src="${esc(mapaUrl(p))}"></iframe></div>` : ''}
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
    return ov;
  }
  /* ---------- Nota para el coordinador (opcional, privada como el celular) ---------- */
  const NOTA_MAX = 200;
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
    if (!S.user) {
      const ov = sheet(`<h3>Ingresá para anotarte</h3><p class="hint">Usamos tu cuenta de Google solo para saber que sos vos: así nadie puede anotarse a tu nombre y podés ver tus turnos.</p><button type="button" class="btn" id="lgBtn">Ingresar con Google</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
      ov.querySelector('#lgBtn').addEventListener('click', async () => { await login(); ov.remove(); if (S.user) pedir(tid); });
      return;
    }
    const pf = perfil(), p = c.puntos[t.punto];
    const congs = (S.publico.congregaciones || []).slice().sort((a, b) => a.localeCompare(b, 'es'));
    const opts = congs.map(x => `<option${x === pf.congregacion ? ' selected' : ''}>${esc(x)}</option>`).join('') + `<option value="__otra"${pf.congregacion && !congs.includes(pf.congregacion) ? ' selected' : ''}>Otra…</option>`;
    const libres = cupoDe(c, t) - Object.keys(ocupDe(c.id, S.dia, t.id)).length;
    const ov = sheet(`<h3>Confirmá tu turno</h3><p class="hint">Un coordinador lo revisa y te confirma.</p>
      <div class="sum"><div>${I('cal')}${esc(cap(fmtDia(S.dia)))}</div><div>${I('clock')}<span class="num">${esc(t.desde)} – ${esc(t.hasta)}</span><small>${libres === 1 ? 'Queda 1 lugar' : `Quedan ${libres} lugares`}</small></div><div>${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin')}${esc(p.nombre)} · ${esc(c.nombre)}</div></div>
      <div class="two"><div class="fld"><label for="pNom">Nombre</label><input id="pNom" autocomplete="given-name" value="${esc(pf.nombre || (S.user.displayName || '').split(' ')[0] || '')}"></div>
      <div class="fld"><label for="pApe">Apellido</label><input id="pApe" autocomplete="family-name" value="${esc(pf.apellido || (S.user.displayName || '').split(' ').slice(1).join(' ') || '')}"></div></div>
      <div class="fld"><label for="pCong">Congregación</label><select id="pCong">${congs.length ? '<option value="">Elegí tu congregación</option>' : ''}${opts}</select></div>
      <div class="fld${pf.congregacion && !congs.includes(pf.congregacion) ? '' : ' hidden'}" id="pOtraF"><label for="pOtra">¿Cuál?</label><input id="pOtra" value="${esc(pf.congregacion && !congs.includes(pf.congregacion) ? pf.congregacion : '')}" placeholder="Nombre de tu congregación y ciudad"></div>
      <div class="fld"><label for="pCel">Celular (WhatsApp)</label><input id="pCel" type="tel" autocomplete="tel" value="${esc(pf.celular || '')}" placeholder="343 555-0000"></div>
      ${notaCampo('')}
      <label class="ck"><input type="checkbox" id="pOk"${pf.acepto ? ' checked' : ''}> <span>Solo los coordinadores de esta campaña ven mis datos, para organizar los turnos. <a href="#" data-priv>Más info</a></span></label>
      <p class="err hidden" id="pErr"></p>
      <button type="button" class="btn" id="pGo">Anotarme en este turno</button><button type="button" class="btn alt" data-cerrar>Cancelar</button><p class="fine">Tus datos quedan guardados en este celular para la próxima vez.</p>`);
    const q = (s) => ov.querySelector(s);
    bindNota(ov);
    q('#pCong').addEventListener('change', () => q('#pOtraF').classList.toggle('hidden', q('#pCong').value !== '__otra'));
    q('[data-priv]').addEventListener('click', (e) => { e.preventDefault(); privacidad(); });
    q('#pGo').addEventListener('click', async () => {
      const nombre = q('#pNom').value.trim(), apellido = q('#pApe').value.trim(), celular = q('#pCel').value.trim();
      const nota = q('#pNota').value.trim().slice(0, NOTA_MAX);
      const congregacion = q('#pCong').value === '__otra' ? q('#pOtra').value.trim() : q('#pCong').value;
      const err = (m) => { q('#pErr').textContent = m; q('#pErr').classList.remove('hidden'); };
      if (!nombre || !apellido) return err('Completá tu nombre y apellido.');
      if (!congregacion) return err('Elegí tu congregación.');
      if ((celular.match(/\d/g) || []).length < 8) return err('Escribí tu celular con característica (por ejemplo 343 555-0000).');
      if (!q('#pOk').checked) return err('Para pedir el turno tenés que aceptar que los coordinadores vean tus datos.');
      guardarPerfil({ nombre, apellido, congregacion, celular, acepto: true });
      const b = q('#pGo'); b.disabled = true; b.textContent = 'Enviando…';
      try {
        await enviarPedido(c, t, S.dia, { nombre, apellido, congregacion, celular, nota });
        ov.remove();
        const pid = cupoId(c.id, S.dia, t.id) + '__' + S.user.uid;
        sheet(`<div class="ok-big"><div class="o">${I('check', 'width:30px;height:30px;stroke-width:2.6')}</div><h3>¡Listo! Te anotaste</h3><p>${esc(cap(fmtDia(S.dia)))} · ${esc(t.desde)} a ${esc(t.hasta)} · ${esc(p.nombre)}</p><p><span class="tag pendiente">Esperando confirmación</span><br>Cuando un coordinador lo confirme lo vas a ver en el inicio y en Mis turnos.</p></div><button type="button" class="btn" data-go="#/t/${esc(pid)}" data-cerrar>Ver mi turno</button><button type="button" class="btn alt" data-cerrar>Listo</button>`);
      } catch (e) {
        console.error(e); b.disabled = false; b.textContent = 'Anotarme en este turno';
        err(/permission|insufficient/i.test(e && (e.code || e.message) || '') ? 'Ese turno se acaba de completar. Elegí otro.' : 'No se pudo enviar. Revisá la conexión y probá de nuevo.');
      }
    });
  }
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
    const ov = sheet(`<h3>¿Cancelar este turno?</h3><p class="hint">Se libera el lugar para otro publicador y se borran tus datos de ese turno.</p>
      <div class="sum"><div><b>${esc(cap(fmtDia(p.fecha)))} · ${esc(p.desde)} a ${esc(p.hasta)}</b></div><div style="color:var(--ink3)">${esc([c.nombre, pt.nombre, c.ciudad].filter(Boolean).join(' · '))}</div></div>
      <button type="button" class="btn danger" id="cxOk">Sí, cancelar el turno</button><button type="button" class="btn alt" data-cerrar>No, mantenerlo</button>`);
    ov.querySelector('#cxOk').addEventListener('click', async () => {
      const b = ov.querySelector('#cxOk'); b.disabled = true; b.textContent = 'Cancelando…';
      const batch = S.db.batch();
      batch.update(S.db.doc('cupos/' + cupoId(p.cid, p.fecha, p.tid)), { ['ocupados.' + p.uid]: S.del() });
      batch.delete(S.db.doc('pedidos/' + pid));
      try { await batch.commit(); ov.remove(); toast('Turno cancelado'); if (S.route.name === 'turno') go('#/mis'); }
      catch (e) { console.error(e); b.disabled = false; b.textContent = 'Sí, cancelar el turno'; toast('No se pudo cancelar. Probá de nuevo.'); }
    });
  }
  S.del = () => (window.__ppamMock ? window.__ppamMock.del() : firebase.firestore.FieldValue.delete());

  /* ---------- Mis turnos ---------- */
  function renderMis() {
    if (!S.user) { $('app').innerHTML = '<div class="welcome"><h4>Tus turnos</h4><p>Ingresá con tu cuenta de Google para ver los turnos que pediste.</p><button type="button" class="btn p" data-login>Ingresar con Google</button></div>'; return; }
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
    let h = pt.lat != null ? `<div class="mapa big"><iframe loading="lazy" title="Mapa de ${esc(pt.nombre || '')}" src="${esc(mapaUrl(pt))}"></iframe></div>`
      : `<div class="mapa big foto"${fotoAttr(p.cid, (pt.fotos || [])[0], `background-image:${colorDe(c.id ? c : { id: p.cid })};`)}></div>`;
    h += `<div class="det"><div class="st ${esc(p.estado)}"><i></i>${conf ? 'Confirmado por un coordinador' : rech ? 'No fue confirmado' : 'Esperando confirmación'}</div>`;
    h += `<h2>${esc(cap(DOW_L[d.getDay()]))} ${d.getDate()} de ${MES[d.getMonth()]} · <span class="num">${esc(p.desde)} a ${esc(p.hasta)}</span></h2>`;
    h += `<div class="m">${esc([c.nombre, pt.nombre, pt.direccion].filter(Boolean).join(' · '))}</div>`;
    if (!rech) h += `<div class="tl"><span class="ok"><span class="dot">${I('check')}</span>Pedido</span><span class="ln on"></span><span class="${conf ? 'ok' : ''}"><span class="dot">${conf ? I('check') : ''}</span>Confirmado</span><span class="ln${pasado ? ' on' : ''}"></span><span class="${pasado ? 'ok' : ''}"><span class="dot">${pasado ? I('check') : ''}</span>El día</span></div>`;
    h += '<div class="grid4">';
    h += url ? `<a class="pr" href="${esc(url)}" target="_blank" rel="noopener">${I('nav')}Llegar</a>` : `<button type="button" disabled>${I('nav')}Llegar</button>`;
    h += `<button type="button" data-ics="${esc(p.id)}">${I('cal')}Agendar</button><button type="button" data-comp="${esc(p.id)}">${I('share')}Compartir</button>`;
    h += !rech && !pasado ? `<button type="button" data-cancelar="${esc(p.id)}">${I('x')}Cancelar</button>` : `<button type="button" disabled>${I('x')}Cancelar</button>`;
    h += '</div>';
    if (!rech && !pasado) h += `<div class="info nota-info"><b>Nota para el coordinador</b><p>${p.nota ? esc(p.nota) : '<span class="faint">Sin nota.</span>'}</p><button type="button" class="sbtn" data-nota="${esc(p.id)}">${I('edit', 'width:15px;height:15px')}${p.nota ? 'Cambiar' : 'Agregar una nota'}</button></div>`;
    else if (p.nota) h += `<div class="info"><b>Nota para el coordinador</b><p>${esc(p.nota)}</p></div>`;
    if (pt.indicaciones) h += `<div class="info"><b>Cómo encontrarlo</b><p>${esc(pt.indicaciones)}</p></div>`;
    if (pt.retiro) h += `<div class="info"><b>${esc(retiroLabel(pt))}</b><p>${esc(pt.retiro)}</p></div>`;
    if (tieneLugar(pt)) h += `<button type="button" class="btn alt" data-lugar="${esc(p.cid)}|${esc(p.punto)}">${I('pin')}Ver fotos y datos del lugar</button>`;
    h += '</div>';
    $('app').innerHTML = h;
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
    S.coord.unsub.push(S.db.collection('pedidos').where('cid', '==', cid).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.coord.pedidos = o; if (S.route.name === 'coord') renderCoord(); }, (e) => console.error(e)));
    S.coord.unsub.push(S.db.collection('cupos').where('cid', '==', cid).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.coord.cupos = o; if (S.route.name === 'coord') renderCoord(); }, (e) => console.error(e)));
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
    let h = `<div class="kpis"><div class="kpi hl"><b class="num">${pend.length}</b><span>por confirmar</span></div><div class="kpi"><b class="num">${total ? Math.round(ocup * 100 / total) : 0}%</b><span>cubierto</span></div><div class="kpi"><b class="num">${personas}</b><span>publicadores</span></div></div>`;
    const tabs = [['pedidos', 'Pedidos'], ['cobertura', 'Cobertura'], ['dia', 'Del día'], ['config', 'Ajustes']];
    h += `<div class="tabs">${tabs.map(([k, l]) => `<button type="button" class="${S.coord.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
    if (S.coord.tab === 'pedidos') h += coordPedidos(c, pend, peds);
    else if (S.coord.tab === 'cobertura') h += coordCobertura(c, dias);
    else if (S.coord.tab === 'dia') h += coordDia(c, dias, peds);
    else h += coordConfig(c);
    $('app').innerHTML = h;
    if (S.coord.tab === 'config') bindConfig(c);
  }
  function pedidoCoordRow(c, p, acciones) {
    const pt = (c.puntos || {})[p.punto] || {};
    const wa = String(p.celular || '').replace(/\D/g, '');
    const pal = ['#E5EEEB|#12433F', '#F4ECDC|#8A6A2E', '#E6ECF5|#2F4B7A', '#F3E6EC|#7A3553'][(p.nombre || '').length % 4].split('|');
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
          h += `<div class="${k >= n ? 'full' : k > 0 ? 'half' : 'none'}" title="${pe} por confirmar">${k}/${n}${pe ? '<sup>+' + pe + '</sup>' : ''}</div>`;
        });
      });
      h += '</div>';
    });
    h += `<div class="acts"><button type="button" class="sbtn pri" data-voluntarios>${I('chat')}Pedir voluntarios por WhatsApp</button></div><p class="note">Arma un mensaje con los turnos de estos días que todavía no están completos y el link a la campaña.</p>`;
    return h;
  }
  function coordDia(c, dias, peds) {
    if (!dias.length) return '<div class="empty">No hay días con turnos por delante.</div>';
    if (!S.coord.dia || !dias.includes(S.coord.dia)) S.coord.dia = dias[0];
    let h = `<div class="days">${dias.slice(0, 30).map(d => { const x = parseIso(d); return `<button type="button" class="day${d === S.coord.dia ? ' on' : ''}" data-cdia="${d}"><small>${DOW[x.getDay()]}</small><b>${x.getDate()}</b><i>${MES[x.getMonth()].slice(0, 3)}</i></button>`; }).join('')}</div>`;
    const ts = turnosDelDia(c, S.coord.dia);
    h += '<div class="card">' + ts.map(t => {
      const ps = peds.filter(p => p.fecha === S.coord.dia && p.tid === t.id && p.estado === 'confirmado');
      return `<div class="row" style="display:block"><b>${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} · ${esc(c.puntos[t.punto].nombre)}</b><small>${ps.length ? ps.map(p => esc(p.nombre + ' ' + p.apellido) + ' (' + esc(p.congregacion) + ')').join(' · ') : 'Nadie confirmado todavía'} · ${ps.length}/${cupoDe(c, t)}</small>${ps.filter(p => p.nota).map(p => `<div class="nota chica">${I('edit', 'width:14px;height:14px')}<span><b>${esc(p.nombre)}:</b> ${esc(p.nota)}</span></div>`).join('')}</div>`;
    }).join('') + '</div>';
    h += `<div class="acts"><button type="button" class="sbtn pri" data-listadia>${I('share')}Compartir la lista por WhatsApp</button></div>`;
    return h;
  }
  async function cambiarEstado(pid, estado) {
    const p = S.coord.pedidos[pid]; if (!p) return;
    const batch = S.db.batch();
    const cref = S.db.doc('cupos/' + cupoId(p.cid, p.fecha, p.tid));
    if (estado === 'confirmado') batch.set(cref, { cid: p.cid, fecha: p.fecha, tid: p.tid, ocupados: { [p.uid]: 'c' } }, { merge: true });
    else batch.update(cref, { ['ocupados.' + p.uid]: S.del() });
    batch.update(S.db.doc('pedidos/' + pid), { estado, actualizado: new Date().toISOString(), por: S.user.email.toLowerCase() });
    try { await batch.commit(); toast(estado === 'confirmado' ? 'Confirmado' : 'Listo'); } catch (e) { console.error(e); toast('No se pudo guardar. Probá de nuevo.'); }
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
    const turnos = Object.keys(c.turnos || {}).map(id => Object.assign({ id }, c.turnos[id])).sort((a, b) => (a.punto + a.desde).localeCompare(b.punto + b.desde));
    let h = `<div class="sec">Datos de la campaña</div><div class="card" style="padding:12px 13px 4px;">
      <div class="lbl">Foto de portada</div><div class="portada"${fotoAttr(c.id, c.portada, `background-image:${colorDe(c)};`)}></div>
      <div class="pills"><label class="sbtn">${I('camera')}${c.portada ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" id="cfFoto" hidden></label>${c.portada ? '<button type="button" class="sbtn bad" id="cfFotoDel">Quitar foto</button>' : ''}</div>
      <p class="small-hint">Una foto apaisada del lugar, sin personas reconocibles. Se achica sola antes de subirse. Sin foto se usa el color de la campaña.</p>
      <div class="fld"><label for="cfNom">Nombre</label><input id="cfNom" value="${esc(c.nombre)}"></div>
      <div class="two"><div class="fld"><label for="cfCiu">Ciudad</label><input id="cfCiu" value="${esc(c.ciudad || '')}"></div><div class="fld"><label for="cfLug">Lugar (opcional)</label><input id="cfLug" value="${esc(c.lugar || '')}"></div></div>
      <div class="two"><div class="fld"><label for="cfDes">Desde</label><input id="cfDes" type="date" value="${esc(c.desde || '')}"></div><div class="fld"><label for="cfHas">Hasta</label><input id="cfHas" type="date" value="${esc(c.hasta || '')}"></div></div>
      <label class="ck"><input type="checkbox" id="cfAct"${c.activa !== false ? ' checked' : ''}> <span>Visible para todos (si la desmarcás, deja de aparecer en el inicio)</span></label>
      <button type="button" class="btn" id="cfSave" style="margin-bottom:10px;">Guardar datos</button></div>`;
    const sinMarcar = puntos.filter(p => p.lat == null).length;
    if (puntos.length && sinMarcar) h += `<div class="aviso-mapa">${I('pin', 'width:16px;height:16px;flex-shrink:0;margin-top:2px')}<span><b>${sinMarcar === puntos.length ? 'Ningún punto está marcado en el mapa' : `${sinMarcar} de ${puntos.length} puntos sin marcar en el mapa`}</b>Para que aparezcan en el mapa del Inicio, entrá a cada punto con "Editar" y tocá el mapa donde está el carrito (o "Estoy acá" parado en el lugar).</span></div>`;
    h += `<div class="sec">Puntos <button type="button" class="sbtn" data-punto="">+ Punto</button></div><div class="card">` + (puntos.map(p => `<div class="edit-row"><div><b class="er-t"><span class="er-ic">${I(p.tipo === 'carrito' ? 'cart' : p.tipo === 'stand' ? 'stand' : 'pin', 'width:16px;height:16px')}</span>${esc(p.nombre)}</b><small style="display:block;color:var(--soft);font-size:12px;">${esc((TIPOS[p.tipo] || TIPOS.otro)[1])} · ${cupoDe(c, { punto: p.id })} por turno${p.detalle ? ' · ' + esc(p.detalle) : ''}</small><small style="display:block;font-size:11.5px;color:${p.lat != null ? 'var(--ok)' : 'var(--warn)'};">${p.lat != null ? 'Marcado en el mapa' : tieneUbic(p) ? 'Con dirección, sin marcar en el mapa' : 'Sin marcar en el mapa'}${(p.fotos || []).length ? ' · ' + p.fotos.length + ((p.fotos.length === 1) ? ' foto' : ' fotos') : ''}</small></div><button type="button" class="sbtn" data-punto="${esc(p.id)}">Editar</button></div>`).join('') || '<div class="empty">Agregá el primer punto (un carrito, un stand…).</div>') + '</div>';
    h += `<div class="sec">Turnos <button type="button" class="sbtn" data-turno="" ${puntos.length ? '' : 'disabled'}>+ Turno</button></div><div class="card">` + (turnos.map(t => `<div class="edit-row"><div><b>${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} · ${esc((c.puntos[t.punto] || {}).nombre || '¿?')}</b><small style="display:block;color:var(--soft);font-size:12px;">${(t.dias || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DOW[d]).join(', ') || 'Ningún día'}</small></div><button type="button" class="sbtn" data-turno="${esc(t.id)}">Editar</button></div>`).join('') || '<div class="empty">Agregá los horarios de cada punto (por ejemplo, 8 a 10, de lunes a sábado).</div>') + '</div>';
    return h;
  }
  const uidGen = () => Math.random().toString(36).slice(2, 9);
  async function guardarCampo(c, path, value, msg) {
    try { await S.db.doc('campanas/' + c.id).update({ [path]: value }); if (msg) toast(msg); return true; }
    catch (e) { console.error(e); toast('No se pudo guardar. Probá de nuevo.'); return false; }
  }
  function bindConfig(c) {
    $('cfFoto').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) subirPortada(c, f); });
    if ($('cfFotoDel')) $('cfFotoDel').addEventListener('click', async () => {
      if (!confirm('¿Quitar la foto de portada?')) return;
      const b = S.db.batch(); b.update(S.db.doc('campanas/' + c.id), { portada: S.del() }); b.delete(S.db.doc('fotos/' + fotoKey(c.id, c.portada)));
      try { await b.commit(); toast('Foto quitada'); } catch (e) { console.error(e); toast('No se pudo quitar.'); }
    });
    $('cfSave').addEventListener('click', async () => {
      const d = { nombre: $('cfNom').value.trim(), ciudad: $('cfCiu').value.trim(), lugar: $('cfLug').value.trim(), desde: $('cfDes').value, hasta: $('cfHas').value, activa: $('cfAct').checked };
      if (!d.nombre || !d.desde || !d.hasta) { toast('Completá el nombre y las fechas.'); return; }
      if (d.hasta < d.desde) { toast('La fecha "hasta" es anterior a "desde".'); return; }
      try { await S.db.doc('campanas/' + c.id).update(d); toast('Guardado'); } catch (e) { console.error(e); toast('No se pudo guardar.'); }
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
      try { await b.commit(); ov.remove(); toast('Punto guardado'); }
      catch (e) { console.error(e); btn.disabled = false; btn.textContent = 'Guardar'; toast('No se pudo guardar. Probá de nuevo.'); }
    });
    if (pidIn) q('#ptDel').addEventListener('click', async () => {
      const usados = Object.values(c.turnos || {}).filter(t => t.punto === pid).length;
      if (!confirm(usados ? `Este punto tiene ${usados} turno(s). Se borran también. ¿Seguir?` : '¿Borrar este punto?')) return;
      const upd = { ['puntos.' + pid]: S.del() };
      Object.keys(c.turnos || {}).forEach(tid => { if (c.turnos[tid].punto === pid) upd['turnos.' + tid] = S.del(); });
      const b = S.db.batch(); b.update(S.db.doc('campanas/' + c.id), upd);
      (p.fotos || []).forEach(f => b.delete(S.db.doc('fotos/' + fotoKey(c.id, f))));
      try { await b.commit(); ov.remove(); toast('Punto borrado'); } catch (e) { toast('No se pudo borrar.'); }
    });
  }
  function editarTurno(c, tid) {
    const t = tid ? c.turnos[tid] : { punto: Object.keys(c.puntos)[0], desde: '08:00', hasta: '10:00', dias: [1, 2, 3, 4, 5, 6] };
    const orden = [1, 2, 3, 4, 5, 6, 0];
    const ov = sheet(`<h3>${tid ? 'Editar turno' : 'Nuevo turno'}</h3><p class="hint">Se repite todos los días marcados, entre las fechas de la campaña.</p>
      <div class="fld"><label for="tuPto">Punto</label><select id="tuPto">${Object.keys(c.puntos).map(pid => `<option value="${esc(pid)}"${pid === t.punto ? ' selected' : ''}>${esc(c.puntos[pid].nombre)}</option>`).join('')}</select></div>
      <div class="two"><div class="fld"><label for="tuDes">Desde</label><input id="tuDes" type="time" value="${esc(t.desde)}"></div><div class="fld"><label for="tuHas">Hasta</label><input id="tuHas" type="time" value="${esc(t.hasta)}"></div></div>
      <div class="fld"><label>Días</label><div class="wd">${orden.map(d => `<label><input type="checkbox" value="${d}"${(t.dias || []).includes(d) ? ' checked' : ''}><span>${DOW[d]}</span></label>`).join('')}</div></div>
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
      try { await S.db.doc('campanas/' + c.id).update(upd); ov.remove(); toast(Object.keys(upd).length > 1 ? `${Object.keys(upd).length} turnos creados` : 'Turno guardado'); } catch (e) { console.error(e); toast('No se pudo guardar.'); }
    });
    if (tid) q('#tuDel').addEventListener('click', async () => { if (!confirm('¿Borrar este turno? Los pedidos que ya tenga quedan en la lista.')) return; if (await guardarCampo(c, 'turnos.' + tid, S.del(), 'Turno borrado')) ov.remove(); });
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
    h += `<div class="sec">Equipo de soporte</div><div class="card" style="padding:12px 13px;"><p class="note" style="margin:0 0 8px;">Ven los reportes de problemas y los errores de la página. No cambian campañas ni ven los pedidos. Un email por renglón.</p><div class="fld"><textarea id="adSop" rows="3">${esc(S.soporteEmails.join('\n'))}</textarea></div><button type="button" class="btn" id="adSopOk">Guardar</button></div>`;
    $('app').innerHTML = h;
    $('adMapa').addEventListener('change', async (e) => {
      const on = e.target.checked;
      try { await S.db.doc('config/publico').set({ mapa: on }, { merge: true }); toast(on ? 'El mapa se muestra en el Inicio' : 'El mapa quedó apagado'); } catch (er) { e.target.checked = !on; toast('No se pudo guardar.'); }
    });
    $('adSopOk').addEventListener('click', async () => {
      const lista = [...new Set($('adSop').value.split('\n').map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
      try { await S.db.doc('config/soporte').set({ emails: lista }); S.soporteEmails = lista; toast('Equipo de soporte guardado'); renderAdmin(); } catch (e) { toast('No se pudo guardar.'); }
    });
    $('adCongsOk').addEventListener('click', async () => {
      const lista = [...new Set($('adCongs').value.split('\n').map(s => s.trim()).filter(Boolean))];
      try { await S.db.doc('config/publico').set({ congregaciones: lista }, { merge: true }); toast('Lista guardada'); } catch (e) { toast('No se pudo guardar.'); }
    });
    $('adAdmOk').addEventListener('click', async () => {
      const lista = [...new Set($('adAdm').value.split('\n').map(s => s.trim().toLowerCase()).filter(s => /@/.test(s)))];
      if (!lista.includes(S.user.email.toLowerCase()) && !confirm('No estás en la lista: vas a dejar de ser administrador. ¿Seguir?')) return;
      try { await S.db.doc('config/admins').set({ emails: lista }); S.admins = lista; toast('Guardado'); } catch (e) { toast('No se pudo guardar.'); }
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
      try { await S.db.doc('campanas/' + slug).set(d); ov.remove(); toast('Campaña creada'); S.coord.tab = 'config'; go('#/coord/' + slug); } catch (e) { console.error(e); toast('No se pudo crear.'); }
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
      try { await batch.commit(); S.coordEmails[cid] = lista; ov.remove(); toast('Coordinadores guardados'); renderAdmin(); } catch (e) { console.error(e); toast('No se pudo guardar.'); }
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
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a[data-go]'); if (!t) return;
    const ds = t.dataset;
    if (t.id === 'backBtn') { const r = S.route; go((r.name === 'coord' && r.cid) || r.name === 'admin' || r.name === 'soporte' ? '#/coord' : r.name === 'turno' ? '#/mis' : '#/'); return; }
    if (t.id === 'shareBtn') { const c = S.campanas[S.route.cid]; if (!c) return; const txt = `PPAM · ${c.nombre} (${c.ciudad || ''}). Anotate en un turno: ${linkCampana(c)}`; if (navigator.share && !window.__ppamMock) navigator.share({ title: c.nombre, text: txt }).catch(() => {}); else compartir(txt); return; }
    if (t.id === 'userBtn') {
      if (!S.user) { login(); return; }
      const ov = sheet(`<div class="acct"><span class="av big">${esc(iniciales(S.user.displayName || S.user.email))}</span><div><h3>${esc(S.user.displayName || 'Mi cuenta')}</h3><p class="hint">${esc(S.user.email)}</p></div></div><button type="button" class="btn" id="uMis">Mis turnos</button>${puedeInstalar() ? '<button type="button" class="btn alt" id="uInst">Instalar la app</button>' : ''}<button type="button" class="btn alt" id="uOut">Cerrar sesión</button>`);
      if (ov.querySelector('#uInst')) ov.querySelector('#uInst').addEventListener('click', () => { ov.remove(); instalar(); });
      ov.querySelector('#uMis').addEventListener('click', () => { ov.remove(); go('#/mis'); });
      ov.querySelector('#uOut').addEventListener('click', async () => { ov.remove(); await S.auth.signOut(); go('#/'); });
      return;
    }
    if (t.id === 'coordBtn') { go('#/coord'); return; }
    if (t.id === 'privBtn') { privacidad(); return; }
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
    if (ds.pedir) { pedir(ds.pedir); return; }
    if (ds.mio) { go('#/mis'); return; }
    if (ds.lugar) { const [cid, pid] = ds.lugar.split('|'); verLugar(cid, pid); return; }
    if (ds.copiar) { copiar(ds.copiar); return; }
    if (ds.ics) { agendar(ds.ics); return; }
    if (ds.comp) { compartirTurno(ds.comp); return; }
    if (ds.nota) { editarNota(ds.nota); return; }
    if (ds.cancelar) { cancelarPedido(ds.cancelar); return; }
    if (ds.tab) { S.coord.tab = ds.tab; renderCoord(); return; }
    if (ds.confirmar) { cambiarEstado(ds.confirmar, 'confirmado'); return; }
    if (ds.rechazar) { if (confirm('¿No confirmar este pedido? Se libera el lugar.')) cambiarEstado(ds.rechazar, 'rechazado'); return; }
    if (ds.quitar) { if (confirm('¿Quitar a esta persona del turno? Se libera el lugar.')) cambiarEstado(ds.quitar, 'rechazado'); return; }
    if (ds.sem) { const c = S.campanas[S.route.cid], dias = diasDe(c); const i = Math.max(0, Math.min(dias.length - 1, dias.indexOf(S.coord.semana) + (+ds.sem))); S.coord.semana = dias[i]; renderCoord(); return; }
    if (ds.cdia) { S.coord.dia = ds.cdia; renderCoord(); return; }
    if (ds.voluntarios !== undefined) { const c = S.campanas[S.route.cid]; compartir(textoVoluntarios(c, diasDe(c))); return; }
    if (ds.listadia !== undefined) { const c = S.campanas[S.route.cid]; compartir(textoDia(c, Object.values(S.coord.pedidos))); return; }
    if (ds.punto !== undefined) { editarPunto(S.campanas[S.route.cid], ds.punto || null); return; }
    if (ds.turno !== undefined) { editarTurno(S.campanas[S.route.cid], ds.turno || null); return; }
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
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (habia && !recargo) { recargo = true; location.reload(); } });
  }
  init();
})();
