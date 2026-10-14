const fs = require('fs');
// Pruebas de la página (con un Firestore simulado en memoria; sin conexión).
//   node tests/app.test.js
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright/index.js')); }
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = path.resolve(__dirname, 'capturas');
require('fs').mkdirSync(SHOTS, { recursive: true });
let ok = 0, bad = 0; const check = (l, c, x) => { if (c) { ok++; console.log('  ✅', l); } else { bad++; console.log('  ❌', l, x === undefined ? '' : JSON.stringify(x).slice(0, 400)); } };

// Firestore y Auth en memoria (lo mínimo que usa la app).
function mock(seed, users) {
  const store = JSON.parse(JSON.stringify(seed));
  const listeners = new Set();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const DEL = { __del: true };
  const ARR = (op, v) => ({ __arr: op, v });
  const notify = () => setTimeout(() => listeners.forEach(f => f()), 0);
  function setPath(obj, dotted, val) {
    const ks = dotted.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== 'object' || !o[ks[i]]) o[ks[i]] = {}; o = o[ks[i]]; }
    const k = ks[ks.length - 1];
    if (val && val.__del) delete o[k];
    else if (val && val.__arr) { const a = Array.isArray(o[k]) ? o[k] : []; o[k] = val.__arr === 'u' ? [...new Set([...a, val.v])] : a.filter(x => x !== val.v); }
    else o[k] = val;
  }
  function merge(dst, src) {
    Object.keys(src).forEach(k => {
      const v = src[k];
      if (v && v.__del) delete dst[k];
      else if (v && v.__arr) setPath(dst, k, v);
      else if (v && typeof v === 'object' && !Array.isArray(v)) { if (typeof dst[k] !== 'object' || !dst[k] || Array.isArray(dst[k])) dst[k] = {}; merge(dst[k], v); }
      else dst[k] = v;
    });
  }
  const snap = (p) => ({ id: p.split('/').pop(), exists: store[p] !== undefined, data: () => (store[p] === undefined ? undefined : clone(store[p])) });
  const ops = {
    set: (p, d, o) => { if (o && o.merge) { store[p] = store[p] || {}; merge(store[p], clone(d)); } else { store[p] = {}; merge(store[p], clone(d)); } },
    update: (p, d) => { if (store[p] === undefined) throw new Error('not-found'); Object.keys(d).forEach(k => setPath(store[p], k, d[k] && d[k].__del ? d[k] : (d[k] && d[k].__arr ? d[k] : clone(d[k])))); },
    delete: (p) => { delete store[p]; }
  };
  let authCb = null, user = null;
  const deny = (p) => {
    if (p === 'config/admins') { const e = user && user.email; if (!(e === 'hugoescalda@gmail.com' || ((store['config/admins'] || {}).emails || []).includes(e))) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' }); }
  };
  const doc = (p) => ({
    path: p, id: p.split('/').pop(),
    get: async () => { deny(p); return snap(p); },
    set: async (d, o) => { ops.set(p, d, o); window.__writes.push(['set', p]); notify(); },
    update: async (d) => { ops.update(p, d); window.__writes.push(['update', p]); notify(); },
    delete: async () => { ops.delete(p); window.__writes.push(['delete', p]); notify(); },
    onSnapshot: (cb) => { const f = () => cb(snap(p)); listeners.add(f); f(); return () => listeners.delete(f); }
  });
  const col = (p, filters, o) => {
    const lista = () => { let ks = Object.keys(store).filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/') && (filters || []).every(([ff, v, op]) => op === '>=' ? store[k][ff] >= v : store[k][ff] === v)).sort(); if (o && o.desc) ks.reverse(); if (o && o.lim) ks = ks.slice(0, o.lim); return ks.map(snap); };
    return {
      doc: (id) => doc(p + '/' + id),
      where: (f, op, v) => { if (op === '>=' && window.__sinIndice) return Object.assign(col(p, filters, o), { onSnapshot: (a, b, c) => { (typeof a === 'function' ? b : c)(Object.assign(new Error('index'), { code: 'failed-precondition' })); return () => {}; } }); window.__q = (window.__q || []).concat([[p, f, op, v]]); return col(p, [...(filters || []), [f, v, op]], o); },
      orderBy: (f, dir) => col(p, filters, Object.assign({}, o, { desc: dir === 'desc' })),
      limit: (n) => col(p, filters, Object.assign({}, o, { lim: n })),
      get: async () => { const docs = lista(); return { docs, size: docs.length, forEach: (fn) => docs.forEach(fn) }; },
      onSnapshot: (a, b, c) => {
        const cb = typeof a === 'function' ? a : b;
        const f = () => { const docs = lista(); cb({ docs, forEach: (fn) => docs.forEach(fn), metadata: { fromCache: false } }); };
        listeners.add(f); f(); return () => listeners.delete(f);
      }
    };
  };
  const db = {
    doc, collection: (p) => col(p), enablePersistence: async (o) => { window.__persist = o; },
    batch: () => { const q = []; return { set: (r, d, o) => q.push(() => ops.set(r.path, d, o)), update: (r, d) => q.push(() => ops.update(r.path, d)), delete: (r) => q.push(() => ops.delete(r.path)), commit: async () => { q.forEach(f => f()); window.__writes.push(['batch', q.length]); notify(); } }; }
  };
  const auth = { onAuthStateChanged: (cb) => { authCb = cb; setTimeout(() => cb(user), 0); }, signOut: async () => { user = null; authCb(null); } };
  window.__writes = []; window.__store = store; window.__opened = [];
  window.open = (u) => { window.__opened.push(u); return null; };
  window.confirm = () => true;
  window.__ppamMock = { db, auth, del: () => DEL, arr: { arrayUnion: (v) => ARR('u', v), arrayRemove: (v) => ARR('r', v) }, login: async () => { user = users.shift(); authCb(user); } };
}

const SEED = {
  'config/publico': { congregaciones: ['San Agustín (Paraná)', 'Paraná Centro (Paraná)', 'Concordia Norte (Concordia)'] },
  'config/admins': { emails: ['admin@x.com'] },
  'coordinadores/parana-terminal': { emails: ['coord@x.com'] },
  'roles/coord@x.com': { campanas: ['parana-terminal'] },
  'campanas/parana-terminal': { nombre: 'Terminal de ómnibus', ciudad: 'Paraná', lugar: 'Av. Ramírez', desde: '2026-10-01', hasta: '2026-10-31', activa: true, color: 'linear-gradient(135deg,#1D4ED8,#3B82F6)',
    puntos: { p1: { nombre: 'Andén 1', tipo: 'carrito', cupo: 2, detalle: 'Frente a boleterías' }, p2: { nombre: 'Hall central', tipo: 'stand', cupo: 3 } },
    turnos: { t1: { punto: 'p1', desde: '08:00', hasta: '10:00', dias: [1, 2, 3, 4, 5, 6] }, t2: { punto: 'p1', desde: '10:00', hasta: '12:00', dias: [1, 2, 3, 4, 5, 6] }, t3: { punto: 'p2', desde: '16:00', hasta: '18:00', dias: [6] } } },
  'campanas/concordia-costanera': { nombre: 'Costanera', ciudad: 'Concordia', desde: '2026-10-03', hasta: '2026-11-30', activa: true, puntos: { p1: { nombre: 'Plaza del puerto', tipo: 'stand', cupo: 3 } }, turnos: { t1: { punto: 'p1', desde: '09:00', hasta: '11:00', dias: [6, 0] } } },
  'campanas/vieja': { nombre: 'Campaña vieja', ciudad: 'Paraná', desde: '2026-08-01', hasta: '2026-08-31', activa: true, puntos: {}, turnos: {} },
  'cupos/parana-terminal__2026-10-01__t1': { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't1', ocupados: { otro1: 'c', otro2: 'c' } },
  'cupos/parana-terminal__2026-09-02__t1': { cid: 'parana-terminal', fecha: '2026-09-02', tid: 't1', ocupados: { viejo1: 'c' } },
  'cupos/parana-terminal__2026-10-01__t2': { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't2', ocupados: { otro3: 'p' } }
};

(async () => {
  const b = await chromium.launch();
  async function open(users, hash) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await ctx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });   // miércoles 30 de septiembre
    await ctx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await ctx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, ${JSON.stringify(users)})`);
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto(FILE + (hash || '')); await p.waitForTimeout(300);
    return p;
  }
  const text = (p, sel) => p.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);

  console.log('\nPublicador');
  const pub = { uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' };
  let p = await open([pub]);
  let home = await text(p, '#app');
  check('inicio: las campañas vigentes (no la que ya terminó)', /Terminal de ómnibus/.test(home) && /Costanera/.test(home) && !/Campaña vieja/.test(home), home);
  check('cobertura de la primera semana en la tarjeta', /Terminal de ómnibus[\s\S]*11%\s*Faltan 24 lugares en los próximos 7 días/.test(home) && /Costanera[\s\S]*0%\s*Faltan 6 lugares en los próximos 7 días/.test(home), home);
  check('sin sesión: bienvenida con campañas activas y lugares libres de la semana', /Sumate a un turno[\s\S]*2\s*campañas activas\s*\d+\s*lugares libres esta semana\s*Ver turnos libres/.test(home) && await p.evaluate(() => document.getElementById('userBtn').textContent === 'Ingresar'), home.slice(0, 300));
  check('accesibilidad: la pantalla no se relee entera en cada cambio (sin aria-live en <main>)', await p.evaluate(() => !document.getElementById('app').hasAttribute('aria-live') && !document.getElementById('app').hasAttribute('aria-busy') && window.__ppamOk === true && document.getElementById('toast').getAttribute('role') === 'status'));
  {
    const cx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await cx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await cx.route(/gstatic|googleapis|openstreetmap|app\.js/, r => r.abort());
    const q = await cx.newPage(); await q.goto(FILE); await q.waitForTimeout(200);
    check('mientras carga dice "Cargando las campañas…"', /Cargando las campañas…/.test(await text(q, '#app')));
    await q.clock.runFor(13000); await q.waitForTimeout(100);
    check('si no carga en 12 segundos (mala señal): aviso y "Reintentar"', /No pudimos cargar las campañas\.[\s\S]*Reintentar/.test(await text(q, '#app')), await text(q, '#app'));
    await cx.close();
  }
  check('filtro por ciudad', await p.evaluate(() => [...document.querySelectorAll('#fCiudad option')].map(x => x.textContent).join() === 'Toda la provincia,Concordia,Paraná'));
  await p.selectOption('#fCiudad', 'Concordia'); await p.waitForTimeout(50);
  check('filtrando Concordia queda solo la Costanera', await p.evaluate(() => document.querySelectorAll('.camp').length === 1 && /Costanera/.test(document.querySelector('.camp').innerText)));
  check('el contador de campañas sigue al filtro por ciudad', /1\s*campaña activa en Concordia/.test(await text(p, '#app')), await text(p, '#app'));
  await p.selectOption('#fCiudad', 'todas'); await p.waitForTimeout(50);
  await p.click('[data-go="#/c/parana-terminal"]'); await p.waitForTimeout(150);
  check('encabezado con la campaña', /Terminal de ómnibus/.test(await text(p, '#tbTitle')) && /Del 1 de octubre al 31 de octubre/.test(await text(p, '#tbSub')));
  let camp = await text(p, '#app');
  check('turnos agrupados por punto, con detalle y lugares libres (el stand no tiene turnos el jueves)', /Andén 1\s*Frente a boleterías\s*1 libre\s*08:00/.test(camp) && !/Hall central/.test(camp), camp);
  check('resumen del día: puntos y lugares libres', /Jueves 1 de octubre\s*1 carrito · 1 lugar libre\s*Todos\s*Con lugar/.test(camp), camp);
  check('los días marcan cuánto lugar queda (jueves 1: quedan pocos; viernes 2: hay lugar)', await p.evaluate(() => document.querySelector('[data-dia="2026-10-01"]').classList.contains('poco') && document.querySelector('[data-dia="2026-10-02"]').classList.contains('libre')));
  check('días desde el 1 de octubre (no antes), sin domingos', await p.evaluate(() => { const d = [...document.querySelectorAll('.day')].map(x => x.dataset.dia); return d[0] === '2026-10-01' && !d.includes('2026-10-04'); }));
  check('turnos del jueves 1 como botones: completo, falta 1 (uno pedido)', /08:00\s*a 10:00\s*Completo\s*10:00\s*a 12:00\s*Falta 1/.test(camp) && await p.evaluate(() => document.querySelector('[data-pedir="t1"]').disabled && !document.querySelector('[data-pedir="t2"]').disabled && document.querySelectorAll('[data-pedir="t2"] .cs i.p').length === 1), camp);
  await p.click('[data-cf="libres"]'); await p.waitForTimeout(50);
  check('filtro "Con lugar": oculta el horario completo', !(await p.$('[data-pedir="t1"]')) && !!(await p.$('[data-pedir="t2"]')));
  await p.click('[data-cf="todos"]'); await p.click('[data-plegar="p1"]'); await p.waitForTimeout(50);
  check('tocar el carrito lo pliega (queda el encabezado)', !(await p.$('[data-pedir="t2"]')) && /Andén 1[\s\S]*1 libre/.test(await text(p, '#app')));
  await p.click('[data-plegar="p1"]'); await p.waitForTimeout(50);
  check('sin ubicación cargada no aparece "Ver lugar"', !(await p.$('[data-lugar]')));
  await p.click('[data-dia="2026-10-03"]'); await p.waitForTimeout(80);
  camp = await text(p, '#app');
  check('el sábado aparece también el stand (3 lugares)', /Hall central\s*3 libres\s*16:00\s*a 18:00\s*Faltan 3/.test(camp), camp);
  await p.screenshot({ path: SHOTS + '/campana.png' });
  await p.click('[data-pedir="t3"]'); await p.waitForTimeout(80);
  check('sin sesión: pide iniciar sesión primero', /Ingresá para anotarte/.test(await text(p, '.sheet')));
  await p.click('#lgBtn'); await p.waitForTimeout(250);
  check('después de iniciar sesión abre el formulario con su nombre', await p.evaluate(() => document.querySelector('#pNom').value === 'Ana' && document.querySelector('#pApe').value === 'Paz'));
  await p.click('#pGo');
  check('valida la congregación', /Elegí tu congregación/.test(await text(p, '#pErr')));
  await p.selectOption('#pCong', 'San Agustín (Paraná)'); await p.fill('#pCel', '343 555');
  await p.click('#pGo');
  check('valida el celular', /celular/.test(await text(p, '#pErr')));
  for (const [entra, sale] of [['0343 15 555-0000', '343 555-0000'], ['+54 9 343 555 0000', '343 555-0000'], ['3435550000', '343 555-0000'], ['011 15 4444-5555', '11 4444-5555'], ['03446 15 41-2345', '3446 41-2345']]) {
    await p.fill('#pCel', entra); await p.waitForTimeout(20);
    check(`celular "${entra}" se guarda como "${sale}"`, (await text(p, '#pCelOk')) === 'Se guarda como ' + sale, await text(p, '#pCelOk'));
  }
  await p.fill('#pCel', '343 15 555'); await p.waitForTimeout(20);
  check('celular incompleto: avisa que faltan números', /Faltan números/.test(await text(p, '#pCelOk')));
  await p.fill('#pCel', '343 555-0000'); await p.uncheck('#pOk'); await p.click('#pGo');
  check('pide aceptar el uso de los datos', /aceptar/.test(await text(p, '#pErr')));
  await p.check('#pOk');
  await p.screenshot({ path: SHOTS + '/pedir.png' });
  await p.click('#pGo'); await p.waitForTimeout(250);
  const st = await p.evaluate(() => ({ cupo: window.__store['cupos/parana-terminal__2026-10-03__t3'], ped: window.__store['pedidos/parana-terminal__2026-10-03__t3__u-ana'] }));
  check('queda anotada en el cupo como "pedido", sin datos personales', st.cupo && st.cupo.ocupados['u-ana'] === 'p' && !JSON.stringify(st.cupo).includes('Ana'), st.cupo);
  check('el pedido guarda nombre, apellido, congregación y celular', st.ped && st.ped.nombre === 'Ana' && st.ped.apellido === 'Paz' && st.ped.congregacion === 'San Agustín (Paraná)' && st.ped.celular === '343 555-0000' && st.ped.estado === 'pendiente' && st.ped.email === 'ana@x.com', st.ped);
  check('confirmación en pantalla', /Te anotaste/.test(await text(p, '.sheet')));
  check('al anotarse: Agendar, Compartir e Invitar ahí mismo', await p.evaluate(() => !!document.querySelector('.sheet .okacts [data-ics]') && !!document.querySelector('.sheet .okacts [data-comp]') && !!document.querySelector('.sheet .okacts [data-invitar]')));
  await p.click('.sheet .btn.alt[data-cerrar]'); await p.waitForTimeout(80);
  check('el turno ahora dice "Pedido" y faltan 2', /Hall central\s*2 libres\s*16:00\s*a 18:00\s*Pedido/.test(await text(p, '#app')), await text(p, '#app'));
  await p.click('#backBtn'); await p.waitForTimeout(100);
  check('en el inicio: el pase del próximo turno, esperando confirmación', /Tu próximo turno\s*Sáb 3 de octubre\s*Esperando confirmación\s*16:00 – 18:00\s*Faltan 3 días\s*Terminal de ómnibus · Hall central/i.test(await text(p, '#app')), await text(p, '#app'));
  await p.screenshot({ path: SHOTS + '/inicio-turno.png' });
  check('con sesión el botón de la cuenta muestra las iniciales', await p.evaluate(() => document.getElementById('userBtn').textContent === 'AP'));
  await p.evaluate(() => { location.hash = '#/mis'; }); await p.waitForTimeout(100);
  await p.click('[data-cancelar]'); await p.waitForTimeout(100);
  check('cancelar pide confirmar con una explicación', /¿Cancelar este turno\?[\s\S]*Se libera el lugar/.test(await text(p, '.sheet')));
  await p.click('#cxOk'); await p.waitForTimeout(200);
  const st2 = await p.evaluate(() => ({ cupo: window.__store['cupos/parana-terminal__2026-10-03__t3'], ped: window.__store['pedidos/parana-terminal__2026-10-03__t3__u-ana'] }));
  check('cancelar libera el lugar y borra sus datos', !st2.ped && st2.cupo && !('u-ana' in st2.cupo.ocupados), st2);
  check('la cancelación queda en el historial (firmada por quien canceló)', await p.evaluate(() => Object.values(window.__store).some(d => d && d.tipo === 'cancelo' && d.por === 'ana@x.com' && d.cid === 'parana-terminal' && /canceló su turno: Ana Paz · Sáb 3\/10 16–18 · Hall central/.test(d.texto))));
  check('la línea de cancelar lleva el id del pedido (las reglas la validan)', await p.evaluate(() => Object.values(window.__store).some(d => d && d.tipo === 'cancelo' && /^parana-terminal__.+__u-ana$/.test(d.ref || ''))));
  check('sin botón "Coordinación" para un publicador', await p.evaluate(() => document.getElementById('coordBtn').classList.contains('hidden')));
  check('sin errores', p.errs.length === 0, p.errs);
  // Vuelve a pedir para que el coordinador lo vea
  await p.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await p.waitForTimeout(100);
  await p.click('[data-dia="2026-10-03"]'); await p.click('[data-pedir="t3"]'); await p.waitForTimeout(80);
  check('la segunda vez el formulario ya viene completo', await p.evaluate(() => document.querySelector('#pCel').value === '343 555-0000' && document.getElementById('pOk').checked));
  const pedidos = await p.evaluate(async () => { document.getElementById('pGo').click(); await new Promise(r => setTimeout(r, 200)); return JSON.parse(JSON.stringify(window.__store)); });

  console.log('\nCoordinador');
  const SEED2 = pedidos;
  const coordUser = { uid: 'u-co', email: 'coord@x.com', displayName: 'Carlos Vega' };
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires', geolocation: { latitude: -31.73, longitude: -60.52 }, permissions: ['geolocation'] });
  await ctx2.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
  await ctx2.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
  await ctx2.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED2)}, ${JSON.stringify([coordUser])})`);
  // Leaflet desde una copia local y Nominatim simulado (las pruebas no salen a internet)
  const LF = [path.resolve(__dirname, '..', 'node_modules', 'leaflet', 'dist'), path.resolve(__dirname, '..', '..', 'lf', 'package', 'dist')].find(d => require('fs').existsSync(d));
  if (LF) await ctx2.route(/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.(js|css)$/, r => r.fulfill({ path: path.join(LF, r.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js') }));
  const nomis = [];
  await ctx2.route(/nominatim\.openstreetmap\.org/, r => {
    const u = new URL(r.request().url()); nomis.push(u.pathname + '?' + u.searchParams.get('q'));
    const body = u.pathname.includes('reverse') ? { name: '', address: { road: 'Calle Simulada', house_number: '100', city: 'Paraná' } }
      : /Paraná, Entre Ríos/.test(u.searchParams.get('q')) ? [{ lat: '-31.7333', lon: '-60.5297', name: 'Paraná', address: { city: 'Paraná' } }]
      : [{ lat: '-31.7442', lon: '-60.5190', name: 'Plaza 1 de Mayo', display_name: 'Plaza 1 de Mayo, Paraná', address: { road: 'Peatonal San Martín', city: 'Paraná' } }];
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  const c = await ctx2.newPage(); c.errs = []; c.on('pageerror', e => c.errs.push(e.message));
  await c.goto(FILE); await c.waitForTimeout(300);
  await c.click('#userBtn'); await c.waitForTimeout(250);
  check('el coordinador ve "Coordinar" en la barra de abajo', await c.evaluate(() => !document.getElementById('coordBtn').classList.contains('hidden')));
  await c.waitForTimeout(100);
  check('en el inicio, la franja con los pedidos por confirmar', /1\s*Pedido por confirmar\s*Terminal de ómnibus/.test(await text(c, '.coordbar')), await text(c, '.coordbar'));
  await c.click('#coordBtn'); await c.waitForTimeout(250);
  let co = await text(c, '#app');
  check('entra directo a su campaña: 1 por confirmar', /1\s*por confirmar/.test(co) && /Ana Paz\s*San Agustín \(Paraná\)/.test(co) && /343 555-0000/.test(co), co.slice(0, 400));
  check('el celular abre WhatsApp', await c.evaluate(() => /wa\.me\/5493435550000/.test(document.querySelector('#app a[href*="wa.me"]').href)));
  await c.screenshot({ path: SHOTS + '/coordinador.png' });
  await c.click('[data-confirmar]'); await c.waitForTimeout(200);
  const st3 = await c.evaluate(() => ({ cupo: window.__store['cupos/parana-terminal__2026-10-03__t3'], ped: window.__store['pedidos/parana-terminal__2026-10-03__t3__u-ana'] }));
  check('confirmar: el pedido pasa a confirmado y el lugar a "c"', st3.ped.estado === 'confirmado' && st3.ped.por === 'coord@x.com' && st3.cupo.ocupados['u-ana'] === 'c', st3);
  await c.click('[data-tab="cobertura"]'); await c.waitForTimeout(100);
  co = await text(c, '#app');
  check('cobertura: grilla por punto con 2/2 el jueves 1 a las 8', /Andén 1 · carrito, 2 por turno/i.test(co) && await c.evaluate(() => [...document.querySelectorAll('.grid .full')].some(x => x.textContent.startsWith('2/2'))), co.slice(0, 300));
  await c.click('[data-voluntarios]');
  const vol = await c.evaluate(() => decodeURIComponent(window.__opened.pop().split('text=')[1]));
  check('"Pedir voluntarios" arma el mensaje con los turnos que faltan y el link', /Necesitamos voluntarios/.test(vol) && /Jueves 1 de octubre · 10 a 12 · Andén 1 \(falta 1\)/.test(vol) && /#\/c\/parana-terminal/.test(vol), vol.slice(0, 300));
  await c.click('[data-tab="dia"]'); await c.click('[data-cdia="2026-10-03"]'); await c.waitForTimeout(100);
  check('lista del día: Ana en el stand del sábado', /Hall central\s*Faltan 2\s*16 a 18\s*Faltan 2\s*Ana Paz\s*San Agustín \(Paraná\)\s*2 lugares libres/.test(await text(c, '#app')) && /1 confirmados/.test(await text(c, '#app')), await text(c, '#app'));
  await c.click('[data-listadia]');
  const lista = await c.evaluate(() => decodeURIComponent(window.__opened.pop().split('text=')[1]));
  check('compartir la lista del día por WhatsApp', /\*16 a 18 · Hall central\*\n  – Ana Paz/.test(lista), lista);
  check('Del día: WhatsApp de cada hermano', await c.evaluate(() => /wa\.me\/549343/.test(document.querySelector('#dt-t3 .dp.c .wa').href)));
  await c.click('[data-cdia="2026-10-01"]'); await c.click('[data-cdf="faltan"]'); await c.waitForTimeout(80);
  check('filtro "Faltan": oculta el turno completo (8 a 10 del jueves)', !(await c.$('#dt-t1')) && !!(await c.$('#dt-t2')));
  await c.click('[data-cdf="todos"]');
  await c.click('[data-tab="cobertura"]'); await c.waitForTimeout(80);
  await c.click('[data-cir="2026-10-03|t3"]'); await c.waitForTimeout(120);
  check('tocar una casilla de Cobertura abre ese día y turno en "Del día"', await c.evaluate(() => document.querySelector('.tabs .on').dataset.tab === 'dia' && document.querySelector('.day.on').dataset.cdia === '2026-10-03' && document.getElementById('dt-t3').classList.contains('flash')));
  check('la lupa arriba, para el coordinador', await c.evaluate(() => !document.getElementById('busBtn').classList.contains('hidden')));
  await c.click('#busBtn'); await c.waitForTimeout(200);
  check('lupa: atajos antes de escribir', /Por confirmar\s*Faltan hoy\s*Faltan mañana/.test(await text(c, '.bsov')), await text(c, '.bsov'));
  await c.click('[data-bsat="man"]'); await c.waitForTimeout(80);
  check('atajo "Faltan mañana": turnos del jueves 1 con lugar', /Faltan mañana · Jueves 1 de octubre[\s\S]*10 a 12 · Andén 1/i.test(await text(c, '.bsov')) && !/8 a 10 · Andén 1/.test(await text(c, '.bsov')), await text(c, '.bsov'));
  await c.fill('#bsQ', 'ANA paz'); await c.waitForTimeout(250);
  check('lupa: busca hermanos (sin tildes ni mayúsculas) con sus turnos', /HERMANOS\s*AP\s*Ana Paz\s*San Agustín \(Paraná\) · 343 555-0000[\s\S]*SÁB\s*3\s*OCT\s*16 a 18\s*Hall central\s*Confirmado/i.test(await text(c, '#bsR')), await text(c, '#bsR'));
  await c.fill('#bsQ', 'andén'); await c.waitForTimeout(250);
  check('lupa: busca puntos', /PUNTOS\s*Andén 1\s*Frente a boleterías · Terminal de ómnibus · 2 turnos/i.test(await text(c, '#bsR')), await text(c, '#bsR'));
  await c.fill('#bsQ', '10'); await c.waitForTimeout(250);
  check('lupa: un horario trae esos turnos', /TURNOS[\s\S]*10 a 12 · Andén 1/i.test(await text(c, '#bsR')) && !/8 a 10/.test(await text(c, '#bsR')), await text(c, '#bsR'));
  await c.fill('#bsQ', 'terminal'); await c.waitForTimeout(250);
  check('lupa: busca campañas', /CAMPAÑAS\s*Terminal de ómnibus/i.test(await text(c, '#bsR')));
  await c.fill('#bsQ', 'zzz'); await c.waitForTimeout(250);
  check('lupa: un nombre que no está ofrece anotarlo', /No hay nadie con “zzz”\.[\s\S]*Anotar a Zzz/.test(await text(c, '#bsR')), await text(c, '#bsR'));
  await c.fill('#bsQ', '99999'); await c.waitForTimeout(250);
  check('lupa: sin resultados (no es un nombre) lo dice', /Nada con “99999”/.test(await text(c, '#bsR')) && !/Anotar a/.test(await text(c, '#bsR')));
  await c.fill('#bsQ', 'paz'); await c.waitForTimeout(250); await c.click('#bsR [data-bir]'); await c.waitForTimeout(200);
  check('tocar un turno encontrado cierra la lupa y abre "Del día" en ese turno', await c.evaluate(() => !document.querySelector('.bsov') && document.querySelector('.tabs .on').dataset.tab === 'dia' && document.querySelector('.day.on').dataset.cdia === '2026-10-03' && !!document.querySelector('#dt-t3.flash')));
  await c.click('#busBtn'); await c.waitForTimeout(150);
  check('búsquedas recientes', /Búsquedas recientes\s*paz/i.test(await text(c, '.bsov')));
  await c.click('[data-bscerrar]'); await c.waitForTimeout(50);
  await c.click('#dt-t3 [data-anotar]'); await c.waitForTimeout(120);
  check('"Anotar" en un lugar libre abre el formulario del coordinador', /Anotar a un hermano[\s\S]*Sábado 3 de octubre[\s\S]*16:00 – 18:00[\s\S]*Hall central/.test(await text(c, '.sheet')), await text(c, '.sheet'));
  check('el formulario muestra quién ya va en ese turno', /Ya va:\s*Ana Paz \(San Agustín\)/.test(await text(c, '.sheet .sum')), await text(c, '.sheet .sum'));
  await c.fill('#aApe', 'paz'); await c.waitForTimeout(50);
  check('mismo apellido: se marca para revisar si es de la familia', await c.evaluate(() => !!document.querySelector('.sheet .cq.fam') && getComputedStyle(document.querySelector('.sheet .cq.fam .ma')).display !== 'none'));
  await c.fill('#aNom', 'Rosa'); await c.fill('#aApe', 'Díaz'); await c.click('#aGo');
  check('valida la congregación', /Elegí la congregación/.test(await text(c, '#aErr')));
  await c.selectOption('#aCong', 'Paraná Centro (Paraná)'); await c.fill('#aCel', '343 444-1234'); await c.fill('#aNota', 'Avisarle también por teléfono fijo.');
  await c.click('#aGo'); await c.waitForTimeout(200);
  const man = await c.evaluate(() => { const k = Object.keys(window.__store).find(x => x.startsWith('pedidos/parana-terminal__2026-10-03__t3__m-')); const d = k && window.__store[k]; const cu = window.__store['cupos/parana-terminal__2026-10-03__t3'].ocupados; return d && { estado: d.estado, manual: d.manual, por: d.por, uid: d.uid, nota: d.nota, cupo: cu[d.uid], email: 'email' in d }; });
  check('queda confirmado, marcado como manual y ocupa el lugar', man && man.estado === 'confirmado' && man.manual === true && man.por === 'coord@x.com' && man.cupo === 'c' && /^m-[a-z0-9]{6,24}$/.test(man.uid) && !man.email && /fijo/.test(man.nota), man);
  check('pantalla de listo con "Avisarle por WhatsApp"', /Rosa ya tiene su turno[\s\S]*Confirmado[\s\S]*Avisarle por WhatsApp/.test(await text(c, '.sheet')));
  await c.click('#aWa'); await c.waitForTimeout(80);
  const avis = await c.evaluate(() => decodeURIComponent(window.__opened.pop() || ''));
  check('el aviso por WhatsApp va al celular con el turno', /wa\.me\/5493434441234\?text=Hola Rosa, ya tenés tu turno en la PPAM: Sábado 3 de octubre de 16:00 a 18:00 · Hall central — Terminal de ómnibus, Paraná/.test(avis), avis);
  await c.click('.sheet [data-cerrar]'); await c.waitForTimeout(150);
  check('en "Del día" aparece con la marca "cargado por coordinador"', /Rosa Díaz\s*Paraná Centro \(Paraná\) · cargado por coordinador/.test(await text(c, '#dt-t3')), await text(c, '#dt-t3'));
  check('al cerrar, queda en "Del día" con ese turno resaltado', await c.evaluate(() => document.querySelector('.tabs .on').dataset.tab === 'dia' && document.getElementById('dt-t3').classList.contains('flash')));
  await c.click('[data-cdia="2026-10-10"]'); await c.waitForTimeout(100);
  await c.click('#dt-t3 [data-anotar]'); await c.waitForTimeout(120);
  await c.type('#aNom', 'ros'); await c.waitForTimeout(120);
  check('autocompletar: sugiere a Rosa Díaz con sus datos', /Rosa Díaz\s*Paraná Centro \(Paraná\) · 343 444-1234/.test(await text(c, '#aSug')), await text(c, '#aSug'));
  await c.click('#aSug [data-sug="0"]'); await c.waitForTimeout(50);
  check('un toque completa nombre, apellido, congregación y celular', await c.evaluate(() => document.querySelector('#aNom').value === 'Rosa' && document.querySelector('#aApe').value === 'Díaz' && document.querySelector('#aCong').value === 'Paraná Centro (Paraná)' && document.querySelector('#aCel').value === '343 444-1234'));
  await c.click('#aGo'); await c.waitForTimeout(200); await c.click('.sheet [data-cerrar]'); await c.waitForTimeout(200);
  check('vuelve a "Del día" del sábado 10, con Rosa en ese turno', await c.evaluate(() => document.querySelector('.day.on').dataset.cdia === '2026-10-10' && /Rosa Díaz/.test(document.getElementById('dt-t3').innerText)));
  await c.click('#busBtn'); await c.waitForTimeout(150); await c.click('[data-bsat="man"]'); await c.waitForTimeout(100);
  await c.click('[data-banot^="parana-terminal|2026-10-01|"]'); await c.waitForTimeout(150);
  check('"+ Anotar" desde "Faltan mañana" de la lupa abre el formulario de ese turno', /Anotar a un hermano[\s\S]*Jueves 1 de octubre/.test(await text(c, '.sheet')), await text(c, '.sheet'));
  await c.click('#aCancel'); await c.waitForTimeout(150);
  await c.click('#busBtn'); await c.waitForTimeout(150); await c.fill('#bsQ', 'rosa'); await c.waitForTimeout(250);
  await c.click('#bsR [data-bturno]'); await c.waitForTimeout(200);
  check('"+ Turno" desde el hermano: lugares libres por día, y dónde ya está', /Anotar a Rosa Díaz[\s\S]*Jueves 1 de octubre[\s\S]*10 a 12 · Andén 1\s*Falta 1[\s\S]*Sábado 3 de octubre[\s\S]*16 a 18 · Hall central\s*Ya está anotado/i.test(await text(c, '.lgov')), (await text(c, '.lgov')).slice(0, 600));
  check('cada lugar libre dice con quién va', await c.evaluate(() => /Con:\s*Nadie todavía/.test(document.querySelector('.lgr input[value="2026-10-02|t1"]').closest('.lgr').innerText)));
  await c.check('.lgr input[value="2026-10-01|t2"]'); await c.check('.lgr input[value="2026-10-03|t2"]');
  check('marcar varios: "Anotar en 2 turnos"', /Anotar en 2 turnos/.test(await text(c, '#lgGo')));
  await c.click('#lgGo'); await c.waitForTimeout(250);
  check('listo: "Rosa ya tiene 2 turnos"', /Rosa ya tiene 2 turnos[\s\S]*Jueves 1 de octubre · 10:00 a 12:00 · Andén 1[\s\S]*Sábado 3 de octubre · 10:00 a 12:00 · Andén 1/.test(await text(c, '.sheet')), await text(c, '.sheet'));
  const rosa = await c.evaluate(() => Object.values(window.__store).filter(d => d && d.nombre === 'Rosa' && d.manual).map(d => d.uid));
  check('reusa el mismo hermano (un solo id) en todos sus turnos', rosa.length === 4 && new Set(rosa).size === 1, rosa);
  await c.click('#aWa'); await c.waitForTimeout(80);
  const av2 = await c.evaluate(() => decodeURIComponent(window.__opened.pop() || ''));
  check('un solo WhatsApp con la lista de turnos', /ya tenés tus turnos en la PPAM \(Terminal de ómnibus, Paraná\):\n• Jueves 1 de octubre, 10:00 a 12:00 · Andén 1 \(Frente a boleterías\)\n• Sábado 3 de octubre, 10:00 a 12:00 · Andén 1 \(Frente a boleterías\)/.test(av2), av2);
  await c.click('.sheet [data-cerrar]'); await c.waitForTimeout(100);
  await c.click('#busBtn'); await c.waitForTimeout(150); await c.fill('#bsQ', 'rosa dias'); await c.waitForTimeout(250);
  check('lupa: con un error de tipeo muestra parecidos ("¿Es alguno de estos?")', /No hay nadie con “rosa dias”\. ¿Es alguno de estos\?[\s\S]*No, anotar a alguien nuevo[\s\S]*PARECIDOS\s*RD\s*Rosa Díaz/i.test(await text(c, '#bsR')), await text(c, '#bsR'));
  await c.fill('#bsQ', 'juan pérez'); await c.waitForTimeout(250);
  await c.click('#bsR [data-bnuevo]'); await c.waitForTimeout(150);
  check('"Anotar a Juan Pérez": el formulario viene con nombre y apellido', await c.evaluate(() => document.querySelector('#nNom').value === 'Juan' && document.querySelector('#nApe').value === 'Pérez'));
  await c.click('#nGo'); await c.waitForTimeout(50);
  check('pide la congregación', /Elegí la congregación/.test(await text(c, '#nErr')));
  await c.selectOption('#nCong', 'San Agustín (Paraná)'); await c.click('#nGo'); await c.waitForTimeout(200);
  check('después, la lista de lugares libres para Juan', /Anotar a Juan Pérez\s*San Agustín \(Paraná\)\. Marcá uno o varios/.test(await text(c, '.lgov')), (await text(c, '.lgov')).slice(0, 200));
  await c.check('.lgr input[value="2026-10-02|t1"]'); await c.click('#lgGo'); await c.waitForTimeout(250);
  const juan = await c.evaluate(() => Object.values(window.__store).filter(d => d && d.nombre === 'Juan' && d.apellido === 'Pérez' && d.manual).map(d => d.fecha + '|' + d.tid + '|' + d.estado));
  check('Juan queda anotado y confirmado', JSON.stringify(juan) === '["2026-10-02|t1|confirmado"]' && /Juan ya tiene su turno/.test(await text(c, '.sheet')) && /Copiar el mensaje/.test(await text(c, '.sheet')), juan);
  await c.click('.sheet [data-cerrar]'); await c.waitForTimeout(100);
  // Configurar: un punto nuevo y turnos en serie
  await c.click('[data-tab="config"]'); await c.waitForTimeout(100);
  await c.click('[data-punto=""]'); await c.fill('#ptNom', 'Salida Av. Ramírez'); await c.click('#ptOk'); await c.waitForTimeout(150);
  const pts = await c.evaluate(() => Object.values(window.__store['campanas/parana-terminal'].puntos).map(x => x.nombre + ':' + x.cupo + ':' + x.tipo));
  check('agrega un punto (carrito, 2 por turno)', pts.includes('Salida Av. Ramírez:2:carrito'), pts);
  await c.click('[data-turno=""]'); await c.waitForTimeout(80);
  await c.selectOption('#tuPto', { label: 'Salida Av. Ramírez' }); await c.fill('#tuDes', '14:00'); await c.fill('#tuHas', '16:00');
  await c.check('#tuMas'); await c.fill('#tuFin', '20:00'); await c.click('#tuOk'); await c.waitForTimeout(150);
  const ts = await c.evaluate(() => { const cp = window.__store['campanas/parana-terminal']; const pid = Object.keys(cp.puntos).find(k => cp.puntos[k].nombre === 'Salida Av. Ramírez'); return Object.values(cp.turnos).filter(t => t.punto === pid).map(t => t.desde + '-' + t.hasta).sort(); });
  check('"crear los siguientes": 14–16, 16–18 y 18–20 de una vez', JSON.stringify(ts) === '["14:00-16:00","16:00-18:00","18:00-20:00"]', ts);
  check('sin turnos repetidos no hay aviso', !(await c.$('#avRep')));
  await c.click('[data-turno=""]'); await c.waitForTimeout(80);
  await c.selectOption('#tuPto', { label: 'Salida Av. Ramírez' }); await c.fill('#tuDes', '14:00'); await c.fill('#tuHas', '16:00'); await c.click('#tuOk'); await c.waitForTimeout(150);
  check('turno repetido: aviso y los dos marcados', /Hay un turno repetido/.test(await text(c, '#avRep')) && await c.evaluate(() => document.querySelectorAll('.tchip.rep').length === 2), await text(c, '#app'));
  const dupId = await c.evaluate(() => { const t = window.__store['campanas/parana-terminal'].turnos; return Object.keys(t).filter(id => t[id].desde === '14:00' && t[id].hasta === '16:00').pop(); });
  c.once('dialog', d => d.accept());
  await c.click(`[data-turno="${dupId}"]`); await c.waitForTimeout(80); await c.click('#tuDel'); await c.waitForTimeout(150);
  check('al borrar el repetido desaparece el aviso', !(await c.$('#avRep')), await text(c, '#app'));
  await c.click('[data-aj="hist"]'); await c.waitForTimeout(150);
  const hi = await text(c, '.card.hist');
  check('Historial: quién borró el turno, qué y cuándo', /coord@x\.com borró el turno 14–16 del Salida Av\. Ramírez \(Lun, Mar, Mié, Jue, Vie, Sáb\)\s*(recién|hace \d+ min)\s*Restaurar/.test(hi) && /coord@x\.com creó 3 turnos 14–16, 16–18, 18–20 del Salida Av\. Ramírez/.test(hi) && /coord@x\.com creó el punto Salida Av\. Ramírez/.test(hi), hi.slice(0, 500));
  const lin = await c.evaluate(() => Object.values(window.__store).filter(d => d && d.tipo === 'borro_turno').map(d => ({ por: d.por, uid: d.uid, cid: d.cid, ref: d.ref, antes: !!d.antes, at: typeof d.at })));
  check('la línea queda firmada, con la campaña y lo que había antes', lin.length === 1 && lin[0].por === 'coord@x.com' && lin[0].cid === 'parana-terminal' && /^turno:/.test(lin[0].ref) && lin[0].antes, lin);
  await c.click('[data-hf="borr"]'); await c.waitForTimeout(80);
  check('filtro "Solo borrados y quitados"', /borró el turno/.test(await text(c, '.card.hist')) && !/creó/.test(await text(c, '.card.hist')));
  await c.click('[data-hf="todo"]'); await c.waitForTimeout(50);
  await c.click('.card.hist [data-restaurar]'); await c.waitForTimeout(250);
  const rest = await c.evaluate((id) => !!window.__store['campanas/parana-terminal'].turnos[id], dupId);
  check('"Restaurar" devuelve el turno borrado y queda anotado', rest && /coord@x\.com restauró el turno 14–16 del Salida Av\. Ramírez/.test(await text(c, '.card.hist')) && /restaurado/.test(await text(c, '.card.hist')) && !(await c.$('.card.hist [data-restaurar]')), await text(c, '.card.hist'));
  await c.click('[data-aj="puntos"]'); await c.waitForTimeout(100);
  c.once('dialog', d => d.accept());
  await c.click(`[data-turno="${dupId}"]`); await c.waitForTimeout(80); await c.click('#tuDel'); await c.waitForTimeout(150);
  const salida = await c.evaluate(() => { const cp = window.__store['campanas/parana-terminal']; return Object.keys(cp.puntos).find(k => cp.puntos[k].nombre === 'Salida Av. Ramírez'); });
  await c.click(`[data-tpto="${salida}"]`); await c.waitForTimeout(80);
  check('"+ Turno" de un punto: viene elegido y sigue al último (20 a 22, mismos días)', await c.evaluate((pid) => document.querySelector('#tuPto').value === pid && document.querySelector('#tuDes').value === '20:00' && document.querySelector('#tuHas').value === '22:00' && [...document.querySelectorAll('.wd input:checked')].map(x => x.value).join() === '1,2,3,4,5,6', salida));
  await c.click('.ov [data-cerrar]'); await c.waitForTimeout(80);
  // Ubicación y fotos de un punto
  const ICON = path.resolve(__dirname, '..', 'icon-192.png');
  await c.click('[data-punto="p1"]'); await c.waitForTimeout(80);
  await c.fill('#ptDir', 'Av. Ramírez 2598');
  await c.click('#ptLinkB'); await c.fill('#ptLink', 'https://www.google.com/maps/place/Terminal/@-31.7401,-60.5202,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-31.741234!4d-60.523678');
  check('pegar un link de Google Maps toma el punto exacto del lugar', /Ubicación marcada \(-31\.741234, -60\.523678\)/.test(await text(c, '#ptUbi')), await text(c, '#ptUbi'));
  await c.fill('#ptInd', 'Entrando por Av. Ramírez, a la derecha.'); await c.fill('#ptRet', 'Oficina de administración, planta baja.');
  await c.setInputFiles('#ptFile', ICON); await c.waitForTimeout(400);
  check('la foto nueva aparece en el formulario', await c.evaluate(() => document.querySelectorAll('#ptFotos .img').length === 1));
  await c.click('#ptOk'); await c.waitForTimeout(250);
  const p1 = await c.evaluate(() => { const cp = window.__store['campanas/parana-terminal']; const pt = cp.puntos.p1; const f = pt.fotos && window.__store['fotos/parana-terminal__' + pt.fotos[0]]; return { pt, f: f && { cid: f.cid, ini: f.data.slice(0, 23), largo: f.data.length } }; });
  check('guarda dirección, ubicación, indicaciones y retiro del punto', p1.pt.direccion === 'Av. Ramírez 2598' && p1.pt.lat === -31.741234 && p1.pt.lng === -60.523678 && /a la derecha/.test(p1.pt.indicaciones) && /planta baja/.test(p1.pt.retiro) && p1.pt.nombre === 'Andén 1' && p1.pt.cupo === 2, p1.pt);
  check('la foto se guarda achicada como JPEG en fotos/{campaña}__{id}', p1.f && p1.f.cid === 'parana-terminal' && p1.f.ini === 'data:image/jpeg;base64,' && p1.f.largo < 440000, p1.f);
  check('la lista de puntos muestra que tiene ubicación y foto', /Andén 1[\s\S]*Marcado en el mapa · 1 foto/.test(await text(c, '#app')));
  await c.click('[data-punto="p2"]'); await c.waitForTimeout(80);
  await c.click('#ptLinkB'); await c.fill('#ptLink', 'https://maps.app.goo.gl/AbCd123XyZ');
  check('un link corto de Maps se guarda como link', /Link de Maps guardado/.test(await text(c, '#ptUbi')));
  await c.click('#ptOk'); await c.waitForTimeout(200);
  check('…y queda en el punto', await c.evaluate(() => window.__store['campanas/parana-terminal'].puntos.p2.mapsUrl === 'https://maps.app.goo.gl/AbCd123XyZ'));
  await c.click('[data-punto="' + await c.evaluate(() => { const cp = window.__store['campanas/parana-terminal']; return Object.keys(cp.puntos).find(k => cp.puntos[k].nombre === 'Salida Av. Ramírez'); }) + '"]'); await c.waitForTimeout(80);
  await c.click('#ptGeo'); await c.waitForTimeout(300);
  check('"Usar mi ubicación actual" toma el GPS del celular', /Ubicación marcada \(-31\.73, -60\.52\)/.test(await text(c, '#ptUbi')), await text(c, '#ptUbi'));
  await c.click('.sheet [data-cerrar]'); await c.waitForTimeout(80);
  // Marcar en el mapa
  await c.click('[data-punto=""]'); await c.waitForTimeout(600);
  await c.fill('#ptNom', 'Plaza 1 de Mayo');
  check('el editor del punto trae un mapa (centrado en la ciudad o en otro punto ya marcado)', await c.evaluate(() => !!document.querySelector('#ptMap.leaflet-container') && !!document.querySelector('#ptMap .leaflet-tile-pane')));
  await c.click('#ptMap', { position: { x: 120, y: 90 } }); await c.waitForTimeout(400);
  check('tocar el mapa marca el punto con un pin', /Ubicación marcada \(-31\.\d+, -60\.\d+\)/.test(await text(c, '#ptUbi')) && await c.evaluate(() => !!document.querySelector('#ptMap .pinx')), await text(c, '#ptUbi'));
  check('…y completa sola la dirección', await c.evaluate(() => document.getElementById('ptDir').value === 'Calle Simulada 100, Paraná'));
  await c.click('#ptFull'); await c.waitForTimeout(600);
  check('"Buscar en el mapa" abre el mapa en pantalla completa', await c.evaluate(() => !!document.querySelector('.mapfull #mfMap.leaflet-container')));
  await c.fill('#mfQ', 'plaza 1 de mayo'); await c.press('#mfQ', 'Enter'); await c.waitForTimeout(300);
  check('busca en Entre Ríos y sugiere lugares', /Plaza 1 de Mayo · Peatonal San Martín, Paraná/.test(await text(c, '#mfRes')) && nomis.some(x => /search\?plaza 1 de mayo, Paraná/.test(x)), [await text(c, '#mfRes'), nomis]);
  await c.screenshot({ path: SHOTS + '/buscar-mapa.png' });
  await c.click('[data-mf-r="0"]'); await c.waitForTimeout(200); await c.click('#mfOk'); await c.waitForTimeout(200);
  check('"Usar este lugar" deja marcado el lugar elegido y cambia la dirección automática', /Ubicación marcada \(-31\.7442, -60\.519\)/.test(await text(c, '#ptUbi')) && await c.evaluate(() => document.getElementById('ptDir').value === 'Peatonal San Martín, Paraná' && !document.querySelector('.mapfull')), await text(c, '#ptUbi'));
  await c.screenshot({ path: SHOTS + '/marcar-mapa.png' });
  await c.click('#ptOk'); await c.waitForTimeout(200);
  check('se guarda el punto con la ubicación del mapa', await c.evaluate(() => Object.values(window.__store['campanas/parana-terminal'].puntos).some(p => p.nombre === 'Plaza 1 de Mayo' && p.lat === -31.7442 && p.lng === -60.519 && p.direccion === 'Peatonal San Martín, Paraná')));
  const plaza = await c.evaluate(() => { const cp = window.__store['campanas/parana-terminal']; return Object.keys(cp.puntos).find(k => cp.puntos[k].nombre === 'Plaza 1 de Mayo'); });
  await c.click(`[data-cph="${plaza}"]`); await c.waitForTimeout(100);
  await c.click('[data-de="p2"]'); await c.waitForTimeout(150);
  check('"Copiar los horarios de otro punto" carga sus turnos', await c.evaluate((pid) => JSON.stringify(Object.values(window.__store['campanas/parana-terminal'].turnos).filter(t => t.punto === pid).map(t => t.desde + '-' + t.hasta + ':' + t.dias.join())) === '["16:00-18:00:6"]', plaza));
  // Foto de portada (pestaña Campaña)
  check('Ajustes abre en "Puntos y turnos", con cada punto y sus turnos', !(await c.$('#cfSave')) && /Andén 1[\s\S]*\d+ TURNOS?[\s\S]*08:00–10:00/i.test(await text(c, '#app')), await text(c, '#app'));
  await c.click('[data-aj="campana"]'); await c.waitForTimeout(100);
  await c.setInputFiles('#cfFoto', ICON); await c.waitForTimeout(500);
  const port = await c.evaluate(() => { const cp = window.__store['campanas/parana-terminal']; return { id: cp.portada, f: !!window.__store['fotos/parana-terminal__' + cp.portada] }; });
  check('sube la foto de portada', /^portada-/.test(port.id || '') && port.f, port);
  check('y la muestra en la configuración', await c.evaluate(() => /url\(/.test(document.querySelector('.portada').style.backgroundImage) && /Cambiar foto/.test(document.getElementById('app').innerText)));
  await c.screenshot({ path: SHOTS + '/configurar.png' });
  check('sin errores (coordinador)', c.errs.length === 0, c.errs);
  const SEED3 = await c.evaluate(() => JSON.parse(JSON.stringify(window.__store)));

  console.log('\nPublicador: el lugar');
  const ctx3 = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
  await ctx3.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
  await ctx3.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
  await ctx3.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED3)}, ${JSON.stringify([pub])})`);
  const v = await ctx3.newPage(); v.errs = []; v.on('pageerror', e => v.errs.push(e.message));
  await v.goto(FILE); await v.waitForTimeout(400);
  check('la tarjeta de la campaña muestra la foto de portada', await v.evaluate(() => /url\(/.test(document.querySelector('[data-go="#/c/parana-terminal"] .th').style.backgroundImage)));
  await v.screenshot({ path: SHOTS + '/inicio.png' });
  await v.click('[data-go="#/c/parana-terminal"]'); await v.waitForTimeout(300);
  check('el banner de la campaña es la foto', await v.evaluate(() => document.getElementById('tb').classList.contains('foto') && /url\(/.test(document.getElementById('tb').style.backgroundImage)));
  check('el punto muestra la miniatura y "Ver lugar"', await v.evaluate(() => /url\(/.test(document.querySelector('.pt .th').style.backgroundImage) && !!document.querySelector('[data-lugar="parana-terminal|p1"]')));
  await v.screenshot({ path: SHOTS + '/campana.png' });
  await v.click('[data-lugar="parana-terminal|p1"]'); await v.waitForTimeout(300);
  const lug = await v.evaluate(() => { const s = document.querySelector('.sheet'); return { t: s.innerText, map: (s.querySelector('iframe') || {}).src || '', go: (s.querySelector('a.go') || {}).href || '', fotos: s.querySelectorAll('.fotos div').length }; });
  check('"Ver lugar": fotos, dirección, indicaciones y retiro del carrito', lug.fotos === 1 && /Av\. Ramírez 2598/.test(lug.t) && /Cómo encontrarlo\s*Entrando por/i.test(lug.t) && /Retiro del carrito\s*Oficina/i.test(lug.t), lug.t);
  check('mapa de OpenStreetMap con el punto marcado', /openstreetmap\.org\/export\/embed\.html\?bbox=.*marker=-31\.741234,-60\.523678/.test(lug.map), lug.map);
  check('"Cómo llegar" abre Google Maps con el recorrido hasta el punto', lug.go === 'https://www.google.com/maps/dir/?api=1&destination=-31.741234,-60.523678', lug.go);
  await v.screenshot({ path: SHOTS + '/lugar.png' });
  await v.click('.sheet [data-cerrar]'); await v.waitForTimeout(80);
  await v.click('[data-dia="2026-10-03"]'); await v.waitForTimeout(100);
  await v.click('[data-lugar="parana-terminal|p2"]'); await v.waitForTimeout(150);
  check('con un link corto, "Cómo llegar" usa ese link', await v.evaluate(() => document.querySelector('.sheet a.go').href === 'https://maps.app.goo.gl/AbCd123XyZ'));
  await v.click('.sheet [data-cerrar]');
  await v.click('#userBtn'); await v.waitForTimeout(250);
  await v.evaluate(() => { location.hash = '#/mis'; }); await v.waitForTimeout(250);
  const mis = await v.evaluate(() => { const m = document.querySelector('.tc'); return m && { t: m.innerText, all: document.getElementById('app').innerText, go: (m.querySelector('a.go') || {}).href || '', lugar: !!m.querySelector('[data-go^="#/t/"]'), cancelar: !!m.querySelector('[data-cancelar]'), foto: !!m.querySelector('.thumb') }; });
  check('"Mis turnos": resumen del mes, próximos con hojita de calendario, Cómo llegar, Detalle y Cancelar', mis && /Confirmado/.test(mis.t) && /SÁB\s*3\s*oct\s*16:00 – 18:00\s*Terminal de ómnibus · Hall central · Paraná\s*Confirmado\s*Cómo llegar\s*Detalle\s*Cancelar/i.test(mis.t) && mis.cancelar && /1\s*turno en octubre\s*2 h\s*de predicación\s*0\s*por confirmar/.test(mis.all) && /Próximos\s*1/i.test(mis.all) && /Anotarme en otro turno/.test(mis.all) && mis.go === 'https://maps.app.goo.gl/AbCd123XyZ' && mis.lugar, mis);
  await v.screenshot({ path: SHOTS + '/mis-turnos.png' });
  await v.click('.tc [data-go^="#/t/"]'); await v.waitForTimeout(250);
  const det = await v.evaluate(() => ({ t: document.getElementById('app').innerText, llegar: (document.querySelector('.grid4 a.pr') || {}).href || '', hash: location.hash }));
  check('detalle del turno: estado, día y horario, y las cuatro acciones', /Confirmado por un coordinador\s*Sábado 3 de octubre · 16:00 a 18:00/.test(det.t) && /Llegar\s*Agendar\s*Compartir\s*Cancelar/.test(det.t) && det.llegar === 'https://maps.app.goo.gl/AbCd123XyZ' && /^#\/t\//.test(det.hash), det);
  await v.screenshot({ path: SHOTS + '/detalle.png' });
  await v.click('[data-ics]'); await v.waitForTimeout(100);
  const ics = await v.evaluate(() => window.__ppam.ultimoIcs || '');
  check('"Agendar" arma el evento para el calendario (con aviso 1 h antes)', /DTSTART:20261003T160000/.test(ics) && /DTEND:20261003T180000/.test(ics) && /SUMMARY:PPAM · Hall central \(Terminal de ómnibus\)/.test(ics) && /TRIGGER:-PT1H/.test(ics), ics);
  await v.click('[data-comp]'); await v.waitForTimeout(100);
  const comp = await v.evaluate(() => decodeURIComponent((window.__opened.pop() || '').split('text=')[1] || ''));
  check('"Compartir" arma el mensaje del turno', /Tengo turno en la PPAM: Sábado 3 de octubre de 16:00 a 18:00 · Hall central \(Terminal de ómnibus, Paraná\)/.test(comp), comp);
  await v.click('[data-invitar]'); await v.waitForTimeout(80);
  const inv = await v.evaluate(() => decodeURIComponent((window.__opened.pop() || '').split('text=')[1] || ''));
  check('"Invitar a alguien": WhatsApp con el link directo a ese turno', /Me anoté en la PPAM: Sábado 3 de octubre de 16:00 a 18:00 · Hall central \(Terminal de ómnibus, Paraná\)\. ¿Venís conmigo\? Anotate acá: .*#\/c\/parana-terminal\/2026-10-03\/t3$/.test(inv), inv);
  check('la lupa también para los hermanos', await v.evaluate(() => !document.getElementById('busBtn').classList.contains('hidden')));
  await v.click('#busBtn'); await v.waitForTimeout(150);
  check('lupa de hermanos: atajos de lugares (no de personas)', /Con lugar hoy\s*Con lugar mañana/.test(await text(v, '.bsov')) && !/Por confirmar/.test(await text(v, '.bsov')));
  await v.fill('#bsQ', 'anden'); await v.waitForTimeout(250);
  const lu = await text(v, '#bsR');
  check('busca un lugar: sus próximos horarios con lugar', /ANDÉN 1 · TERMINAL DE ÓMNIBUS[\s\S]*8 a 10 · Andén 1[\s\S]*Quedan? \d/i.test(lu), lu.slice(0, 300));
  await v.fill('#bsQ', 'paz'); await v.waitForTimeout(250);
  check('NO busca personas (privacidad)', /No encontramos lugares con “paz”/.test(await text(v, '#bsR')) && !/Ana Paz/.test(await text(v, '#bsR')));
  await v.fill('#bsQ', 'anden'); await v.waitForTimeout(250);
  await v.click('#bsR [data-bpedir="parana-terminal|2026-10-02|t1"]'); await v.waitForTimeout(300);
  check('tocar un lugar abre "Confirmá tu turno" de ese día y horario', /Confirmá tu turno[\s\S]*Viernes 2 de octubre[\s\S]*08:00 – 10:00[\s\S]*Andén 1/.test(await text(v, '.sheet')) && await v.evaluate(() => location.hash === '#/c/parana-terminal'), await text(v, '.sheet'));
  await v.click('.sheet [data-cerrar]'); await v.waitForTimeout(80);
  await v.evaluate(() => { location.hash = '#/c/parana-terminal/2026-10-03/t2'; }); await v.waitForTimeout(400);
  check('el link de invitación abre ese turno listo para anotarse', /Confirmá tu turno[\s\S]*Sábado 3 de octubre[\s\S]*10:00 – 12:00/.test(await text(v, '.sheet')) && await v.evaluate(() => document.querySelector('.day.on').dataset.dia === '2026-10-03'), await text(v, '.sheet'));
  await v.click('.sheet [data-cerrar]'); await v.waitForTimeout(80);
  check('sin errores (el lugar)', v.errs.length === 0, v.errs);

  // Quitar la foto del punto
  await c.click('[data-aj="puntos"]'); await c.waitForTimeout(80);
  await c.click('[data-punto="p1"]'); await c.waitForTimeout(80);
  const fotoId = await c.evaluate(() => window.__store['campanas/parana-terminal'].puntos.p1.fotos[0]);
  await c.click('[data-qf]'); await c.click('#ptOk'); await c.waitForTimeout(200);
  check('quitar la foto la borra de la base', await c.evaluate((f) => !window.__store['fotos/parana-terminal__' + f] && !window.__store['campanas/parana-terminal'].puntos.p1.fotos && window.__store['campanas/parana-terminal'].puntos.p1.lat === -31.741234, fotoId));

  console.log('\nAdministrador');
  const a = await open([{ uid: 'u-ad', email: 'admin@x.com', displayName: 'Admin' }], '#/admin');
  await a.click('#userBtn'); await a.waitForTimeout(300);
  check('ve la administración', /Campañas[\s\S]*Congregaciones[\s\S]*Administradores/i.test(await text(a, '#app')));
  await a.screenshot({ path: SHOTS + '/admin.png', fullPage: true });
  await a.click('[data-nueva]'); await a.fill('#ncNom', 'Plaza San Martín'); await a.fill('#ncCiu', 'Gualeguaychú'); await a.click('#ncOk'); await a.waitForTimeout(200);
  const nueva = await a.evaluate(() => Object.keys(window.__store).find(k => k.startsWith('campanas/gualeguaychu-plaza-san-martin')));
  check('crea una campaña y va a configurarla', !!nueva && /#\/coord\/gualeguaychu-plaza-san-martin/.test(await a.evaluate(() => location.hash)), nueva);
  await a.evaluate(() => { location.hash = '#/admin'; }); await a.waitForTimeout(250);
  await a.click('[data-coords="parana-terminal"]'); await a.waitForTimeout(80);
  await a.fill('#coEm', 'coord@x.com\nNUEVO@x.com\nno-es-email'); await a.click('#coOk'); await a.waitForTimeout(200);
  const r = await a.evaluate(() => ({ co: window.__store['coordinadores/parana-terminal'], rol: window.__store['roles/nuevo@x.com'] }));
  check('nombra coordinadores (email en minúscula, descarta lo que no es email) y les da el rol', JSON.stringify(r.co.emails) === '["coord@x.com","nuevo@x.com"]' && JSON.stringify(r.rol.campanas) === '["parana-terminal"]', r);
  await a.fill('#adCongs', 'San Agustín (Paraná)\nVilla Urquiza (Paraná)\n\nSan Agustín (Paraná)'); await a.click('#adCongsOk'); await a.waitForTimeout(150);
  check('guarda la lista de congregaciones sin repetidos', JSON.stringify(await a.evaluate(() => window.__store['config/publico'].congregaciones)) === '["San Agustín (Paraná)","Villa Urquiza (Paraná)"]');
  await a.click('[data-histgen]'); await a.waitForTimeout(250);
  const hg = await text(a, '.hgov');
  check('Administración: historial de todo, con campaña o "Configuración general"', /admin@x\.com cambió la lista de congregaciones: agregó Villa Urquiza \(Paraná\)[\s\S]*Configuración general/.test(hg) && /admin@x\.com cambió los coordinadores: agregó nuevo@x\.com\s*\S.*Terminal de ómnibus/.test(hg) && /admin@x\.com creó la campaña Plaza San Martín \(Gualeguaychú\)/.test(hg), hg.slice(0, 700));
  await a.selectOption('#hgCamp', '__gen'); await a.waitForTimeout(100);
  check('filtro por campaña: solo la configuración general', /congregaciones/.test(await text(a, '.hgov .card.hist')) && !/coordinadores/.test(await text(a, '.hgov .card.hist')));
  await a.click('.hgov [data-cerrar]'); await a.waitForTimeout(80);
  check('sin errores (admin)', a.errs.length === 0, a.errs);
  console.log('\nMis turnos: hoy, próximos y realizados');
  {
    const seed = JSON.parse(JSON.stringify(SEED));
    seed['campanas/parana-terminal'].desde = '2026-09-01';
    const ped = (fecha, tid, punto, desde, hasta, estado) => ({ cid: 'parana-terminal', fecha, tid, punto, desde, hasta, uid: 'u-ana', email: 'ana@x.com', nombre: 'Ana', apellido: 'Paz', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', estado });
    seed['pedidos/parana-terminal__2026-09-29__t2__u-ana'] = ped('2026-09-29', 't2', 'p1', '10:00', '12:00', 'confirmado');
    seed['pedidos/parana-terminal__2026-09-29__t3__u-ana'] = ped('2026-09-29', 't3', 'p2', '16:00', '18:00', 'confirmado');
    seed['pedidos/parana-terminal__2026-10-03__t1__u-ana'] = ped('2026-10-03', 't1', 'p1', '08:00', '10:00', 'pendiente');
    seed['pedidos/parana-terminal__2026-09-19__t1__u-ana'] = ped('2026-09-19', 't1', 'p1', '08:00', '10:00', 'confirmado');
    const cx = await b.newContext({ viewport: { width: 390, height: 1300 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await cx.clock.install({ time: new Date('2026-09-29T13:56:00-03:00') });
    await cx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await cx.addInitScript(`(${mock.toString()})(${JSON.stringify(seed)}, ${JSON.stringify([pub])})`);
    const m = await cx.newPage(); m.errs = []; m.on('pageerror', e => m.errs.push(e.message));
    await m.goto(FILE + '#/mis'); await m.waitForTimeout(250); await m.click('#userBtn'); await m.waitForTimeout(300);
    const tx = await text(m, '#app');
    check('el turno de hoy que ya terminó (10 a 12) pasa a Realizados; el de 16 a 18 queda en Hoy', /^[\s\S]*HOY\s*MAR\s*29\s*sep\s*en 2 h 4 min\s*16:00 – 18:00[\s\S]*PRÓXIMOS\s*1\s*SÁB\s*3[\s\S]*Esperando confirmación[\s\S]*REALIZADOS\s*Septiembre\s*MAR\s*29\s*sep\s*10:00 – 12:00[\s\S]*Hecho\s*Detalle\s*SÁB\s*19[\s\S]*Hecho/i.test(tx), tx);
    check('resumen: 3 turnos este mes, 6 h, 1 por confirmar, y el agradecimiento', /3\s*turnos este mes\s*6 h\s*de predicación\s*1\s*por confirmar/.test(tx) && /Gracias por participar[\s\S]*Ya hiciste 2 turnos este mes/.test(tx), tx.slice(0, 200));
    await m.screenshot({ path: SHOTS + '/mis-turnos-completo.png', fullPage: true });
    check('sin errores (mis turnos)', m.errs.length === 0, m.errs);
    await cx.close();
  }

  console.log('\nNota para el coordinador');
  {
    const luis = { uid: 'u-luis', email: 'luis@x.com', displayName: 'Luis Gómez' };
    const cx = await b.newContext({ viewport: { width: 390, height: 1100 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await cx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await cx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await cx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, ${JSON.stringify([luis])})`);
    const m = await cx.newPage(); m.errs = []; m.on('pageerror', e => m.errs.push(e.message));
    await m.goto(FILE + '#/c/parana-terminal'); await m.waitForTimeout(250); await m.click('#userBtn'); await m.waitForTimeout(300);
    await m.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await m.waitForTimeout(150);
    await m.click('[data-dia="2026-10-03"]'); await m.click('[data-pedir="t3"]'); await m.waitForTimeout(100);
    check('el formulario tiene "Nota para el coordinador (opcional)" con 4 atajos y 0/200', /Nota para el coordinador\s*\(opcional\)\s*0\/200/i.test(await text(m, '.sheet')) && await m.evaluate(() => document.querySelectorAll('[data-atajo]').length === 4));
    await m.click('[data-atajo="Voy con mi esposa/o"]'); await m.click('[data-atajo="Puedo llevar el carrito"]');
    let v = await m.evaluate(() => ({ t: document.querySelector('#pNota').value, on: document.querySelectorAll('[data-atajo].on').length, c: document.querySelector('#pNotaCnt').textContent }));
    check('los atajos se suman al texto y quedan marcados', v.t === 'Voy con mi esposa/o. Puedo llevar el carrito.' && v.on === 2 && v.c === '45/200', v);
    await m.click('[data-atajo="Voy con mi esposa/o"]');
    v = await m.evaluate(() => document.querySelector('#pNota').value);
    check('tocar de nuevo un atajo lo saca', v === 'Puedo llevar el carrito.', v);
    await m.fill('#pNota', 'x'.repeat(250));
    check('no deja pasar de 200 letras', await m.evaluate(() => document.querySelector('#pNota').value.length === 200));
    await m.fill('#pNota', 'Voy con mi esposa (Marta). Puedo llevar el carrito.');
    await m.selectOption('#pCong', 'San Agustín (Paraná)'); await m.fill('#pCel', '343 555-2222'); await m.check('#pOk');
    await m.screenshot({ path: SHOTS + '/pedir-nota.png' });
    await m.click('#pGo'); await m.waitForTimeout(250);
    const pid = 'parana-terminal__2026-10-03__t3__u-luis';
    let ped = await m.evaluate((id) => window.__store['pedidos/' + id], pid);
    check('la nota se guarda en el pedido (privado), no en el cupo', ped && ped.nota === 'Voy con mi esposa (Marta). Puedo llevar el carrito.' && !JSON.stringify(await m.evaluate(() => window.__store['cupos/parana-terminal__2026-10-03__t3'])).includes('Marta'), ped);
    check('no queda guardada para el próximo turno', await m.evaluate(() => !JSON.stringify(localStorage).includes('Marta')));
    await m.click('.sheet .btn.alt[data-cerrar]'); await m.waitForTimeout(80);
    await m.evaluate((id) => { location.hash = '#/t/' + id; }, pid); await m.waitForTimeout(200);
    check('"Tu turno" muestra la nota con "Cambiar"', /Nota para el coordinador\s*Voy con mi esposa \(Marta\)\. Puedo llevar el carrito\.\s*Cambiar/i.test(await text(m, '#app')), await text(m, '#app'));
    await m.click('[data-nota]'); await m.waitForTimeout(100);
    check('al cambiar, viene con la nota', await m.evaluate(() => document.querySelector('.sheet #pNota').value.startsWith('Voy con mi esposa')));
    await m.fill('.sheet #pNota', 'Llego unos minutos tarde.'); await m.click('#nOk'); await m.waitForTimeout(200);
    ped = await m.evaluate((id) => window.__store['pedidos/' + id], pid);
    check('se guarda la nota nueva', ped.nota === 'Llego unos minutos tarde.' && ped.estado === 'pendiente', ped);
    await m.click('[data-nota]'); await m.waitForTimeout(100); await m.fill('.sheet #pNota', ''); await m.click('#nOk'); await m.waitForTimeout(200);
    ped = await m.evaluate((id) => window.__store['pedidos/' + id], pid);
    check('vacía, se borra del pedido', !('nota' in ped) && /Sin nota\.\s*Agregar una nota/.test(await text(m, '#app')), ped);
    await m.click('[data-nota]'); await m.waitForTimeout(100); await m.fill('.sheet #pNota', 'Es mi primera vez.'); await m.click('#nOk'); await m.waitForTimeout(200);
    const seed2 = await m.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
    check('sin errores (nota)', m.errs.length === 0, m.errs);
    await cx.close();
    // El coordinador la ve
    const cy = await b.newContext({ viewport: { width: 390, height: 1100 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await cy.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await cy.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await cy.addInitScript(`(${mock.toString()})(${JSON.stringify(seed2)}, ${JSON.stringify([{ uid: 'u-co', email: 'coord@x.com', displayName: 'Carlos Vega' }])})`);
    const k = await cy.newPage(); k.errs = []; k.on('pageerror', e => k.errs.push(e.message));
    await k.goto(FILE); await k.waitForTimeout(250); await k.click('#userBtn'); await k.waitForTimeout(300); await k.click('#coordBtn'); await k.waitForTimeout(250);
    check('el coordinador ve la nota en el pedido', /Luis Gómez[\s\S]*343 555-2222\s*Nota: Es mi primera vez\.\s*No confirmar\s*Confirmar/.test(await text(k, '#app')), await text(k, '#app'));
    await k.screenshot({ path: SHOTS + '/coord-nota.png' });
    await k.click('[data-confirmar]'); await k.waitForTimeout(200);
    await k.click('[data-tab="dia"]'); await k.click('[data-cdia="2026-10-03"]'); await k.waitForTimeout(100);
    check('y en la lista del día, debajo del turno', /Hall central[\s\S]*Luis Gómez\s*San Agustín \(Paraná\)\s*Luis: Es mi primera vez\./.test(await text(k, '#app')), await text(k, '#app'));
    await k.click('[data-listadia]');
    const msg = await k.evaluate(() => decodeURIComponent(window.__opened.pop().split('text=')[1]));
    check('la lista que se comparte por WhatsApp no lleva la nota', /Luis Gómez/.test(msg) && !/primera vez/.test(msg), msg);
    check('sin errores (coordinador, nota)', k.errs.length === 0, k.errs);
    await cy.close();
  }

  console.log('\nReportar un problema y errores automáticos');
  {
    const seed = JSON.parse(JSON.stringify(SEED));
    seed['config/soporte'] = { emails: ['sop@x.com'] };
    seed['reportes/viejo1'] = { tipo: 'Otro', texto: 'Viejo', estado: 'resuelto', creado: '2026-06-01T10:00:00Z', actualizado: '2026-06-02T10:00:00Z', ver: '9' };
    seed['reportes/viejo2'] = { tipo: 'Otro', texto: 'Visto hace mucho', estado: 'visto', creado: '2026-06-01T10:00:00Z', ver: '9' };
    seed['errores/viejo'] = { tipo: 'js', msg: 'Error viejo', creado: '2026-08-01T10:00:00Z', ver: '9' };
    const ctxOpts = { viewport: { width: 390, height: 1000 }, timezoneId: 'America/Argentina/Buenos_Aires' };
    const abrir = async (sd, users, hash) => {
      const cx = await b.newContext(ctxOpts);
      await cx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
      await cx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
      await cx.addInitScript(`(${mock.toString()})(${JSON.stringify(sd)}, ${JSON.stringify(users)})`);
      const m = await cx.newPage(); m.errs = []; m.on('pageerror', e => m.errs.push(e.message));
      await m.goto(FILE + (hash || '')); await m.waitForTimeout(300);
      return { cx, m };
    };
    let { cx, m } = await abrir(seed, [], '#/c/parana-terminal');
    check('al pie: "Reportar un problema" y la versión', /Reportar un problema\s*·\s*Cómo se usan tus datos\s*Versión \d+/.test(await text(m, '.foot')), await text(m, '.foot'));
    await m.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'Prueba de error', filename: 'https://x/app.js', lineno: 12 })); }); await m.waitForTimeout(150);
    let err = await m.evaluate(() => Object.entries(window.__store).filter(([k]) => k.startsWith('errores/') && k !== 'errores/viejo').map(([, v]) => v));
    check('un error de la página queda anotado solo, con pantalla, celular y versión (sin datos personales)', err.length === 1 && /Prueba de error/.test(err[0].msg) && err[0].pantalla === '#/c/parana-terminal' && /^\d+$/.test(err[0].ver) && err[0].disp && err[0].tipo === 'js' && Object.keys(err[0]).sort().join() === 'creado,disp,msg,pantalla,tipo,ver', err);
    await m.click('#repBtn'); await m.waitForTimeout(100);
    const sh = await text(m, '.sheet');
    check('la ventana muestra lo que se envía también (pantalla, celular, versión, último error)', /Reportar un problema/.test(sh) && /Pantalla:\s*Terminal de ómnibus \(Paraná\)/.test(sh) && /Versión:\s*\d+/.test(sh) && /Último error:\s*"Prueba de error/.test(sh) && !/Tu cuenta/.test(sh), sh);
    await m.fill('#rpTx', 'No me deja anotarme el sábado'); await m.click('#rpGo');
    check('pide elegir qué pasó', /Elegí qué pasó/.test(await text(m, '#rpErr')));
    await m.click('[data-rptipo="No me deja anotarme"]'); await m.fill('#rpCel', '343 555-9999');
    await m.screenshot({ path: SHOTS + '/reportar.png' });
    await m.click('#rpGo'); await m.waitForTimeout(200);
    let reps = await m.evaluate(() => Object.entries(window.__store).filter(([k]) => k.startsWith('reportes/') && !k.includes('viejo')).map(([, v]) => v));
    check('sin sesión: el reporte se guarda sin cuenta, con el celular que dejó y el último error', reps.length === 1 && reps[0].estado === 'nuevo' && reps[0].tipo === 'No me deja anotarme' && reps[0].celular === '343 555-9999' && !reps[0].uid && !reps[0].email && /Prueba de error/.test(reps[0].ultErr), reps);
    check('avisa que lo recibió el equipo de soporte', /Lo recibió el equipo de soporte/.test(await text(m, '#toast')));
    for (let i = 0; i < 4; i++) { await m.click('#repBtn'); await m.click('[data-rptipo="Otro"]'); await m.fill('#rpTx', 'Prueba ' + i); await m.click('#rpGo'); await m.waitForTimeout(120); }
    await m.click('#repBtn'); await m.click('[data-rptipo="Otro"]'); await m.fill('#rpTx', 'Uno más'); await m.click('#rpGo'); await m.waitForTimeout(120);
    check('tope: el sexto reporte del día no se manda', /Ya mandaste varios reportes hoy/.test(await text(m, '#rpErr')) && await m.evaluate(() => Object.keys(window.__store).filter(k => k.startsWith('reportes/') && !k.includes('viejo')).length) === 5);
    await m.evaluate(() => { document.querySelectorAll('.ov').forEach(x => x.remove()); });
    const seed2 = await m.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
    check('sin errores de la página (reportar)', m.errs.length === 0, m.errs);
    await cx.close();
    // Con sesión, el reporte lleva quién es
    ({ cx, m } = await abrir(seed2, [{ uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' }], '#/mis'));
    await m.click('#userBtn'); await m.waitForTimeout(300);
    await m.click('#repBtn'); await m.waitForTimeout(80);
    check('con sesión muestra "Tu cuenta"', /Tu cuenta:\s*ana@x.com/.test(await text(m, '.sheet')));
    await m.click('[data-rptipo="No veo un botón"]'); await m.fill('#rpTx', 'No veo Coordinar'); await m.click('#rpGo'); await m.waitForTimeout(200);
    const r2 = await m.evaluate(() => Object.values(window.__store).find(v => v && v.texto === 'No veo Coordinar'));
    check('con sesión: guarda uid, email y nombre para responderle', r2 && r2.uid === 'u-ana' && r2.email === 'ana@x.com' && r2.nombre === 'Ana Paz' && r2.pantalla === '#/mis', r2);
    check('un publicador no ve "Coordinar"', await m.evaluate(() => document.getElementById('coordBtn').classList.contains('hidden')));
    const seed3 = await m.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
    await cx.close();
    // Equipo de soporte
    ({ cx, m } = await abrir(seed3, [{ uid: 'u-sop', email: 'sop@x.com', displayName: 'Sofía Soporte' }]));
    await m.click('#userBtn'); await m.waitForTimeout(300);
    check('soporte ve "Coordinar" en la barra', await m.evaluate(() => !document.getElementById('coordBtn').classList.contains('hidden')));
    await m.click('#coordBtn'); await m.waitForTimeout(300);
    let tx = await text(m, '#app');
    check('va directo a "Reportes y errores"', /#\/soporte/.test(await m.evaluate(() => location.hash)) && /Reportes y errores/.test(await text(m, '#tbTitle')), await m.evaluate(() => location.hash));
    check('resumen de errores automáticos de las últimas 24 h', /Errores automáticos: 1 en las últimas 24 h\s*1 × "Prueba de error/.test(tx), tx.slice(0, 300));
    check('reportes: Nuevos (6), con el más nuevo arriba', /Nuevos \(6\)\s*Vistos \(1\)\s*Resueltos \(0\)/.test(tx) && /No veo un botón\s*Nuevo\s*Ana Paz · Mis turnos/.test(tx), tx.slice(0, 600));
    check('el reporte sin sesión dice "Sin nombre" y tiene WhatsApp', /Sin nombre \(no inició sesión\) · Terminal de ómnibus \(Paraná\)/.test(tx) && await m.evaluate(() => [...document.querySelectorAll('#app a[href*="wa.me"]')].some(a => /5493435559999/.test(a.href))), tx);
    check('se borraron solos el reporte resuelto de hace más de 60 días y el error viejo (no el visto)', await m.evaluate(() => !window.__store['reportes/viejo1'] && !window.__store['errores/viejo'] && !!window.__store['reportes/viejo2']));
    await m.screenshot({ path: SHOTS + '/soporte.png', fullPage: true });
    const idAna = await m.evaluate(() => Object.keys(window.__store).find(k => k.startsWith('reportes/') && window.__store[k].texto === 'No veo Coordinar').split('/')[1]);
    await m.click(`[data-rpestado="${idAna}|visto"]`); await m.waitForTimeout(150);
    check('"Marcar visto" lo pasa a Vistos y anota quién', await m.evaluate((id) => window.__store['reportes/' + id].estado === 'visto' && window.__store['reportes/' + id].por === 'sop@x.com', idAna) && /Nuevos \(5\)\s*Vistos \(2\)/.test(await text(m, '#app')));
    await m.click('[data-rpfiltro="visto"]'); await m.waitForTimeout(80);
    await m.click(`[data-rpestado="${idAna}|resuelto"]`); await m.waitForTimeout(150);
    await m.click('[data-rpfiltro="resuelto"]'); await m.waitForTimeout(80);
    check('"Resuelto" y aparece en Resueltos con "Volver a abrir"', /No veo un botón\s*Resuelto/.test(await text(m, '#app')) && !!(await m.$(`[data-rpestado="${idAna}|nuevo"]`)));
    await m.click('[data-rpdet]'); await m.waitForTimeout(80);
    check('"Ver detalle" muestra cada error', /Prueba de error/.test(await text(m, '#app')));
    await m.evaluate(() => { location.hash = '#/admin'; }); await m.waitForTimeout(200);
    check('soporte NO entra a Administración', /Esta sección es para los administradores/.test(await text(m, '#app')));
    check('sin errores (soporte)', m.errs.length === 0, m.errs);
    const seed4 = await m.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
    await cx.close();
    // Administrador
    ({ cx, m } = await abrir(seed4, [{ uid: 'u-ad', email: 'admin@x.com', displayName: 'Admin' }], '#/admin'));
    await m.click('#userBtn'); await m.waitForTimeout(400);
    tx = await text(m, '#app');
    check('administración: "Reportes y errores" arriba y "Equipo de soporte" abajo', /^Reportes y errores\s*5 nuevos/.test(tx.trim()) && /Equipo de soporte/.test(tx), tx.slice(0, 200));
    await m.fill('#adSop', 'sop@x.com\nOTRO@x.com\nno-email'); await m.click('#adSopOk'); await m.waitForTimeout(200);
    check('guarda el equipo de soporte (minúscula, sin lo que no es email)', await m.evaluate(() => JSON.stringify(window.__store['config/soporte'].emails) === '["sop@x.com","otro@x.com"]'));
    check('sin errores (admin, soporte)', m.errs.length === 0, m.errs);
    await cx.close();
  }

  console.log('\nInstalar la app');
  {
    const ab = async (ua) => {
      const cx = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' }, ua ? { userAgent: ua } : {}));
      await cx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
      await cx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
      await cx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, ${JSON.stringify([{ uid: 'u-i', email: 'ios@x.com', displayName: 'Iván Ríos' }])})`);
      const m = await cx.newPage(); m.errs = []; m.on('pageerror', e => m.errs.push(e.message));
      await m.goto(FILE); await m.waitForTimeout(300);
      return { cx, m };
    };
    // Computadora sin aviso del navegador: nada
    let { cx, m } = await ab();
    check('en la computadora no aparece "Instalá la app"', !(await m.$('#instBan')));
    // Android: el navegador ofrece instalar
    await m.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); }); await m.waitForTimeout(100);
    check('Android: aparece "Instalá la app PPAM" arriba del Inicio', /Instalá la app PPAM\s*Abrila desde la pantalla de inicio/.test(await text(m, '#instBan')));
    await m.screenshot({ path: SHOTS + '/instalar-android.png' });
    await m.click('[data-instalar]'); await m.waitForTimeout(100);
    check('"Instalar" abre el aviso del celular y, si acepta, no vuelve a aparecer', await m.evaluate(() => window.__prompted === true && localStorage.getItem('ppam-instalar') === 'never') && !(await m.$('#instBan')));
    check('sin errores (instalar Android)', m.errs.length === 0, m.errs);
    await cx.close();
    // Android: cerrar con la X
    ({ cx, m } = await ab());
    await m.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); }); await m.waitForTimeout(100);
    await m.click('[data-instcerrar]'); await m.waitForTimeout(80);
    const hasta = await m.evaluate(() => localStorage.getItem('ppam-instalar'));
    check('la X lo cierra por 30 días', !(await m.$('#instBan')) && hasta && hasta.slice(0, 10) === '2026-10-30', hasta);
    await cx.close();
    // iPhone
    ({ cx, m } = await ab('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'));
    check('iPhone: aparece el aviso aunque Safari no tenga botón', !!(await m.$('#instBan')));
    await m.click('[data-instalar]'); await m.waitForTimeout(100);
    check('iPhone: "Instalar" muestra los dos pasos (Compartir → Agregar a inicio)', /Instalá la app PPAM[\s\S]*1\s*Tocá\s*Compartir[\s\S]*2\s*Bajá y elegí\s*Agregar a inicio/.test(await text(m, '.sheet')), await text(m, '.sheet'));
    await m.screenshot({ path: SHOTS + '/instalar-iphone.png' });
    await m.click('#instNunca'); await m.waitForTimeout(80);
    check('"No mostrar más": no vuelve a aparecer', !(await m.$('#instBan')) && await m.evaluate(() => localStorage.getItem('ppam-instalar') === 'never'));
    await m.click('#userBtn'); await m.waitForTimeout(300); await m.click('#userBtn'); await m.waitForTimeout(100);
    check('en el menú de la cuenta queda "Instalar la app"', /Instalar la app/.test(await text(m, '.sheet')));
    check('sin errores (instalar iPhone)', m.errs.length === 0, m.errs);
    await cx.close();
  }

  console.log('\nMapa de Entre Ríos en el Inicio');
  const LFD = path.resolve(__dirname, '..', '..', 'lf', 'package', 'dist');
  if (!require('fs').existsSync(LFD)) console.log('  (sin copia local de Leaflet: se saltean las pruebas del mapa)');
  else {
    const seed = JSON.parse(JSON.stringify(SEED)); delete seed['campanas/vieja'];
    seed['campanas/parana-terminal'].puntos.p1.lat = -31.7376; seed['campanas/parana-terminal'].puntos.p1.lng = -60.5243;
    seed['campanas/parana-terminal'].puntos.p2.lat = -31.7381; seed['campanas/parana-terminal'].puntos.p2.lng = -60.5235;
    seed['campanas/parana-terminal'].puntos.p2.fotos = ['fhall'];
    seed['fotos/parana-terminal__fhall'] = { cid: 'parana-terminal', data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==', creado: 'x' };
    seed['campanas/parana-costanera'] = { nombre: 'Costanera', ciudad: 'Paraná', desde: '2026-10-01', hasta: '2026-11-30', activa: true, puntos: { p1: { nombre: 'Rosedal', tipo: 'stand', cupo: 2, lat: -31.7194, lng: -60.5333 } }, turnos: { t1: { punto: 'p1', desde: '09:00', hasta: '11:00', dias: [1, 3, 5, 6] } } };
    seed['campanas/feliciano-x'] = { nombre: 'Plaza', ciudad: 'Pueblo Inventado', desde: '2026-10-01', hasta: '2026-11-30', activa: true, puntos: { p1: { nombre: 'Plaza', tipo: 'stand', cupo: 2 } }, turnos: {} };
    const cx = await b.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'America/Argentina/Buenos_Aires', geolocation: { latitude: -32.618, longitude: -60.155 }, permissions: ['geolocation'] });
    await cx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await cx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await cx.route(/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.(js|css)$/, r => r.fulfill({ path: path.join(LFD, r.request().url().endsWith('.css') ? 'leaflet.css' : 'leaflet.js') }));
    await cx.addInitScript(`(${mock.toString()})(${JSON.stringify(seed)}, ${JSON.stringify([{ uid: 'u-ad', email: 'admin@x.com', displayName: 'Admin' }])})`);
    const m = await cx.newPage(); m.errs = []; m.on('pageerror', e => m.errs.push(e.message));
    await m.goto(FILE); await m.waitForTimeout(300);
    const labs = () => m.evaluate(() => [...document.querySelectorAll('.pp .lab')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).sort());
    const pin = (re) => m.evaluateHandle((r) => [...document.querySelectorAll('.pp')].find(x => new RegExp(r).test(x.textContent)).querySelector('.pin'), re);
    check('en modo Lista sigue la tarjeta "Sumate a un turno"', !!(await m.$('.welcome')));
    check('en el Inicio: "Lista | Mapa", con la lista elegida', /Lista\s*Mapa/.test(await text(m, '.seg2')) && await m.evaluate(() => document.querySelector('[data-vista="lista"]').classList.contains('on')) && await m.evaluate(() => document.querySelectorAll('.cc.camp').length === 4));
    await m.click('[data-vista="mapa"]'); await m.waitForTimeout(600);
    let l = await labs();
    check('de lejos: un pin por localidad con su nombre (Paraná · 2, Concordia)', JSON.stringify(l) === '["Concordia","Paraná· 2"]', l);
    check('la campaña sin ubicación sigue apareciendo debajo del mapa', /Sin ubicación en el mapa/i.test(await text(m, '#app')) && /Pueblo Inventado/.test(await text(m, '#app')) && await m.evaluate(() => document.querySelectorAll('.cc.camp').length === 1));
    check('recuerda que eligió Mapa', await m.evaluate(() => localStorage.getItem('ppam-vista') === 'mapa'));
    await m.screenshot({ path: SHOTS + '/mapa-inicio.png' });
    check('en modo Mapa no está la tarjeta "Sumate a un turno" (el mapa es el protagonista)', !(await m.$('.welcome')));
    check('el mapa arranca encuadrado sobre las campañas, no en toda la provincia', await m.evaluate(() => { const c = window.__ppam.mapa.map.getCenter(); return Math.abs(c.lat - -31.56) < 0.35 && Math.abs(c.lng - -59.27) < 0.5; }));
    check('los botones del mapa son chicos, abajo a la derecha, y la leyenda va debajo del mapa', await m.evaluate(() => { const c = document.querySelector('.mctl').getBoundingClientRect(), w = document.getElementById('mapw').getBoundingClientRect(); return c.bottom > w.bottom - 80 && c.width <= 40 && !document.querySelector('#mapw .mleg') && !!document.querySelector('.mleg'); }));
    await (await pin('Paraná')).click(); await m.waitForTimeout(1200);
    l = await labs();
    check('tocar "Paraná · 2" acerca hasta separar sus campañas, con su nombre', l.includes('Terminal de ómnibus') && l.includes('Costanera'), l);
    await (await pin('Terminal de ómnibus')).click(); await m.waitForTimeout(1000);
    const ab = await m.evaluate(() => ({ sel: !!document.querySelector('.pp.sel'), dim: document.querySelector('.mapin').classList.contains('dim'), on: document.getElementById('msheet').classList.contains('on'), t: document.getElementById('msBody').innerText.replace(/\s+/g, ' ') }));
    check('la campaña elegida muestra sus puntos con su nombre (Hall central)', await m.evaluate(() => [...document.querySelectorAll('.pso .lab')].map(x => x.textContent).join() === 'Hall central' || [...document.querySelectorAll('.pso .lab')].map(x => x.textContent).sort().join() === 'Andén 1,Hall central'));
    check('tocar una campaña: se vuelve su foto y sube la tarjeta con los lugares que faltan', ab.sel && ab.dim && ab.on && /Terminal de ómnibus/.test(ab.t) && /2 puntos/.test(ab.t) && /Faltan \d+ lugares|Falta 1 lugar/.test(ab.t), ab);
    await m.screenshot({ path: SHOTS + '/mapa-terminal.png' });
    await m.evaluate(() => [...document.querySelectorAll('.pso')].find(x => /Hall central/.test(x.textContent)).querySelector('.pin').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await m.waitForTimeout(900);
    const hp = await m.evaluate(() => ({ t: document.getElementById('msBody').innerText.replace(/\s+/g, ' '), foto: (document.querySelector('#msBody .im') || {}).dataset && document.querySelector('#msBody .im').dataset.foto, pin: !!document.querySelector('.pso.sel [data-foto="parana-terminal__fhall"]'), lugar: !!document.querySelector('#msBody [data-lugar="parana-terminal|p2"]') }));
    check('tocar un carrito: muestra SU foto, su nombre y "Ver lugar"', /Hall central/.test(hp.t) && hp.foto === 'parana-terminal__fhall' && hp.pin && hp.lugar, hp);
    await m.screenshot({ path: SHOTS + '/mapa-punto.png' });
    // una campaña sin puntos marcados: lo avisa en la tarjeta
    await m.evaluate(() => { const S = window.__ppam; S.mapa.cs.push({ c: { id: 'x1', nombre: 'Sin marcar', ciudad: 'Crespo', puntos: { a: { nombre: 'A' }, b: { nombre: 'B' } } }, e: { est: 'ok', txt: 'Faltan 2 lugares esta semana' }, lat: -32.028, lng: -60.307, pts: [] }); });
    await m.evaluate(() => { const S = window.__ppam; S.mapa.sel = null; });
    await m.evaluate(() => window.__ppam.mapa.map.setView([-32.028, -60.307], 13)); await m.waitForTimeout(600);
    await (await pin('Sin marcar')).click(); await m.waitForTimeout(900);
    check('campaña sin puntos marcados: la tarjeta lo avisa', /todavía no están marcados en el mapa: aparece en el centro de Crespo/.test(await text(m, '#msBody')), await text(m, '#msBody'));
    await m.evaluate(() => { window.__ppam.mapa.cs.pop(); });
    await m.click('#lmap', { position: { x: 30, y: 120 } }); await m.waitForTimeout(400);
    check('tocar el mapa cierra la tarjeta', await m.evaluate(() => !document.querySelector('.pp.sel') && !document.getElementById('msheet').classList.contains('on')));
    for (let i = 0; i < 4; i++) { await m.click('[data-mz="1"]'); await m.waitForTimeout(350); }
    l = await labs();
    check('muy de cerca: un pin por punto (Andén 1, Hall central)', l.some(x => /Andén 1/.test(x)) || l.some(x => /Hall central/.test(x)) || l.some(x => /2 puntos/.test(x)), l);
    await m.click('[data-mtodo]'); await m.waitForTimeout(900);
    check('"Ver todas" vuelve a encuadrar las campañas', JSON.stringify(await labs()) === '["Concordia","Paraná· 2"]', await labs());
    // al refrescar el Inicio el mapa no se pierde
    await m.evaluate(() => { const z = window.__ppam.mapa.map.getZoom(); window.__z = z; }); await m.evaluate(() => window.__ppam && document.dispatchEvent(new Event('x')));
    await m.click('[data-cerca]'); await m.waitForTimeout(2200);
    check('"Cerca mío": marca dónde está y abre la campaña más cercana', await m.evaluate(() => !!document.querySelector('.yo') && document.getElementById('msheet').classList.contains('on')) && /La más cercana/.test(await text(m, '#toast')));
    await m.click('.mcc .go'); await m.waitForTimeout(300);
    check('"Ver turnos" entra a la campaña', /^#\/c\//.test(await m.evaluate(() => location.hash)));
    await m.evaluate(() => { location.hash = '#/'; }); await m.waitForTimeout(500);
    check('al volver al Inicio el mapa sigue ahí (no se vuelve a armar)', await m.evaluate(() => !!document.querySelector('#mapw .mapin') && document.querySelectorAll('.mapin').length === 1));
    // Interruptor en Administración
    await m.click('#userBtn'); await m.waitForTimeout(300);
    await m.evaluate(() => { location.hash = '#/admin'; }); await m.waitForTimeout(300);
    check('Administración: "Mostrar el mapa en el Inicio", prendido', await m.evaluate(() => document.getElementById('adMapa').checked));
    await m.click('#adMapa'); await m.waitForTimeout(200);
    check('apagarlo lo guarda para todos', await m.evaluate(() => window.__store['config/publico'].mapa === false));
    await m.evaluate(() => { location.hash = '#/'; }); await m.waitForTimeout(300);
    check('con el mapa apagado: sin "Lista | Mapa" y se ve la lista', !(await m.$('.seg2')) && !(await m.$('#mapw')) && await m.evaluate(() => document.querySelectorAll('.cc.camp').length === 4));
    check('sin errores (mapa)', m.errs.length === 0, m.errs);
    await cx.close();
  }
  console.log('\nCelular compartido, turnos que ya empezaron y estado de los lugares');
  {
    const A1 = { uid: 'u-a1', email: 'a1@x.com', displayName: 'Ana Uno' }, B1 = { uid: 'u-b1', email: 'b1@x.com', displayName: 'Beto Dos' };
    const cx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await cx.clock.install({ time: new Date('2026-10-01T09:00:00-03:00') });   // jueves 1, 9 h: el turno de 8 a 10 ya empezó
    await cx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await cx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, ${JSON.stringify([A1, B1])})`);
    await cx.addInitScript(() => { try { localStorage.setItem('ppam-perfil', JSON.stringify({ nombre: 'Viejo', celular: '343 111-1111', acepto: true })); } catch (e) {} });
    const q = await cx.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message));
    await q.goto(FILE + '#/c/parana-terminal'); await q.waitForTimeout(300);
    check('el perfil viejo (sin dueño) se descarta', await q.evaluate(() => localStorage.getItem('ppam-perfil') === null));
    const camp = await text(q, '#app');
    check('hoy: el turno que ya empezó (8 a 10) no se ofrece; el de 10 sí', !(await q.$('[data-pedir="t1"]')) && !!(await q.$('[data-pedir="t2"]')), camp.slice(0, 400));
    await q.click('#userBtn'); await q.waitForTimeout(300); await q.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await q.waitForTimeout(200);
    await q.click('[data-pedir="t2"]'); await q.waitForTimeout(150);
    await q.selectOption('#pCong', 'San Agustín (Paraná)'); await q.fill('#pCel', '343 555-1234'); await q.check('#pOk'); await q.click('#pGo'); await q.waitForTimeout(250);
    await q.click('.sheet [data-cerrar]'); await q.waitForTimeout(80);
    check('los datos quedan guardados para esa cuenta', await q.evaluate(() => /343 555-1234/.test(localStorage.getItem('ppam-perfil:u-a1') || '')));
    await q.click('#userBtn'); await q.waitForTimeout(100); await q.click('#uOut'); await q.waitForTimeout(250);
    await q.click('#userBtn'); await q.waitForTimeout(300); await q.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await q.waitForTimeout(200);
    await q.click('[data-dia="2026-10-02"]'); await q.waitForTimeout(80); await q.click('[data-pedir="t1"]'); await q.waitForTimeout(150);
    check('otra cuenta en el mismo celular NO ve los datos de la anterior', await q.evaluate(() => document.querySelector('#pNom').value === 'Beto' && document.querySelector('#pCel').value === '' && !document.querySelector('#pOk').checked));
    await q.click('.sheet [data-cerrar]'); await q.waitForTimeout(80);
    await q.click('#userBtn'); await q.waitForTimeout(100);
    q.once('dialog', d => d.accept()); await q.click('#uBor'); await q.waitForTimeout(100);
    check('"Borrar mis datos de este celular" borra todos los perfiles guardados', await q.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('ppam-perfil'))));
    check('sin errores (celular compartido)', q.errs.length === 0, q.errs);
    await cx.close();
  }
  {
    const cx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await cx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await cx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await cx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, [])`);
    await cx.addInitScript(() => { const db = window.__ppamMock.db, c0 = db.collection; db.collection = (x) => x === 'cupos' ? { where() { return this; }, onSnapshot: () => () => {}, get: async () => ({ forEach() {} }) } : c0(x); });
    const q = await cx.newPage(); await q.goto(FILE + '#/c/parana-terminal'); await q.waitForTimeout(300);
    check('mientras no llegan los cupos: "Consultando lugares…" y no se puede pedir', /Consultando lugares…/.test(await text(q, '#app')) && await q.evaluate(() => [...document.querySelectorAll('.chip')].every(b => b.disabled)));
    await cx.close();
  }
  {
    SEED['campanas/orden'] = { nombre: 'Orden', ciudad: 'Paraná', desde: '2026-10-01', hasta: '2026-10-31', activa: true, puntos: { a: { nombre: 'Carrito 10', tipo: 'carrito', cupo: 2 }, b: { nombre: 'Carrito 2', tipo: 'carrito', cupo: 2 }, d: { nombre: 'Carrito 1', tipo: 'carrito', cupo: 2 } }, turnos: { t1: { punto: 'a', desde: '08:00', hasta: '10:00', dias: [4] }, t2: { punto: 'b', desde: '08:00', hasta: '10:00', dias: [4] }, t3: { punto: 'd', desde: '08:00', hasta: '10:00', dias: [4] } } };
    const q = await open([], '#/c/orden');
    check('los carritos van en orden por número (1, 2, 10)', await q.evaluate(() => [...document.querySelectorAll('.pc .pt .tx b')].map(x => x.textContent).join() === 'Carrito 1,Carrito 2,Carrito 10'));
    delete SEED['campanas/orden'];
  }
  check('el service worker solo borra sus propias copias (ppam-…) y conserva las fotos', /ks\.filter\(k => k\.startsWith\('ppam-'\) && !k\.startsWith\('ppam-fotos'\) && k !== CACHE\)/.test(require('fs').readFileSync(path.resolve(__dirname, '..', 'service-worker.js'), 'utf8')));
  console.log('\nAccesibilidad (WCAG 2.2 AA) y ayudas');
  {
    const AXE = path.resolve(__dirname, '..', '..', 'axe', 'node_modules', 'axe-core', 'axe.min.js');
    const A2 = { uid: 'u-a2', email: 'a2@x.com', displayName: 'Ana Dos' };
    SEED['pedidos/parana-terminal__2026-10-03__t2__u-a2'] = { cid: 'parana-terminal', fecha: '2026-10-03', tid: 't2', punto: 'p1', desde: '10:00', hasta: '12:00', uid: 'u-a2', email: 'a2@x.com', nombre: 'Ana', apellido: 'Dos', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', estado: 'confirmado', creado: '2026-09-30T10:00:00Z' };
    const q = await open([A2], '#/c/parana-terminal');
    await q.click('[data-dia="2026-10-02"]'); await q.waitForTimeout(80);
    check('el día elegido se anuncia (aria-pressed) y el foco vuelve al botón del día', await q.evaluate(() => document.querySelector('[data-dia="2026-10-02"]').getAttribute('aria-pressed') === 'true' && document.querySelector('[data-dia="2026-10-01"]').getAttribute('aria-pressed') === 'false' && document.activeElement === document.querySelector('[data-dia="2026-10-02"]')));
    check('frase de ayuda: "Tocá un horario con lugar…"', /Tocá un horario con lugar para pedir tu turno/.test(await text(q, '#app')));
    await q.click('[data-pedir="t1"]'); await q.waitForTimeout(150);
    check('la ventana: el fondo queda inerte y el foco entra en ella', await q.evaluate(() => document.getElementById('app').hasAttribute('inert') && document.querySelector('.sheet').contains(document.activeElement) && !!document.querySelector('.sheet').getAttribute('aria-labelledby')));
    await q.keyboard.press('Escape'); await q.waitForTimeout(80);
    check('Escape la cierra y el foco vuelve al horario que la abrió', await q.evaluate(() => !document.querySelector('.ov') && !document.getElementById('app').hasAttribute('inert') && document.activeElement === document.querySelector('[data-pedir="t1"]')));
    await q.click('#userBtn'); await q.waitForTimeout(300); await q.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await q.waitForTimeout(200);
    await q.click('[data-dia="2026-10-03"]'); await q.waitForTimeout(80); await q.click('[data-pedir="t3"]'); await q.waitForTimeout(150);
    check('no avisa superposición si no hay', !/Se superpone/.test(await text(q, '.sheet')));
    await q.keyboard.press('Escape'); await q.waitForTimeout(50);
    SEED['campanas/parana-terminal'].turnos.t9 = { punto: 'p2', desde: '11:00', hasta: '13:00', dias: [6] };
    const q2 = await open([A2], '#/c/parana-terminal'); await q2.click('#userBtn'); await q2.waitForTimeout(300); await q2.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await q2.waitForTimeout(200);
    await q2.click('[data-dia="2026-10-03"]'); await q2.waitForTimeout(80); await q2.click('[data-pedir="t9"]'); await q2.waitForTimeout(150);
    check('turnos superpuestos: avisa con cuál choca', /Se superpone con otro turno tuyo\s*10:00 a 12:00 · Andén 1/.test(await text(q2, '.sheet')), await text(q2, '.sheet'));
    delete SEED['campanas/parana-terminal'].turnos.t9; delete SEED['pedidos/parana-terminal__2026-10-03__t2__u-a2'];
    await q2.keyboard.press('Escape');
    await q2.click('#shareBtn'); await q2.waitForTimeout(100);
    check('compartir: WhatsApp y "Copiar enlace"', /Mandar por WhatsApp[\s\S]*Copiar enlace/.test(await text(q2, '.sheet')));
    await q2.keyboard.press('Escape');
    await q2.evaluate(() => { window.__sinWebGL = true; }); await q2.click('[data-dia="2026-10-01"]');
    SEED['campanas/parana-terminal'].puntos.p1.lat = -31.74; SEED['campanas/parana-terminal'].puntos.p1.lng = -60.52;
    const q3 = await open([], '#/c/parana-terminal'); await q3.evaluate(() => { window.__sinWebGL = true; }); await q3.click('[data-lugar="parana-terminal|p1"]'); await q3.waitForTimeout(150);
    check('sin WebGL: en vez del mapa, la dirección y "Abrir en el mapa"', await q3.evaluate(() => !document.querySelector('.sheet iframe') && /Abrir en el mapa/.test(document.querySelector('.sheet .sinmapa').innerText)));
    delete SEED['campanas/parana-terminal'].puntos.p1.lat; delete SEED['campanas/parana-terminal'].puntos.p1.lng;
    if (fs.existsSync(AXE)) {
      const ax = fs.readFileSync(AXE, 'utf8');
      for (const [nombre, hash] of [['Inicio', '#/'], ['Campaña', '#/c/parana-terminal']]) {
        const r = await open([], hash); await r.addScriptTag({ content: ax });
        const v = await r.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(x => x.id + ' x' + x.nodes.length));
        check(`axe (WCAG 2.2 AA) sin problemas: ${nombre}`, v.length === 0, v);
      }
    } else console.log('  (axe-core no está instalado: se saltea el control automático de accesibilidad)');
  }
  console.log('\nMuchos usuarios: menos lecturas');
  {
    const q = await open([], '#/c/parana-terminal');
    check('se activa la copia local (persistencia) de Firestore', await q.evaluate(() => !!(window.__persist && window.__persist.synchronizeTabs)));
    check('los cupos se piden solo desde hoy (fecha >= 2026-09-30)', await q.evaluate(() => (window.__q || []).some(x => x[0] === 'cupos' && x[1] === 'fecha' && x[2] === '>=' && x[3] === '2026-09-30')), await q.evaluate(() => window.__q));
    check('sin errores (lecturas)', q.errs.length === 0, q.errs);
    const ctx = q.context();
    await ctx.addInitScript(() => { window.__sinIndice = true; });
    const r = await ctx.newPage(); r.errs = []; r.on('pageerror', e => r.errs.push(e.message));
    await r.goto(FILE + '#/c/parana-terminal'); await r.waitForTimeout(400);
    const rt = await text(r, '#app');
    check('si falta el índice, igual muestra los lugares (lee todos)', /Andén 1/.test(rt) && !/No pudimos consultar/i.test(rt), rt.slice(0, 300));
    check('sin errores (sin índice)', r.errs.length === 0, r.errs);
  }
  {
    SEED['fotos/parana-terminal__fport'] = { cid: 'parana-terminal', data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==', creado: 'x' };
    SEED['campanas/parana-terminal'].portada = 'fport';
    const f = await open([], '#/c/parana-terminal'); await f.waitForTimeout(300);
    const enCache = await f.evaluate(async () => { if (!window.caches) return 'sin-api'; const c = await caches.open('ppam-fotos-1'); return !!(await c.match('https://ppam.fotos/parana-terminal__fport')); });
    await f.context().addInitScript(() => { const m = window.__ppamMock; if (!m) return; const d0 = m.db.doc; m.db.doc = (x) => { if (x.startsWith('fotos/')) window.__fget = (window.__fget || 0) + 1; return d0(x); }; });
    await f.reload(); await f.waitForTimeout(500);
    const n2 = await f.evaluate(() => window.__fget || 0), bg = await f.evaluate(() => getComputedStyle(document.querySelector('#tb') || document.body).backgroundImage);
    check('la portada se baja una vez y queda guardada en el celular', enCache === 'sin-api' || (enCache === true && n2 === 0 && /base64/.test(bg)), { enCache, n2, bg: bg.slice(0, 40) });
    check('sin errores (fotos)', f.errs.length === 0, f.errs);
    delete SEED['fotos/parana-terminal__fport']; delete SEED['campanas/parana-terminal'].portada;
  }
  console.log('\nTanda 1 de la auditoría: no perder lo escrito, doble toque, lupa y cancelar');
  {
    SEED['campanas/terminada'] = { nombre: 'Feria vieja', ciudad: 'Paraná', desde: '2026-08-01', hasta: '2026-08-31', activa: true, puntos: { p1: { nombre: 'Stand feria', tipo: 'stand', cupo: 2 } }, turnos: { t1: { punto: 'p1', desde: '09:00', hasta: '11:00', dias: [0, 1, 2, 3, 4, 5, 6] } } };
    const k = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/coord/parana-terminal');
    await k.click('#userBtn'); await k.waitForTimeout(300); await k.evaluate(() => { location.hash = '#/coord/parana-terminal'; }); await k.waitForTimeout(300);
    await k.click('#busBtn'); await k.waitForTimeout(200); await k.click('[data-bsat="man"]'); await k.waitForTimeout(150);
    const lt = await text(k, '.bsov');
    check('lupa "Faltan mañana": no muestra campañas que ya terminaron', /Faltan mañana/.test(lt) && !/Feria vieja|Stand feria/.test(lt), lt.slice(0, 300));
    await k.keyboard.press('Escape'); await k.waitForTimeout(100);
    await k.click('[data-tab="config"]'); await k.waitForTimeout(150); await k.click('[data-aj="campana"]'); await k.waitForTimeout(150);
    await k.fill('#cfNom', 'Terminal nueva'); await k.fill('#cfLug', 'Andén central');
    await k.evaluate(() => window.__ppamMock.db.doc('pedidos/parana-terminal__2026-10-02__t1__u-zz').set({ cid: 'parana-terminal', fecha: '2026-10-02', tid: 't1', punto: 'p1', desde: '08:00', hasta: '10:00', uid: 'u-zz', nombre: 'Zoe', apellido: 'Paz', congregacion: 'X', celular: '343 555-1111', estado: 'pendiente', creado: 'x' }));
    await k.waitForTimeout(250);
    check('si llega un pedido mientras edita la campaña, no se borra lo escrito', await k.evaluate(() => document.getElementById('cfNom').value === 'Terminal nueva' && document.getElementById('cfLug').value === 'Andén central'));
    await k.evaluate(() => { const b = document.getElementById('cfSave'); b.click(); b.click(); }); await k.waitForTimeout(300);
    const audC = await k.evaluate(() => Object.values(window.__store).filter(d => d && d.tipo === 'cambio_campana' && /Terminal nueva/.test(d.texto)).length);
    check('guarda una sola vez aunque toque dos veces', audC === 1 && (await k.evaluate(() => window.__store['campanas/parana-terminal'].nombre)) === 'Terminal nueva', audC);
    check('después de guardar se ve lo que llegó (1 por confirmar)', /1\s*por confirmar/i.test(await text(k, '#app')), (await text(k, '#app')).slice(0, 200));
    await k.evaluate(() => window.__ppamMock.db.doc('campanas/parana-terminal').update({ 'puntos.p3': { nombre: 'Andén 3', tipo: 'carrito', cupo: 2 } }));
    await k.click('[data-aj="puntos"]'); await k.waitForTimeout(150);
    const antesT = await k.evaluate(() => Object.values(window.__store['campanas/parana-terminal'].turnos).filter(t => t.punto === 'p3').length);
    await k.click('[data-cph="p3"]'); await k.waitForTimeout(150);
    await k.evaluate(() => { const b = document.querySelector('[data-de="p1"]'); b.click(); b.click(); }); await k.waitForTimeout(300);
    const despT = await k.evaluate(() => Object.values(window.__store['campanas/parana-terminal'].turnos).filter(t => t.punto === 'p3').length);
    check('"Copiar horarios" con doble toque no duplica turnos', despT - antesT === 2, { antesT, despT });
    check('sin errores (tanda 1)', k.errs.length === 0, k.errs);
    delete SEED['campanas/terminada'];
  }
  console.log('\nCampaña corta: solo sus días');
  {
    SEED['campanas/corta'] = { nombre: 'Fin de semana', ciudad: 'Crespo', desde: '2026-11-06', hasta: '2026-11-07', activa: true,
      puntos: { p1: { nombre: 'Carrito 1', tipo: 'carrito', cupo: 2 }, p2: { nombre: 'Carrito 2', tipo: 'carrito', cupo: 2 } },
      turnos: { t1: { punto: 'p1', desde: '09:00', hasta: '11:00', dias: [1, 5, 6] } } };
    const k = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/coord/corta');
    await k.click('#userBtn'); await k.waitForTimeout(300); await k.evaluate(() => { location.hash = '#/coord/corta'; }); await k.waitForTimeout(300);
    await k.click('[data-tab="config"]'); await k.waitForTimeout(150);
    const ajt = await text(k, '#app');
    check('aviso: un turno con días fuera de la campaña (Lun)', /Un turno tiene días fuera de la campaña\s*\(Lun\)/.test(ajt) && /Días fuera/.test(ajt), ajt);
    await k.click('[data-tpto="p2"]'); await k.waitForTimeout(100);
    check('"+ Turno" muestra solo los días de la campaña (Vie 6, Sáb 7), marcados', await k.evaluate(() => [...document.querySelectorAll('.wd label')].map(l => l.textContent.trim() + (l.querySelector('input').checked ? '*' : '')).join() === 'Vie 6*,Sáb 7*'));
    await k.click('.ov [data-cerrar]'); await k.waitForTimeout(80);
    await k.click('[data-turno="t1"]'); await k.waitForTimeout(100); await k.click('#tuOk'); await k.waitForTimeout(150);
    check('al guardar el turno se quitan los días fuera', await k.evaluate(() => window.__store['campanas/corta'].turnos.t1.dias.join() === '5,6') && !/días fuera/i.test(await text(k, '#app')));
    await k.click('[data-cph="p2"]'); await k.waitForTimeout(100); await k.click('[data-de="p1"]'); await k.waitForTimeout(150);
    check('copiar horarios en campaña corta', await k.evaluate(() => Object.values(window.__store['campanas/corta'].turnos).filter(t => t.punto === 'p2').map(t => t.desde + ':' + t.dias.join()).join() === '09:00:5,6'));
    check('la tarjeta dice las fechas', /09:00–11:00\s*Vie 6, Sáb 7/.test(await text(k, '#app')), await text(k, '#app'));
    check('sin errores (campaña corta)', k.errs.length === 0, k.errs);
    delete SEED['campanas/corta'];
  }
  await b.close(); console.log(`\n${ok} OK, ${bad} fallaron`);
  process.exitCode = bad ? 1 : 0;
})();
