/* =====================================================================
   PPAM Entre Ríos — campañas de predicación pública metropolitana
   ---------------------------------------------------------------------
   Datos (Firestore):
     campanas/{cid}        nombre, ciudad, lugar, desde, hasta, color, activa,
                           puntos {pid: {nombre, tipo, cupo, detalle}},
                           turnos {tid: {punto, desde, hasta, dias[0-6]}}   ← público
     cupos/{cid}__{fecha}__{tid}   {cid, fecha, tid, ocupados {uid: 'p'|'c'}}  ← público, sin datos personales
     pedidos/{cid}__{fecha}__{tid}__{uid}   datos de quien pide (solo lo ven él y los coordinadores)
     coordinadores/{cid}   {emails}          roles/{email}  {campanas: [cid]}
     config/publico        {congregaciones: ['Nombre (Ciudad)'], ciudades: [...]}
     config/admins         {emails}
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
  const COLORES = ['linear-gradient(135deg,#1D4ED8,#3B82F6)', 'linear-gradient(135deg,#0E7490,#22D3EE)', 'linear-gradient(135deg,#059669,#34D399)', 'linear-gradient(135deg,#7C3AED,#DB2777)', 'linear-gradient(135deg,#B45309,#F59E0B)', 'linear-gradient(135deg,#BE123C,#FB7185)'];

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
    cupos: {}, cuposUnsub: null, cuposKey: '',
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
    $('backBtn').classList.toggle('hidden', r.name === 'home');
    const coordCount = S.isAdmin ? Object.keys(S.campanas).length : S.coordDe.length;
    $('coordBtn').classList.toggle('hidden', !(S.user && (S.isAdmin || S.coordDe.length)) || r.name === 'coord' || r.name === 'admin');
    $('coordBtn').textContent = coordCount ? 'Coordinación' : 'Coordinación';
    $('userBtn').textContent = S.user ? (S.user.displayName ? S.user.displayName.split(' ')[0] : 'Mi cuenta') : 'Iniciar sesión';
    let k = 'Predicación pública metropolitana', t = 'PPAM Entre Ríos', s = 'Elegí una campaña, un día y un horario.';
    if (r.name === 'camp' && c) { k = c.ciudad || ''; t = c.nombre; s = campRango(c); }
    else if (r.name === 'mis') { t = 'Mis turnos'; s = 'Los turnos que pediste y su estado.'; }
    else if (r.name === 'coord') { k = 'Coordinación' + (c ? ' · ' + (c.ciudad || '') : ''); t = c ? c.nombre : 'Mis campañas'; s = c ? 'Pedidos, cobertura y listas del día.' : 'Elegí la campaña.'; }
    else if (r.name === 'admin') { k = 'Administración'; t = 'PPAM Entre Ríos'; s = 'Campañas, coordinadores y congregaciones.'; }
    $('tbKicker').textContent = k; $('tbTitle').textContent = t; $('tbSub').textContent = s;
  }
  function campRango(c) {
    if (!c.desde || !c.hasta) return c.lugar || '';
    const a = parseIso(c.desde), b = parseIso(c.hasta);
    return `Del ${a.getDate()} de ${MES[a.getMonth()]} al ${b.getDate()} de ${MES[b.getMonth()]}${c.lugar ? ' · ' + c.lugar : ''}`;
  }
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

  /* ---------- Inicio ---------- */
  function renderHome() {
    const list = Object.values(S.campanas).filter(c => c.activa !== false && (!c.hasta || c.hasta >= hoy()))
      .sort((a, b) => String(a.desde || '').localeCompare(String(b.desde || '')) || String(a.nombre).localeCompare(String(b.nombre)));
    const ciudades = [...new Set(list.map(c => c.ciudad).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    if (S.ciudad !== 'todas' && !ciudades.includes(S.ciudad)) S.ciudad = 'todas';
    const vis = list.filter(c => S.ciudad === 'todas' || c.ciudad === S.ciudad);
    let h = '';
    const misProx = Object.values(S.mis).filter(p => p.fecha >= hoy() && p.estado !== 'rechazado').sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
    if (misProx.length) h += `<div class="sec">Mis próximos turnos <a href="#/mis" style="color:var(--acc-t);text-transform:none;letter-spacing:0;font-size:12.5px;">Ver todos</a></div><div class="card">${misProx.slice(0, 3).map(pedidoRow).join('')}</div>`;
    h += `<div class="sec">Campañas</div>`;
    if (ciudades.length > 1) h += `<div class="chips">${['todas', ...ciudades].map(x => `<button type="button" class="chip${x === S.ciudad ? ' on' : ''}" data-ciudad="${esc(x)}">${x === 'todas' ? 'Todas' : esc(x)}</button>`).join('')}</div>`;
    if (!vis.length) h += '<div class="empty">Todavía no hay campañas publicadas.</div>';
    h += vis.map((c, i) => `<div class="card"><button type="button" class="camp" data-go="#/c/${esc(c.id)}"><div class="ph" style="background:${esc(c.color || COLORES[i % COLORES.length])}"><span>${esc(c.ciudad || '')}</span></div><div class="bd"><b>${esc(c.nombre)}</b><small>${esc(campRango(c))}</small><small>${Object.keys(c.puntos || {}).length} ${Object.keys(c.puntos || {}).length === 1 ? 'punto' : 'puntos'} · ${diasDe(c).length} días con turnos</small></div></button></div>`).join('');
    $('app').innerHTML = h;
  }
  function pedidoRow(p) {
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {};
    return `<div class="row"><div class="ic">${(TIPOS[pt.tipo] || TIPOS.otro)[0]}</div><div class="tx"><b>${esc(cap(fmtDia(p.fecha)))} · ${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))}</b><small>${esc(c.nombre || '')} · ${esc(pt.nombre || '')}</small></div><span class="tag ${esc(p.estado)}">${esc({ pendiente: 'Pendiente', confirmado: 'Confirmado', rechazado: 'No confirmado' }[p.estado] || p.estado)}</span></div>`;
  }

  /* ---------- Campaña ---------- */
  function listenCupos(cid, fecha) {
    const key = cid + '|' + fecha;
    if (S.cuposKey === key) return;
    if (S.cuposUnsub) S.cuposUnsub();
    S.cuposKey = key; S.cupos = {};
    S.cuposUnsub = S.db.collection('cupos').where('cid', '==', cid).where('fecha', '==', fecha).onSnapshot((qs) => {
      const o = {}; qs.forEach(d => { o[d.id] = d.data(); }); S.cupos = o; if (S.route.name === 'camp') renderCamp();
    }, () => {});
  }
  function renderCamp() {
    const c = S.campanas[S.route.cid];
    if (!c) { $('app').innerHTML = '<div class="empty">Esa campaña no existe o ya terminó.</div>'; return; }
    const dias = diasDe(c);
    if (S.diaCid !== c.id || !dias.includes(S.dia)) { S.dia = dias[0]; S.diaCid = c.id; }
    let h = `<div class="sec">Puntos</div><div class="card">${Object.keys(c.puntos || {}).map(pid => { const p = c.puntos[pid], t = TIPOS[p.tipo] || TIPOS.otro; return `<div class="row"><div class="ic">${t[0]}</div><div class="tx"><b>${esc(p.nombre)}</b><small>${esc(t[1])} · ${cupoDe(c, { punto: pid })} por turno${p.detalle ? ' · ' + esc(p.detalle) : ''}</small></div></div>`; }).join('') || '<div class="empty">Sin puntos cargados.</div>'}</div>`;
    if (!dias.length) { $('app').innerHTML = h + '<div class="empty">No hay días con turnos por delante.</div>'; return; }
    listenCupos(c.id, S.dia);
    h += `<div class="sec">Elegí el día</div><div class="days">${dias.map(d => { const x = parseIso(d); return `<button type="button" class="day${d === S.dia ? ' on' : ''}" data-dia="${d}"><small>${DOW[x.getDay()]}</small><b>${x.getDate()}</b><i>${MES[x.getMonth()].slice(0, 3)}</i></button>`; }).join('')}</div>`;
    const ts = turnosDelDia(c, S.dia);
    h += `<div class="sec">Turnos del ${esc(fmtDia(S.dia))}</div><div class="card">`;
    h += ts.map(t => {
      const cu = S.cupos[cupoId(c.id, S.dia, t.id)] || { ocupados: {} };
      const oc = cu.ocupados || {}, n = cupoDe(c, t), vals = Object.values(oc), conf = vals.filter(v => v === 'c').length, pend = vals.length - conf;
      const mio = S.user && oc[S.user.uid];
      const falta = n - vals.length, full = falta <= 0;
      const dots = Array.from({ length: Math.max(n, vals.length) }, (_, k) => `<i class="${k < conf ? 'c' : k < conf + pend ? 'p' : ''}"></i>`).join('');
      const p = c.puntos[t.punto];
      const btn = mio ? `<button type="button" class="sbtn mine" data-mio="${esc(t.id)}">${oc[S.user.uid] === 'c' ? 'Confirmado' : 'Pedido'}</button>`
        : `<button type="button" class="sbtn" data-pedir="${esc(t.id)}" ${full ? 'disabled' : ''}>${full ? 'Completo' : 'Pedir'}</button>`;
      return `<div class="row slot"><div class="h">${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))}</div><div class="tx"><div class="dots">${dots}</div><small>${esc(p.nombre)} · ${full ? 'completo' : falta === 1 ? 'falta 1' : 'faltan ' + falta}</small></div>${btn}</div>`;
    }).join('') || '<div class="empty">No hay turnos ese día.</div>';
    h += `</div><p class="note">Los puntitos llenos son lugares confirmados; los marcados, pedidos por confirmar. Tu pedido queda pendiente hasta que un coordinador lo confirme.</p>`;
    $('app').innerHTML = h;
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
    if (!S.user) { $('app').innerHTML = '<div class="empty">Iniciá sesión para ver tus turnos.</div><button type="button" class="btn" data-login>Iniciar sesión con Google</button>'; return; }
    const all = Object.keys(S.mis).map(id => Object.assign({ id }, S.mis[id])).sort((a, b) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde));
    const prox = all.filter(p => p.fecha >= hoy()), pas = all.filter(p => p.fecha < hoy()).reverse();
    let h = '<div class="sec">Próximos</div>';
    h += prox.length ? '<div class="card">' + prox.map(p => pedidoRow(p) + (p.estado !== 'rechazado' ? `<div style="padding:0 13px 11px;text-align:right;"><button type="button" class="sbtn bad" data-cancelar="${esc(p.id)}">Cancelar</button></div>` : '')).join('') + '</div>' : '<div class="empty">No tenés turnos pedidos. Elegí una campaña en el inicio.</div>';
    if (pas.length) h += '<div class="sec">Anteriores</div><div class="card">' + pas.slice(0, 20).map(pedidoRow).join('') + '</div>';
    $('app').innerHTML = h;
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
      <div class="fld"><label for="cfNom">Nombre</label><input id="cfNom" value="${esc(c.nombre)}"></div>
      <div class="two"><div class="fld"><label for="cfCiu">Ciudad</label><input id="cfCiu" value="${esc(c.ciudad || '')}"></div><div class="fld"><label for="cfLug">Lugar (opcional)</label><input id="cfLug" value="${esc(c.lugar || '')}"></div></div>
      <div class="two"><div class="fld"><label for="cfDes">Desde</label><input id="cfDes" type="date" value="${esc(c.desde || '')}"></div><div class="fld"><label for="cfHas">Hasta</label><input id="cfHas" type="date" value="${esc(c.hasta || '')}"></div></div>
      <label class="ck"><input type="checkbox" id="cfAct"${c.activa !== false ? ' checked' : ''}> <span>Visible para todos (si la desmarcás, deja de aparecer en el inicio)</span></label>
      <button type="button" class="btn" id="cfSave" style="margin-bottom:10px;">Guardar datos</button></div>`;
    h += `<div class="sec">Puntos <button type="button" class="sbtn" data-punto="">+ Punto</button></div><div class="card">` + (puntos.map(p => `<div class="edit-row"><div><b>${(TIPOS[p.tipo] || TIPOS.otro)[0]} ${esc(p.nombre)}</b><small style="display:block;color:var(--soft);font-size:12px;">${esc((TIPOS[p.tipo] || TIPOS.otro)[1])} · ${cupoDe(c, { punto: p.id })} por turno${p.detalle ? ' · ' + esc(p.detalle) : ''}</small></div><button type="button" class="sbtn" data-punto="${esc(p.id)}">Editar</button></div>`).join('') || '<div class="empty">Agregá el primer punto (un carrito, un stand…).</div>') + '</div>';
    h += `<div class="sec">Turnos <button type="button" class="sbtn" data-turno="" ${puntos.length ? '' : 'disabled'}>+ Turno</button></div><div class="card">` + (turnos.map(t => `<div class="edit-row"><div><b>${esc(fmtHora(t.desde))} a ${esc(fmtHora(t.hasta))} · ${esc((c.puntos[t.punto] || {}).nombre || '¿?')}</b><small style="display:block;color:var(--soft);font-size:12px;">${(t.dias || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DOW[d]).join(', ') || 'Ningún día'}</small></div><button type="button" class="sbtn" data-turno="${esc(t.id)}">Editar</button></div>`).join('') || '<div class="empty">Agregá los horarios de cada punto (por ejemplo, 8 a 10, de lunes a sábado).</div>') + '</div>';
    return h;
  }
  const uidGen = () => Math.random().toString(36).slice(2, 9);
  async function guardarCampo(c, path, value, msg) {
    try { await S.db.doc('campanas/' + c.id).update({ [path]: value }); if (msg) toast(msg); return true; }
    catch (e) { console.error(e); toast('No se pudo guardar. Probá de nuevo.'); return false; }
  }
  function bindConfig(c) {
    $('cfSave').addEventListener('click', async () => {
      const d = { nombre: $('cfNom').value.trim(), ciudad: $('cfCiu').value.trim(), lugar: $('cfLug').value.trim(), desde: $('cfDes').value, hasta: $('cfHas').value, activa: $('cfAct').checked };
      if (!d.nombre || !d.desde || !d.hasta) { toast('Completá el nombre y las fechas.'); return; }
      if (d.hasta < d.desde) { toast('La fecha "hasta" es anterior a "desde".'); return; }
      try { await S.db.doc('campanas/' + c.id).update(d); toast('Guardado'); } catch (e) { console.error(e); toast('No se pudo guardar.'); }
    });
  }
  function editarPunto(c, pid) {
    const p = pid ? c.puntos[pid] : { nombre: '', tipo: 'carrito', cupo: 2, detalle: '' };
    const ov = sheet(`<h3>${pid ? 'Editar punto' : 'Nuevo punto'}</h3><p class="hint">Un carrito, un stand o cualquier lugar donde se pone la gente.</p>
      <div class="fld"><label for="ptNom">Nombre</label><input id="ptNom" value="${esc(p.nombre)}" placeholder="Andén 1, Hall central, Plaza…"></div>
      <div class="two"><div class="fld"><label for="ptTipo">Tipo</label><select id="ptTipo">${Object.keys(TIPOS).map(k => `<option value="${k}"${p.tipo === k ? ' selected' : ''}>${TIPOS[k][1]}</option>`).join('')}</select></div>
      <div class="fld"><label for="ptCupo">Personas por turno</label><input id="ptCupo" type="number" min="1" max="20" value="${esc(p.cupo)}"></div></div>
      <div class="fld"><label for="ptDet">Detalle (opcional)</label><input id="ptDet" value="${esc(p.detalle || '')}" placeholder="Frente a boleterías"></div>
      <button type="button" class="btn" id="ptOk">Guardar</button>${pid ? '<button type="button" class="btn alt" id="ptDel" style="color:var(--bad)">Borrar este punto</button>' : ''}<button type="button" class="btn alt" data-cerrar>Cancelar</button>`);
    const q = (s) => ov.querySelector(s);
    q('#ptTipo').addEventListener('change', () => { if (!pid) q('#ptCupo').value = q('#ptTipo').value === 'stand' ? 3 : 2; });
    q('#ptOk').addEventListener('click', async () => {
      const d = { nombre: q('#ptNom').value.trim(), tipo: q('#ptTipo').value, cupo: Math.min(20, Math.max(1, parseInt(q('#ptCupo').value, 10) || 2)), detalle: q('#ptDet').value.trim() };
      if (!d.nombre) { toast('Poné un nombre al punto.'); return; }
      if (await guardarCampo(c, 'puntos.' + (pid || 'p' + uidGen()), d, 'Punto guardado')) ov.remove();
    });
    if (pid) q('#ptDel').addEventListener('click', async () => {
      const usados = Object.values(c.turnos || {}).filter(t => t.punto === pid).length;
      if (!confirm(usados ? `Este punto tiene ${usados} turno(s). Se borran también. ¿Seguir?` : '¿Borrar este punto?')) return;
      const upd = { ['puntos.' + pid]: S.del() };
      Object.keys(c.turnos || {}).forEach(tid => { if (c.turnos[tid].punto === pid) upd['turnos.' + tid] = S.del(); });
      try { await S.db.doc('campanas/' + c.id).update(upd); ov.remove(); toast('Punto borrado'); } catch (e) { toast('No se pudo borrar.'); }
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
        color: COLORES[Object.keys(S.campanas).length % COLORES.length], creada: new Date().toISOString() };
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
