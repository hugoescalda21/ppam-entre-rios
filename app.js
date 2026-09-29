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
  const TIPOS = { carrito: ['🛒', 'Carrito'], stand: ['⛺', 'Stand'], otro: ['📍', 'Punto'] };
  const COLORES = ['#C4552F', '#2F7D6B', '#B7791F', '#8E4B6E', '#3D6F8E', '#A2401F'];
  const ILUS = '<svg class="ilus" viewBox="0 0 200 110" aria-hidden="true"><path d="M0 110V70h18V52h14v18h10V38h22v72Z"/><path d="M60 110V58h16V44l12-10 12 10v14h14v52Z"/><path d="M116 110V66h20V50h16v16h12V30h20v80Z"/><circle class="sol" cx="160" cy="18" r="10"/></svg>';

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

  /* ---------- Estado ---------- */
  const S = {
    db: null, auth: null, user: null, isAdmin: false, coordDe: [],
    campanas: {}, loaded: false, publico: { congregaciones: [], ciudades: [] },
    ciudad: 'todas', route: { name: 'home' }, dia: null,
    cc: {}, ccUnsub: {}, fotos: {},
    mis: {}, misUnsub: null,
    coord: { cid: null, tab: 'pedidos', pedidos: {}, cupos: {}, unsub: [] , semana: null },
    admins: [], coordEmails: {}
  };
  window.__ppam = S;   // para las pruebas

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
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
    S.db.doc('config/publico').onSnapshot((d) => { S.publico = Object.assign({ congregaciones: [], ciudades: [] }, d.exists ? d.data() : {}); if (S.route.name === 'admin') render(); }, () => {});
    S.auth.onAuthStateChanged(onUser);
    window.addEventListener('hashchange', () => { readRoute(); render(); });
    readRoute();
  }
  async function onUser(u) {
    S.user = u || null; S.isAdmin = false; S.coordDe = [];
    if (S.misUnsub) { S.misUnsub(); S.misUnsub = null; } S.mis = {};
    if (u) {
      S.misUnsub = S.db.collection('pedidos').where('uid', '==', u.uid).onSnapshot((qs) => { const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.mis = o; render(); }, () => {});
      try { const r = await S.db.doc('roles/' + u.email.toLowerCase()).get(); S.coordDe = (r.exists && r.data().campanas) || []; } catch (e) { /* sin rol */ }
      try { const a = await S.db.doc('config/admins').get(); S.isAdmin = true; S.admins = (a.exists && a.data().emails) || []; } catch (e) { S.isAdmin = false; }
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

  /* ---------- Rutas: #/ · #/c/{cid} · #/mis · #/coord/{cid} · #/admin ---------- */
  function readRoute() {
    const h = (location.hash || '#/').slice(1).split('/').filter(Boolean);
    if (h[0] === 'c' && h[1]) S.route = { name: 'camp', cid: h[1] };
    else if (h[0] === 'mis') S.route = { name: 'mis' };
    else if (h[0] === 'coord') S.route = { name: 'coord', cid: h[1] || null };
    else if (h[0] === 'admin') S.route = { name: 'admin' };
    else S.route = { name: 'home' };
    window.scrollTo(0, 0);
  }
  const go = (h) => { if (location.hash === h) { readRoute(); render(); } else location.hash = h; };

  function renderTop() {
    const r = S.route, c = r.cid && S.campanas[r.cid];
    document.body.className = 'r-' + r.name;
    $('backBtn').classList.toggle('hidden', r.name === 'home');
    $('backBtn').textContent = r.name === 'camp' ? '‹ Campañas' : '‹ Volver';
    $('coordBtn').classList.toggle('hidden', !(S.user && (S.isAdmin || S.coordDe.length)) || r.name === 'coord' || r.name === 'admin');
    $('userBtn').textContent = S.user ? (S.user.displayName ? S.user.displayName.split(' ')[0] : 'Mi cuenta') : 'Iniciar sesión';
    let k = 'Predicación pública · Entre Ríos', t = 'Sumate a un turno', s = 'Elegí una campaña, un día y un horario.';
    if (r.name === 'camp' && c) { k = c.ciudad || ''; t = c.nombre; s = campRango(c); }
    else if (r.name === 'mis') { t = 'Mis turnos'; s = 'Los turnos que pediste, su estado y cómo llegar.'; }
    else if (r.name === 'coord') { k = 'Coordinación' + (c ? ' · ' + (c.ciudad || '') : ''); t = c ? c.nombre : 'Mis campañas'; s = c ? 'Pedidos, cobertura y listas del día.' : 'Elegí la campaña.'; }
    else if (r.name === 'admin') { k = 'Administración'; t = 'PPAM Entre Ríos'; s = 'Campañas, coordinadores y congregaciones.'; }
    $('tbKicker').textContent = k; $('tbTitle').textContent = t; $('tbSub').textContent = s;
    $('tbExtra').innerHTML = '';
    // En la campaña, la foto de portada (o su color) como banner
    const tb = $('tb'), fk = r.name === 'camp' && c && c.portada ? fotoKey(c.id, c.portada) : '';
    tb.dataset.foto = fk; tb.style.backgroundImage = ''; tb.classList.remove('foto');
    tb.style.backgroundColor = r.name === 'camp' && c ? colorDe(c) : '';
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
    if (r.name === 'coord') return renderCoord();
    if (r.name === 'admin') return renderAdmin();
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

  /* ---------- Inicio ---------- */
  function renderHome() {
    const list = Object.values(S.campanas).filter(c => c.activa !== false && (!c.hasta || c.hasta >= hoy()))
      .sort((a, b) => String(a.desde || '').localeCompare(String(b.desde || '')) || String(a.nombre).localeCompare(String(b.nombre)));
    const ciudades = [...new Set(list.map(c => c.ciudad).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    if (S.ciudad !== 'todas' && !ciudades.includes(S.ciudad)) S.ciudad = 'todas';
    const vis = list.filter(c => S.ciudad === 'todas' || c.ciudad === S.ciudad);
    $('tbExtra').innerHTML = ciudades.length > 1 ? `<div class="chips">${['todas', ...ciudades].map(x => `<button type="button" class="chip${x === S.ciudad ? ' on' : ''}" data-ciudad="${esc(x)}">${x === 'todas' ? 'Todas' : esc(x)}</button>`).join('')}</div>` : '';
    let h = '';
    const misProx = Object.values(S.mis).filter(p => p.fecha >= hoy() && p.estado !== 'rechazado').sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
    if (misProx.length) h += `<div class="card"><div class="card-h">Mis próximos turnos <a href="#/mis">Ver todos</a></div>${misProx.slice(0, 3).map(pedidoRow).join('')}</div><div class="sec">Campañas</div>`;
    h += vis.length ? vis.map(campCard).join('') : '<div class="card"><div class="empty">Todavía no hay campañas publicadas.</div></div>';
    $('app').innerHTML = h;
  }
  function campCard(c) {
    listenCC(c.id);
    const dias = diasDe(c), pts = Object.values(c.puntos || {});
    const tipos = [...new Set(pts.map(p => (TIPOS[p.tipo] || TIPOS.otro)[1].toLowerCase()))];
    let cob = '<div class="cob"><span>Todavía sin turnos cargados</span></div>';
    if (dias.length) {
      const k = cobertura(c, dias.filter(d => d <= addDays(dias[0], 6)));
      const pct = k.total ? Math.round(k.ocup * 100 / k.total) : 0;
      const cuando = dias[0] <= addDays(hoy(), 6) ? 'en los próximos 7 días' : 'la primera semana';
      cob = `<div class="bar"><i style="width:${pct}%"></i></div><div class="cob"><span>${k.faltan > 0 ? `Faltan ${k.faltan} ${k.faltan === 1 ? 'lugar' : 'lugares'} ${cuando}` : `Todo cubierto ${cuando} 🙌`}</span><b>${pct}%</b></div>`;
    }
    return `<div class="card"><button type="button" class="camp" data-go="#/c/${esc(c.id)}"><div class="ph"${fotoAttr(c.id, c.portada, `background-color:${colorDe(c)};`)}>${ILUS}<span class="city">${esc(c.ciudad || '')}</span>${c.desde ? `<span class="when">${esc(rangoCorto(c))}</span>` : ''}</div><div class="bd"><b>${esc(c.nombre)}</b><small>${pts.length} ${pts.length === 1 ? 'punto' : 'puntos'}${tipos.length ? ' · ' + esc(tipos.join(' y ')) : ''}${c.lugar ? ' · ' + esc(c.lugar) : ''}</small>${cob}</div></button></div>`;
  }
  const ESTADOS = { pendiente: 'Pendiente', confirmado: 'Confirmado', rechazado: 'No confirmado' };
  function pedidoRow(p) {
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, d = parseIso(p.fecha);
    return `<div class="row"><div class="dt${p.estado === 'confirmado' ? ' ok' : ''}"><b>${d.getDate()}</b><small>${DOW[d.getDay()]}</small></div><div class="tx"><b>${esc(cap(fmtDia(p.fecha)))} · ${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))}</b><small>${esc(c.nombre || '')} · ${esc(pt.nombre || '')}</small></div><span class="tag ${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</span></div>`;
  }

  /* ---------- Campaña ---------- */
  function renderCamp() {
    const c = S.campanas[S.route.cid];
    if (!c) { $('app').innerHTML = '<div class="card"><div class="empty">Esa campaña no existe o ya terminó.</div></div>'; return; }
    listenCC(c.id);
    const dias = diasDe(c);
    if (S.diaCid !== c.id || !dias.includes(S.dia)) { S.dia = dias[0]; S.diaCid = c.id; }
    if (!dias.length) { $('app').innerHTML = '<div class="card"><div class="empty">No hay días con turnos por delante.</div></div>'; return; }
    let h = `<div class="sec">Elegí el día</div><div class="days">${dias.map(d => {
      const x = parseIso(d), k = cobertura(c, [d]);
      const cls = k.faltan <= 0 ? 'lleno' : k.faltan / k.total <= 0.34 ? 'poco' : '';
      return `<button type="button" class="day${d === S.dia ? ' on' : ''}" data-dia="${d}"><small>${DOW[x.getDay()]}</small><b>${x.getDate()}</b><i>${MES[x.getMonth()].slice(0, 3)}</i><u class="${cls}"></u></button>`;
    }).join('')}</div>`;
    h += '<div class="leyenda"><span><i style="background:var(--ok)"></i>Hay lugar</span><span><i style="background:#E59A6B"></i>Quedan pocos</span><span><i style="background:var(--line2)"></i>Completo</span></div>';
    const ts = turnosDelDia(c, S.dia);
    h += `<div class="sec">${esc(cap(fmtDia(S.dia)))}</div>`;
    const orden = Object.keys(c.puntos || {}).filter(pid => ts.some(t => t.punto === pid));
    if (!orden.length) h += '<div class="card"><div class="empty">No hay turnos ese día.</div></div>';
    orden.forEach(pid => {
      const p = c.puntos[pid], tp = TIPOS[p.tipo] || TIPOS.otro;
      h += `<div class="pt"><div class="th"${fotoAttr(c.id, (p.fotos || [])[0])}>${tp[0]}</div><div class="tx"><b>${esc(p.nombre)}</b><small>${esc(tp[1])} · ${cupoDe(c, { punto: pid })} por turno${p.detalle ? ' · ' + esc(p.detalle) : ''}</small></div>${tieneLugar(p) ? `<button type="button" class="loc" data-lugar="${esc(c.id)}|${esc(pid)}">📍 Ver lugar</button>` : ''}</div>`;
      h += ts.filter(t => t.punto === pid).map(t => {
        const oc = ocupDe(c.id, S.dia, t.id), n = cupoDe(c, t), vals = Object.values(oc), conf = vals.filter(v => v === 'c').length, pend = vals.length - conf;
        const mio = S.user && oc[S.user.uid];
        const falta = n - vals.length, full = falta <= 0;
        const dots = Array.from({ length: Math.max(n, vals.length) }, (_, k) => `<i class="${k < conf ? 'c' : k < conf + pend ? 'p' : ''}"></i>`).join('');
        const btn = mio ? `<button type="button" class="sbtn mine" data-mio="${esc(t.id)}">${oc[S.user.uid] === 'c' ? 'Confirmado' : 'Pedido'}</button>`
          : `<button type="button" class="sbtn" data-pedir="${esc(t.id)}" ${full ? 'disabled' : ''}>${full ? 'Completo' : 'Pedir'}</button>`;
        return `<div class="row slot"><div class="h">${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))}</div><div class="tx"><div class="dots">${dots}</div><small>${full ? 'completo' : falta === 1 ? 'falta 1' : 'faltan ' + falta}</small></div>${btn}</div>`;
      }).join('');
    });
    h += `<p class="note">Círculo verde: lugar confirmado · naranja: pedido, falta que lo confirme un coordinador · vacío: libre.</p>`;
    $('app').innerHTML = h;
  }
  function verLugar(cid, pid) {
    const c = S.campanas[cid], p = c && c.puntos && c.puntos[pid];
    if (!p) return;
    const tp = TIPOS[p.tipo] || TIPOS.otro, url = comoLlegarUrl(p, c);
    const dir = p.direccion || (p.lat != null ? `${p.lat}, ${p.lng}` : '');
    const fotos = (p.fotos || []).map(f => `<div${fotoAttr(cid, f)}></div>`).join('');
    sheet(`${fotos ? `<div class="fotos">${fotos}</div>` : ''}<h3>${tp[0]} ${esc(p.nombre)}</h3><span class="sub">${esc(tp[1])} · ${cupoDe(c, { punto: pid })} por turno</span>
      ${p.lat != null ? `<div class="mapa"><iframe loading="lazy" title="Mapa de ${esc(p.nombre)}" src="${esc(mapaUrl(p))}"></iframe></div>` : ''}
      <div class="dir"><span>📍</span><div><b>${esc(c.nombre)}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</b>${dir ? '<br>' + esc(dir) : ''}${p.detalle ? '<br>' + esc(p.detalle) : ''}</div></div>
      ${url ? `<div class="lugar-acts"><a class="go" href="${esc(url)}" target="_blank" rel="noopener">🧭 Cómo llegar</a>${dir ? `<button type="button" class="sbtn" data-copiar="${esc(dir)}">📋 Copiar dirección</button>` : ''}</div>` : ''}
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
  async function pedir(tid) {
    const c = S.campanas[S.route.cid], t = c && c.turnos[tid] && Object.assign({ id: tid }, c.turnos[tid]);
    if (!t) return;
    if (!S.user) {
      const ov = sheet(`<h3>Iniciá sesión para pedir el turno</h3><p class="hint">Usamos tu cuenta de Google solo para saber que sos vos: así nadie puede pedir turnos a tu nombre y podés ver "Mis turnos".</p><button type="button" class="btn" id="lgBtn">Iniciar sesión con Google</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
      ov.querySelector('#lgBtn').addEventListener('click', async () => { await login(); ov.remove(); if (S.user) pedir(tid); });
      return;
    }
    const pf = perfil(), p = c.puntos[t.punto];
    const congs = (S.publico.congregaciones || []).slice().sort((a, b) => a.localeCompare(b, 'es'));
    const opts = congs.map(x => `<option${x === pf.congregacion ? ' selected' : ''}>${esc(x)}</option>`).join('') + `<option value="__otra"${pf.congregacion && !congs.includes(pf.congregacion) ? ' selected' : ''}>Otra…</option>`;
    const ov = sheet(`<h3>Pedir este turno</h3><p class="hint">Lo confirma uno de los coordinadores de la campaña.</p>
      <div class="sum"><b>${esc(c.nombre)}</b> · ${esc(c.ciudad || '')}<br>${esc(cap(fmtDia(S.dia)))} · ${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} h · ${esc(p.nombre)}</div>
      <div class="two"><div class="fld"><label for="pNom">Nombre</label><input id="pNom" autocomplete="given-name" value="${esc(pf.nombre || (S.user.displayName || '').split(' ')[0] || '')}"></div>
      <div class="fld"><label for="pApe">Apellido</label><input id="pApe" autocomplete="family-name" value="${esc(pf.apellido || (S.user.displayName || '').split(' ').slice(1).join(' ') || '')}"></div></div>
      <div class="fld"><label for="pCong">Congregación</label><select id="pCong">${congs.length ? '<option value="">Elegí tu congregación</option>' : ''}${opts}</select></div>
      <div class="fld${pf.congregacion && !congs.includes(pf.congregacion) ? '' : ' hidden'}" id="pOtraF"><label for="pOtra">¿Cuál?</label><input id="pOtra" value="${esc(pf.congregacion && !congs.includes(pf.congregacion) ? pf.congregacion : '')}" placeholder="Nombre de tu congregación y ciudad"></div>
      <div class="fld"><label for="pCel">Celular (WhatsApp)</label><input id="pCel" type="tel" autocomplete="tel" value="${esc(pf.celular || '')}" placeholder="343 555-0000"></div>
      <label class="ck"><input type="checkbox" id="pOk"${pf.acepto ? ' checked' : ''}> <span>Acepto que los coordinadores de esta campaña vean mis datos para organizar los turnos. No se usan para nada más. <a href="#" data-priv>Más info</a></span></label>
      <p class="err hidden" id="pErr"></p>
      <button type="button" class="btn" id="pGo">Pedir turno</button><button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const q = (s) => ov.querySelector(s);
    q('#pCong').addEventListener('change', () => q('#pOtraF').classList.toggle('hidden', q('#pCong').value !== '__otra'));
    q('[data-priv]').addEventListener('click', (e) => { e.preventDefault(); privacidad(); });
    q('#pGo').addEventListener('click', async () => {
      const nombre = q('#pNom').value.trim(), apellido = q('#pApe').value.trim(), celular = q('#pCel').value.trim();
      const congregacion = q('#pCong').value === '__otra' ? q('#pOtra').value.trim() : q('#pCong').value;
      const err = (m) => { q('#pErr').textContent = m; q('#pErr').classList.remove('hidden'); };
      if (!nombre || !apellido) return err('Completá tu nombre y apellido.');
      if (!congregacion) return err('Elegí tu congregación.');
      if ((celular.match(/\d/g) || []).length < 8) return err('Escribí tu celular con característica (por ejemplo 343 555-0000).');
      if (!q('#pOk').checked) return err('Para pedir el turno tenés que aceptar que los coordinadores vean tus datos.');
      guardarPerfil({ nombre, apellido, congregacion, celular, acepto: true });
      const b = q('#pGo'); b.disabled = true; b.textContent = 'Enviando…';
      try {
        await enviarPedido(c, t, S.dia, { nombre, apellido, congregacion, celular });
        ov.remove();
        sheet(`<div class="ok-big"><div class="o">✓</div><h3>¡Listo! Pediste el turno</h3><p>${esc(cap(fmtDia(S.dia)))} · ${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} h · ${esc(p.nombre)}.</p><p><span class="tag pendiente">Pendiente</span> Cuando un coordinador lo confirme lo vas a ver en "Mis turnos".</p></div><button type="button" class="btn" data-cerrar>Listo</button>`);
      } catch (e) {
        console.error(e); b.disabled = false; b.textContent = 'Pedir turno';
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
      estado: 'pendiente', creado: new Date().toISOString()
    });
    await batch.commit();
  }
  async function cancelarPedido(pid) {
    const p = S.mis[pid]; if (!p) return;
    if (!confirm(`¿Cancelar tu turno del ${fmtDia(p.fecha)} (${fmtHora(p.desde)} a ${fmtHora(p.hasta)})?`)) return;
    const batch = S.db.batch();
    batch.update(S.db.doc('cupos/' + cupoId(p.cid, p.fecha, p.tid)), { ['ocupados.' + p.uid]: S.del() });
    batch.delete(S.db.doc('pedidos/' + pid));
    try { await batch.commit(); toast('Turno cancelado'); } catch (e) { console.error(e); toast('No se pudo cancelar. Probá de nuevo.'); }
  }
  S.del = () => (window.__ppamMock ? window.__ppamMock.del() : firebase.firestore.FieldValue.delete());

  /* ---------- Mis turnos ---------- */
  function renderMis() {
    if (!S.user) { $('app').innerHTML = '<div class="card"><div class="empty">Iniciá sesión para ver tus turnos.</div></div><button type="button" class="btn" data-login>Iniciar sesión con Google</button>'; return; }
    const all = Object.keys(S.mis).map(id => Object.assign({ id }, S.mis[id])).sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
    const prox = all.filter(p => p.fecha >= hoy()), pas = all.filter(p => p.fecha < hoy()).reverse();
    let h = prox.length ? prox.map(misCard).join('') : '<div class="card"><div class="empty">No tenés turnos pedidos. Elegí una campaña en el inicio.</div></div>';
    if (pas.length) h += '<div class="sec">Anteriores</div><div class="card">' + pas.slice(0, 20).map(pedidoRow).join('') + '</div>';
    $('app').innerHTML = h;
  }
  function misCard(p) {
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, tp = TIPOS[pt.tipo] || TIPOS.otro;
    const url = pt.nombre && p.estado !== 'rechazado' ? comoLlegarUrl(pt, c) : '';
    let acts = url ? `<a class="go" href="${esc(url)}" target="_blank" rel="noopener">🧭 Cómo llegar</a>` : '';
    if (pt.nombre && tieneLugar(pt)) acts += `<button type="button" class="sbtn ok" data-lugar="${esc(p.cid)}|${esc(p.punto)}">📍 Lugar</button>`;
    if (p.estado !== 'rechazado') acts += `<button type="button" class="sbtn bad x" data-cancelar="${esc(p.id)}">Cancelar</button>`;
    return `<div class="mt"><div class="ph"${fotoAttr(p.cid, (pt.fotos || [])[0])}>${tp[0]}<span class="tag ${esc(p.estado)}">${p.estado === 'confirmado' ? '✓ ' : ''}${esc(ESTADOS[p.estado] || p.estado)}</span></div><div class="b"><div class="when">${esc(cap(fmtDia(p.fecha)))} · ${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))}</div><div class="m">${esc(c.nombre || '')} · ${tp[0]} ${esc(pt.nombre || '')}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</div>${acts ? `<div class="acts">${acts}</div>` : ''}</div></div>`;
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
      if (mias.length === 1 && !S.isAdmin) { go('#/coord/' + mias[0].id); return; }
      let h = S.isAdmin ? '<div class="acts" style="margin:0 0 12px;"><button type="button" class="sbtn pri" data-go="#/admin">⚙️ Administración</button></div>' : '';
      h += mias.length ? '<div class="card">' + mias.map(c => `<button type="button" class="row camp" data-go="#/coord/${esc(c.id)}" style="border-top:1px solid var(--line)"><div class="ic">📋</div><div class="tx"><b>${esc(c.nombre)}</b><small>${esc(c.ciudad || '')} · ${esc(campRango(c))}</small></div></button>`).join('') + '</div>' : '<div class="empty">No coordinás ninguna campaña todavía.</div>';
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
    let h = `<div class="kpis"><div class="kpi${pend.length ? ' w' : ''}"><b>${pend.length}</b><span>por confirmar</span></div><div class="kpi"><b>${total ? Math.round(ocup * 100 / total) : 0}%</b><span>cubierto</span></div><div class="kpi"><b>${personas}</b><span>publicadores</span></div></div>`;
    const tabs = [['pedidos', 'Pedidos'], ['cobertura', 'Cobertura'], ['dia', 'Lista del día'], ['config', 'Configurar']];
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
    return `<div class="row" style="display:block"><b>${esc(p.nombre)} ${esc(p.apellido)} · ${esc(p.congregacion)}</b><small>${esc(cap(fmtDia(p.fecha)))} · ${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))} · ${esc(pt.nombre || '')} · <a href="https://wa.me/${wa.length === 10 ? '549' + wa : wa}" target="_blank" rel="noopener">${esc(p.celular)}</a></small>${acciones ? `<div class="acts">${acciones}</div>` : ''}</div>`;
  }
  function coordPedidos(c, pend, peds) {
    let h = `<div class="sec">Por confirmar</div>`;
    h += pend.length ? '<div class="card">' + pend.map(p => pedidoCoordRow(c, p, `<button type="button" class="sbtn bad" data-rechazar="${esc(p.id)}">No confirmar</button><button type="button" class="sbtn pri" data-confirmar="${esc(p.id)}">Confirmar</button>`)).join('') + '</div>' : '<div class="empty">No hay pedidos nuevos. 👍</div>';
    const conf = peds.filter(p => p.estado === 'confirmado' && p.fecha >= hoy()).sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
    if (conf.length) h += `<div class="sec">Confirmados (${conf.length})</div><div class="card">` + conf.slice(0, 40).map(p => pedidoCoordRow(c, p, `<button type="button" class="sbtn bad" data-quitar="${esc(p.id)}">Quitar del turno</button>`)).join('') + '</div>';
    return h;
  }
  function coordCobertura(c, dias) {
    if (!dias.length) return '<div class="empty">No hay días con turnos por delante. Revisá las fechas y los turnos en Configurar.</div>';
    if (!S.coord.semana || !dias.includes(S.coord.semana)) S.coord.semana = dias[0];
    const i0 = dias.indexOf(S.coord.semana), ds = dias.slice(i0, i0 + 7);
    let h = `<div class="acts" style="margin:0 0 10px;"><button type="button" class="sbtn" data-sem="-7" ${i0 === 0 ? 'disabled' : ''}>‹ Anteriores</button><button type="button" class="sbtn" data-sem="7" ${i0 + 7 >= dias.length ? 'disabled' : ''}>Siguientes ›</button></div>`;
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
    h += `<div class="acts"><button type="button" class="sbtn pri" data-voluntarios>📣 Pedir voluntarios por WhatsApp</button></div><p class="note">Arma un mensaje con los turnos de estos días que todavía no están completos y el link a la campaña.</p>`;
    return h;
  }
  function coordDia(c, dias, peds) {
    if (!dias.length) return '<div class="empty">No hay días con turnos por delante.</div>';
    if (!S.coord.dia || !dias.includes(S.coord.dia)) S.coord.dia = dias[0];
    let h = `<div class="days">${dias.slice(0, 30).map(d => { const x = parseIso(d); return `<button type="button" class="day${d === S.coord.dia ? ' on' : ''}" data-cdia="${d}"><small>${DOW[x.getDay()]}</small><b>${x.getDate()}</b><i>${MES[x.getMonth()].slice(0, 3)}</i></button>`; }).join('')}</div>`;
    const ts = turnosDelDia(c, S.coord.dia);
    h += '<div class="card">' + ts.map(t => {
      const ps = peds.filter(p => p.fecha === S.coord.dia && p.tid === t.id && p.estado === 'confirmado');
      return `<div class="row" style="display:block"><b>${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} · ${esc(c.puntos[t.punto].nombre)}</b><small>${ps.length ? ps.map(p => esc(p.nombre + ' ' + p.apellido) + ' (' + esc(p.congregacion) + ')').join(' · ') : 'Nadie confirmado todavía'} · ${ps.length}/${cupoDe(c, t)}</small></div>`;
    }).join('') + '</div>';
    h += `<div class="acts"><button type="button" class="sbtn pri" data-listadia>📤 Compartir la lista por WhatsApp</button></div>`;
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
    return `*PPAM · ${c.nombre}* (${c.ciudad || ''})\nNecesitamos voluntarios para estos turnos:\n\n${lin.join('\n') || 'Por ahora están todos cubiertos 🙌'}\n\nPedí tu turno acá: ${linkCampana(c)}`;
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
      <div class="lbl">Foto de portada</div><div class="portada"${fotoAttr(c.id, c.portada, `background-color:${colorDe(c)};`)}></div>
      <div class="pills"><label class="sbtn">📷 ${c.portada ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" id="cfFoto" hidden></label>${c.portada ? '<button type="button" class="sbtn bad" id="cfFotoDel">Quitar foto</button>' : ''}</div>
      <p class="small-hint">Una foto apaisada del lugar, sin personas reconocibles. Se achica sola antes de subirse. Sin foto se usa el color de la campaña.</p>
      <div class="fld"><label for="cfNom">Nombre</label><input id="cfNom" value="${esc(c.nombre)}"></div>
      <div class="two"><div class="fld"><label for="cfCiu">Ciudad</label><input id="cfCiu" value="${esc(c.ciudad || '')}"></div><div class="fld"><label for="cfLug">Lugar (opcional)</label><input id="cfLug" value="${esc(c.lugar || '')}"></div></div>
      <div class="two"><div class="fld"><label for="cfDes">Desde</label><input id="cfDes" type="date" value="${esc(c.desde || '')}"></div><div class="fld"><label for="cfHas">Hasta</label><input id="cfHas" type="date" value="${esc(c.hasta || '')}"></div></div>
      <label class="ck"><input type="checkbox" id="cfAct"${c.activa !== false ? ' checked' : ''}> <span>Visible para todos (si la desmarcás, deja de aparecer en el inicio)</span></label>
      <button type="button" class="btn" id="cfSave" style="margin-bottom:10px;">Guardar datos</button></div>`;
    h += `<div class="sec">Puntos <button type="button" class="sbtn" data-punto="">+ Punto</button></div><div class="card">` + (puntos.map(p => `<div class="edit-row"><div><b>${(TIPOS[p.tipo] || TIPOS.otro)[0]} ${esc(p.nombre)}</b><small style="display:block;color:var(--soft);font-size:12px;">${esc((TIPOS[p.tipo] || TIPOS.otro)[1])} · ${cupoDe(c, { punto: p.id })} por turno${p.detalle ? ' · ' + esc(p.detalle) : ''}</small><small style="display:block;font-size:11.5px;color:${tieneUbic(p) ? 'var(--ok)' : 'var(--faint)'};">${tieneUbic(p) ? '📍 Con ubicación' : 'Sin ubicación'}${(p.fotos || []).length ? ' · 📷 ' + p.fotos.length + ((p.fotos.length === 1) ? ' foto' : ' fotos') : ''}</small></div><button type="button" class="sbtn" data-punto="${esc(p.id)}">Editar</button></div>`).join('') || '<div class="empty">Agregá el primer punto (un carrito, un stand…).</div>') + '</div>';
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
      <div class="lbl">Ubicación en el mapa</div>
      <div class="pills"><button type="button" class="sbtn" id="ptGeo">📍 Usar mi ubicación actual</button><button type="button" class="sbtn" id="ptLinkB">🔗 Pegar link de Maps</button></div>
      <div class="fld hidden" id="ptLinkF" style="margin:8px 0 0"><input id="ptLink" placeholder="Pegá acá el link de Google Maps" inputmode="url"></div>
      <div class="okline" id="ptUbi"></div>
      <p class="small-hint">Parado en el lugar, tocá "Usar mi ubicación actual". Si no, en Google Maps buscá el lugar, tocá Compartir → Copiar vínculo y pegalo.</p>
      <div class="lbl">Fotos del lugar (hasta 3)</div><div class="up" id="ptFotos"></div>
      <p class="small-hint">Del lugar, sin personas reconocibles. Se achican solas antes de subirse.</p>
      <div class="fld"><label for="ptInd">Cómo encontrarlo (opcional)</label><textarea id="ptInd" rows="2" placeholder="Entrando por Av. Ramírez, a la derecha, entre las boleterías 4 y 5.">${esc(p.indicaciones || '')}</textarea></div>
      <div class="fld"><label for="ptRet" id="ptRetL">${retiroLabel(p)} (opcional)</label><textarea id="ptRet" rows="2" placeholder="Dónde se busca y se devuelve">${esc(p.retiro || '')}</textarea></div>
      <button type="button" class="btn" id="ptOk">Guardar</button>${pidIn ? '<button type="button" class="btn alt" id="ptDel" style="color:var(--bad)">Borrar este punto</button>' : ''}<button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const q = (s) => ov.querySelector(s);
    function pintarUbi() {
      q('#ptUbi').innerHTML = st.lat != null ? `✓ Ubicación guardada (${st.lat}, ${st.lng}) · <button type="button" class="linkish" id="ptUbiX">quitar</button>`
        : st.mapsUrl ? '✓ Link de Maps guardado · <button type="button" class="linkish" id="ptUbiX">quitar</button>' : '';
      if (q('#ptUbiX')) q('#ptUbiX').addEventListener('click', () => { st.lat = st.lng = null; st.mapsUrl = ''; q('#ptLink').value = ''; pintarUbi(); });
    }
    function pintarFotos() {
      q('#ptFotos').innerHTML = st.fotos.map(f => `<div class="img"${st.nuevas[f] ? ` style="background-image:url('${st.nuevas[f]}')"` : fotoAttr(c.id, f)}><button type="button" data-qf="${esc(f)}" aria-label="Quitar foto">✕</button></div>`).join('') +
        (st.fotos.length < 3 ? '<label class="add">📷<br>Agregar foto<input type="file" accept="image/*" id="ptFile"></label>' : '');
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
      if (g) { st.lat = g.lat; st.lng = g.lng; st.mapsUrl = ''; }
      else if (/^https?:\/\/\S+$/.test(v)) { st.lat = st.lng = null; st.mapsUrl = v.slice(0, 500); }
      pintarUbi();
    });
    q('#ptGeo').addEventListener('click', () => {
      if (!navigator.geolocation) { toast('Este navegador no da la ubicación.'); return; }
      q('#ptGeo').disabled = true; q('#ptGeo').textContent = 'Buscando…';
      navigator.geolocation.getCurrentPosition((pos) => {
        st.lat = +pos.coords.latitude.toFixed(6); st.lng = +pos.coords.longitude.toFixed(6); st.mapsUrl = '';
        q('#ptGeo').disabled = false; q('#ptGeo').textContent = '📍 Usar mi ubicación actual'; pintarUbi();
      }, () => { q('#ptGeo').disabled = false; q('#ptGeo').textContent = '📍 Usar mi ubicación actual'; toast('No se pudo obtener la ubicación. Revisá el permiso del navegador.'); }, { enableHighAccuracy: true, timeout: 15000 });
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
    let h = `<div class="sec">Campañas <button type="button" class="sbtn pri" data-nueva>+ Campaña</button></div><div class="card">`;
    h += cs.map(c => `<div class="edit-row"><div><b>${esc(c.nombre)}</b><small style="display:block;color:var(--soft);font-size:12px;">${esc(c.ciudad || '')} · ${esc(campRango(c))}${c.activa === false ? ' · oculta' : ''}</small><small style="display:block;color:var(--soft);font-size:12px;">Coordinan: ${esc((S.coordEmails[c.id] || []).join(', ') || '—')}</small></div><div style="display:flex;gap:6px;"><button type="button" class="sbtn" data-coords="${esc(c.id)}">Coordinadores</button><button type="button" class="sbtn" data-go="#/coord/${esc(c.id)}">Abrir</button></div></div>`).join('') || '<div class="empty">Creá la primera campaña.</div>';
    h += `</div><div class="sec">Congregaciones</div><div class="card" style="padding:12px 13px;"><p class="note" style="margin:0 0 8px;">Una por renglón, con la ciudad: "San Agustín (Paraná)". Es la lista que eligen los publicadores al pedir un turno.</p><div class="fld"><textarea id="adCongs" rows="8">${esc((S.publico.congregaciones || []).join('\n'))}</textarea></div><button type="button" class="btn" id="adCongsOk">Guardar lista</button></div>`;
    h += `<div class="sec">Administradores</div><div class="card" style="padding:12px 13px;"><p class="note" style="margin:0 0 8px;">Pueden crear campañas y elegir sus coordinadores. Un email por renglón.</p><div class="fld"><textarea id="adAdm" rows="3">${esc(S.admins.join('\n'))}</textarea></div><button type="button" class="btn" id="adAdmOk">Guardar</button></div>`;
    $('app').innerHTML = h;
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
      <p>Iniciás sesión con Google solo para que nadie pueda pedir turnos a tu nombre.</p></div><button type="button" class="btn" data-cerrar>Entendido</button>`);
  }

  /* ---------- Clics ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a[data-go]'); if (!t) return;
    const ds = t.dataset;
    if (t.id === 'backBtn') { const r = S.route; go((r.name === 'coord' && r.cid) || r.name === 'admin' ? '#/coord' : '#/'); return; }
    if (t.id === 'userBtn') {
      if (!S.user) { login(); return; }
      const ov = sheet(`<h3>${esc(S.user.displayName || 'Mi cuenta')}</h3><p class="hint">${esc(S.user.email)}</p><button type="button" class="btn" id="uMis">Mis turnos</button><button type="button" class="btn alt" id="uOut">Cerrar sesión</button>`);
      ov.querySelector('#uMis').addEventListener('click', () => { ov.remove(); go('#/mis'); });
      ov.querySelector('#uOut').addEventListener('click', async () => { ov.remove(); await S.auth.signOut(); go('#/'); });
      return;
    }
    if (t.id === 'coordBtn') { go('#/coord'); return; }
    if (t.id === 'privBtn') { privacidad(); return; }
    if (ds.go) { go(ds.go); return; }
    if (ds.login !== undefined) { login(); return; }
    if (ds.ciudad) { S.ciudad = ds.ciudad; renderHome(); return; }
    if (ds.dia) { S.dia = ds.dia; renderCamp(); return; }
    if (ds.pedir) { pedir(ds.pedir); return; }
    if (ds.mio) { go('#/mis'); return; }
    if (ds.lugar) { const [cid, pid] = ds.lugar.split('|'); verLugar(cid, pid); return; }
    if (ds.copiar) { copiar(ds.copiar); return; }
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

  if ('serviceWorker' in navigator && !window.__ppamMock && location.protocol === 'https:') navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  init();
})();
