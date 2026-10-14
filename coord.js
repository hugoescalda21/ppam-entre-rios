/* =====================================================================
   PPAM Entre Ríos — Coordinación, administración y soporte.
   Se carga solo para coordinadores, administradores y soporte (app.js lo pide con cargarCoord()).
   Recibe de app.js lo que comparte (estado S y funciones comunes) y devuelve sus funciones.
   ===================================================================== */
window.PPAM_COORD = function (K) {
  'use strict';
  const { DOW, parseIso, I, esc, fmtDia, fmtHora, cap, S, ESTADOS, refrescar, $, MES, hoy, go, campRango, colorDe, fotoAttr, diasDe, turnosDelDia, cupoId, cupoDe, isoOf, yaEmpezo, iniciales, sinTilde, modal, busRecientes, busGuardar, sheet, NOTA_MAX, normCel, CEL_ERR, bindCel, toast, fTxt, uidGen, comoLlegarUrl, copiar, minutos, pad, addDays, registrarError, TIPOS, pTxt, linkCampana, fotoKey, render, cargarLeaflet, retiroLabel, VERSION, pantallaLabel } = K;
  const fmtCorto = (s) => { const d = parseIso(s); return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
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
  /* ---------- Días y turnos de una campaña ---------- */
  // Campaña de menos de una semana: los días que realmente tiene ([{ d: día de la semana, n: número de día }]); si dura 7 días o más, null
  function diasCorta(c) {
    if (!c.desde || !c.hasta || c.hasta < c.desde) return null;
    const a = parseIso(c.desde), b = parseIso(c.hasta), r = [];
    for (let x = new Date(a); x <= b && r.length < 8; x.setDate(x.getDate() + 1)) r.push({ d: x.getDay(), n: x.getDate() });
    return r.length < 7 ? r : null;
  }
  function guiaCoord() {
    try { if (localStorage.getItem('ppam-guia-coord')) return ''; } catch (e) { return ''; }
    return `<div class="cguia"><b>${I('star', 'width:16px;height:16px')}Cómo se usa Coordinación</b><ul><li><b>Pedidos:</b> confirmá o no a quien se anotó. Con el botón verde le escribís por WhatsApp.</li><li><b>Del día:</b> quién va a cada punto, y la lista para compartir con el grupo.</li><li><b>La lupa</b> (arriba): buscá un hermano, un punto o un turno, y anotá a alguien que no usa la app.</li></ul><button type="button" class="sbtn" data-cguia>Entendido</button></div>`;
  }
  function pedidoRow(p) {
    const c = S.campanas[p.cid] || {}, pt = (c.puntos || {})[p.punto] || {}, d = parseIso(p.fecha);
    return `<button type="button" class="row" data-go="#/t/${esc(p.id || '')}"><span class="dt${p.estado === 'confirmado' ? ' ok' : ''}"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b></span><span class="tx"><b>${esc(cap(fmtDia(p.fecha)))} · ${esc(fmtHora(p.desde))} a ${esc(fmtHora(p.hasta))}</b><small>${esc(c.nombre || '')} · ${esc(pt.nombre || '')}</small></span><span class="tag ${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</span></button>`;
  }
  const notaHTML = (n, cls) => n ? `<div class="${cls || 'nota'}">${I('edit', 'width:15px;height:15px')}<span><b>Nota:</b> ${esc(n)}</span></div>` : '';
  /* ---------- Historial (auditoría): quién cambió o borró qué y cuándo. Solo se agregan líneas; nadie las edita ---------- */
  function auditar(cid, tipo, texto, extra) {
    if (!S.user) return Promise.resolve();
    const d = Object.assign({ cid: cid || '', tipo, texto: String(texto).slice(0, 400), por: S.user.email.toLowerCase(), uid: S.user.uid, at: S.ahora() }, extra || {});
    return S.db.collection('auditoria').doc(Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).set(d).catch(e => console.error('auditoria', e));
  }
  const difTxt = (a, b) => { const mas = b.filter(x => !a.includes(x)), menos = a.filter(x => !b.includes(x)); return (mas.length ? ': agregó ' + mas.join(', ') : '') + (menos.length ? (mas.length ? '; sacó ' : ': sacó ') + menos.join(', ') : ''); };
  const tTxt = (c, t) => `${fmtHora(t.desde)}–${fmtHora(t.hasta)} del ${((c.puntos || {})[t.punto] || {}).nombre || 'punto'}`;
  const dTxt = (ds) => (ds || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DOW[d]).join(', ');
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
  function abrirBuscadorCoord() {
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
  const enCurso = new Set();
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
  const ER = { centro: [-31.73, -60.53], caja: '-60.85,-30.1,-57.8,-34.1' };
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
  const lev = (a, b) => { if (Math.abs(a.length - b.length) > 2) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const capNombre = (x) => String(x || '').trim().replace(/\s+/g, ' ').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');

  return { renderCoord, renderAdmin, renderSoporte, anotarHermano, restaurar, abrirHistorialGeneral, cambiarEstado, textoVoluntarios, textoDia, copiarHorarios, editarPunto, editarTurno, nuevaCampana, editarCoordinadores, cambiarReporte, abrirBuscadorCoord };
};
