const fs = require('fs');
// Pruebas de la página (con un Firestore simulado en memoria; sin conexión).
//   node tests/app.test.js
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright/index.js')); }
// axe-core (control automático de accesibilidad): del proyecto (npm install) o de una copia al lado
const axePath = () => { try { return require.resolve('axe-core/axe.min.js'); } catch (e) { return path.resolve(__dirname, '..', '..', 'axe', 'node_modules', 'axe-core', 'axe.min.js'); } };
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = path.resolve(__dirname, 'capturas');
require('fs').mkdirSync(SHOTS, { recursive: true });
let ok = 0, bad = 0; const check = (l, c, x) => { if (c) { ok++; console.log('  ✅', l); } else { bad++; console.log('  ❌', l, x === undefined ? '' : JSON.stringify(x).slice(0, 400)); } };

// Firestore y Auth en memoria (lo mínimo que usa la app).
function mock(seed, users) {
  // la bienvenida y la guía del coordinador ya vistas (salvo en las pruebas que las revisan)
  try { if (!window.__bvNueva) { localStorage.setItem('ppam-bienvenida', '1'); localStorage.setItem('ppam-guia-coord', '1'); } if (!window.__avisoWa) localStorage.setItem('ppam-avisar-wa', 'no'); if (!window.__introNueva) Object.keys(seed).filter(k => k.startsWith('campanas/')).forEach(k => localStorage.setItem('ppam-vista:' + k.slice(9), '1')); } catch (e) { /* nada */ }
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
  // Hermanos habilitados: entran con su link (sesión anónima). Los coordinadores, administradores y soporte, con Google.
  const esStaff = (u) => !!(u && u.email && (u.email === 'hugoescalda@gmail.com' || ((store['config/admins'] || {}).emails || []).includes(u.email) || store['roles/' + u.email] || ((store['config/soporte'] || {}).emails || []).includes(u.email)));
  const comoHermano = (u) => {
    const hid = u.uid, anon = 'anon-' + hid, cod = ('H' + hid.replace(/[^a-z0-9]/gi, '').toUpperCase() + '0000000').slice(0, 8), [n, ...a] = (u.displayName || 'Hermano Prueba').split(' ');
    if (!store['hermanos/' + hid]) store['hermanos/' + hid] = { nombre: n, apellido: a.join(' ') || 'Prueba', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', cod, uid: anon, creado: '2026-09-01T10:00:00Z', por: 'coord@x.com', ultimo: '2026-09-29T10:00:00Z' };
    store['sesiones/' + anon] = { hid, cod }; store['links/' + cod] = { hid, nombre: n, congregacion: 'San Agustín (Paraná)' };
    return { uid: anon, isAnonymous: true };
  };
  if (!window.__cerrado) { if (!users.length) user = comoHermano({ uid: 'u-visita', displayName: 'Visita Prueba' }); else if (!esStaff(users[0]) && !users[0].google) user = comoHermano(users.shift()); }
  const auth = {
    onAuthStateChanged: (cb) => { authCb = cb; setTimeout(() => cb(user), 0); }, signOut: async () => { user = null; authCb(null); },
    signInAnonymously: async () => { user = { uid: 'anon-' + Math.random().toString(36).slice(2, 10), isAnonymous: true }; authCb(user); return { user }; },
    get currentUser() { return user; }
  };
  window.__writes = []; window.__store = store; window.__opened = [];
  window.open = (u) => { window.__opened.push(u); return null; };
  window.confirm = () => true;
  window.__ppamMock = { db, auth, del: () => DEL, arr: { arrayUnion: (v) => ARR('u', v), arrayRemove: (v) => ARR('r', v) }, login: async () => { const u = users.shift(); user = u && !esStaff(u) && !u.google ? comoHermano(u) : u; authCb(user); } };
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
  async function open(users, hash, opts) {
    const ctx = await b.newContext({ viewport: opts && opts.ancho ? { width: opts.ancho, height: 900 } : { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await ctx.clock.install({ time: new Date((opts && opts.reloj) || '2026-09-30T12:00:00-03:00') });   // miércoles 30 de septiembre
    await ctx.route(/gstatic|googleapis|openstreetmap|cdnjs|jsdelivr/, r => r.abort());
    // Pronóstico del tiempo de prueba (Open-Meteo): 1 = mayormente soleado, máxima 22°, 10% de lluvia
    await ctx.route(/api\.open-meteo\.com/, r => { const f = new URL(r.request().url()).searchParams.get('start_date'); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ hourly: { time: Array.from({ length: 24 }, (_, h) => `${f}T${String(h).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 24 }, (_, h) => 12 + Math.min(h, 14) * 0.7), precipitation_probability: Array.from({ length: 24 }, () => 10), weather_code: Array.from({ length: 24 }, () => 1) } }) }); });
    if (opts && opts.nuevo) await ctx.addInitScript(() => { window.__bvNueva = true; });   // ver la bienvenida como alguien nuevo
    if (opts && opts.cerrado) await ctx.addInitScript(() => { window.__cerrado = true; });   // un celular sin link (la web cerrada)
    await ctx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, ${JSON.stringify(users)})`);
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto(FILE + (hash || '')); await p.waitForTimeout(300);
    return p;
  }
  const text = (p, sel) => p.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
  // Ingresar como coordinador (Google). Un hermano ya está adentro con su link: no hace falta.
  const entrar = async (p, ms) => { if (await p.evaluate(() => { const u = document.getElementById('userBtn'); return u.classList.contains('login') && !u.classList.contains('hidden'); })) await p.click('#userBtn'); await p.waitForTimeout(ms || 300); };

  console.log('\nPublicador');
  const pub = { uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' };
  let p = await open([pub]);
  let home = await text(p, '#app');
  check('inicio: las campañas vigentes (no la que ya terminó)', /Terminal de ómnibus/.test(home) && /Costanera/.test(home) && !/Campaña vieja/.test(home), home);
  check('cobertura de la primera semana en la tarjeta', /Terminal de ómnibus[\s\S]*11%\s*24 lugares libres en los próximos 7 días/.test(home) && /Costanera[\s\S]*0%\s*6 lugares libres en los próximos 7 días/.test(home), home);
  check('un hermano habilitado (entró con su link): lugares libres de la semana y su cuenta arriba', /¿Te sumás esta semana\?\s*En Entre Ríos hay \d+ lugares libres[\s\S]*Ver turnos libres/.test(home) && await p.evaluate(() => document.getElementById('userBtn').textContent === 'AP'), home.slice(0, 300));
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
  check('los lugares libres siguen al filtro por ciudad', /En Concordia hay 6 lugares libres/.test(await text(p, '#app')), await text(p, '#app'));
  await p.selectOption('#fCiudad', 'todas'); await p.waitForTimeout(50);
  await p.click('[data-go="#/c/parana-terminal"]'); await p.waitForTimeout(150);
  check('encabezado con la campaña', /Terminal de ómnibus/.test(await text(p, '#tbTitle')) && /^1 al 31 de octubre/.test(await text(p, '#tbSub')));
  let camp = await text(p, '#app');
  check('turnos agrupados por punto, con detalle y lugares libres (el stand no tiene turnos el jueves)', /Andén 1\s*Frente a boleterías\s*1 libre\s*08:00/.test(camp) && !/Hall central/.test(camp), camp);
  check('resumen del día: puntos y lugares libres', /Jueves 1 de octubre\s*1 carrito · 1 lugar libre\s*Todos\s*Con lugar/.test(camp), camp);
  check('los días marcan cuánto lugar queda (jueves 1: quedan pocos; viernes 2: hay lugar)', await p.evaluate(() => document.querySelector('[data-dia="2026-10-01"]').classList.contains('poco') && document.querySelector('[data-dia="2026-10-02"]').classList.contains('libre')));
  check('días desde el 1 de octubre (no antes), sin domingos', await p.evaluate(() => { const d = [...document.querySelectorAll('.day')].map(x => x.dataset.dia); return d[0] === '2026-10-01' && !d.includes('2026-10-04'); }));
  check('turnos del jueves 1 como botones: completo, 1 libre (uno pedido)', /08:00\s*a 10:00\s*Completo\s*10:00\s*a 12:00\s*1 libre/.test(camp) && await p.evaluate(() => document.querySelector('[data-pedir="t1"]').disabled && !document.querySelector('[data-pedir="t2"]').disabled && document.querySelectorAll('[data-pedir="t2"] .cs i.p').length === 1), camp);
  await p.click('[data-cf="libres"]'); await p.waitForTimeout(50);
  check('filtro "Con lugar": oculta el horario completo', !(await p.$('[data-pedir="t1"]')) && !!(await p.$('[data-pedir="t2"]')));
  await p.click('[data-cf="todos"]'); await p.click('[data-plegar="p1"]'); await p.waitForTimeout(50);
  check('tocar el carrito lo pliega (queda el encabezado)', !(await p.$('[data-pedir="t2"]')) && /Andén 1[\s\S]*1 libre/.test(await text(p, '#app')));
  await p.click('[data-plegar="p1"]'); await p.waitForTimeout(50);
  check('sin ubicación cargada no aparece "Ver lugar"', !(await p.$('[data-lugar]')));
  await p.click('[data-dia="2026-10-03"]'); await p.waitForTimeout(80);
  camp = await text(p, '#app');
  check('el sábado aparece también el stand (3 lugares)', /Hall central\s*3 libres\s*16:00\s*a 18:00\s*3 libres/.test(camp), camp);
  await p.screenshot({ path: SHOTS + '/campana.png' });
  await p.click('[data-pedir="t3"]'); await p.waitForTimeout(80);
  check('el formulario viene con los datos que cargó el coordinador (sin pedir Google)', !/Ingresá|Google/.test(await text(p, '.sheet')) && await p.evaluate(() => document.querySelector('#pNom').value === 'Ana' && document.querySelector('#pApe').value === 'Paz' && document.querySelector('#pCong').value === 'San Agustín (Paraná)' && document.querySelector('#pCel').value === '343 555-0000'));
  await p.selectOption('#pCong', ''); await p.click('#pGo');
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
  check('el pedido guarda nombre, apellido, congregación y celular', st.ped && st.ped.nombre === 'Ana' && st.ped.apellido === 'Paz' && st.ped.congregacion === 'San Agustín (Paraná)' && st.ped.celular === '343 555-0000' && st.ped.estado === 'pendiente' && !('email' in st.ped) && st.ped.uid === 'u-ana', st.ped);
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
  check('la cancelación queda en el historial (firmada por quien canceló)', await p.evaluate(() => Object.values(window.__store).some(d => d && d.tipo === 'cancelo' && d.por === 'link' && d.uid === 'u-ana' && d.cid === 'parana-terminal' && /canceló su turno: Ana Paz · Sáb 3\/10 16–18 · Hall central/.test(d.texto))));
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
  await entrar(c, 250);
  check('el coordinador ve "Coordinar" en la barra de abajo', await c.evaluate(() => !document.getElementById('coordBtn').classList.contains('hidden')));
  await c.waitForTimeout(100);
  check('en el inicio, la franja con los pedidos por confirmar', /1\s*Pedido por confirmar\s*Terminal de ómnibus/.test(await text(c, '.coordbar')), await text(c, '.coordbar'));
  await c.click('#coordBtn'); await c.waitForTimeout(250);
  check('Coordinar: arriba la tarjeta de hermanos habilitados y abajo su campaña', /Hermanos habilitados[\s\S]*Terminal de ómnibus/.test(await text(c, '#app')) && !!(await c.$('.hcard[data-go="#/hermanos"]')), await text(c, '#app'));
  await c.click('[data-go="#/coord/parana-terminal"]'); await c.waitForTimeout(250);
  let co = await text(c, '#app');
  check('en su campaña: 1 por confirmar', /1\s*por confirmar/.test(co) && /Ana Paz\s*San Agustín \(Paraná\)/.test(co) && /343 555-0000/.test(co), co.slice(0, 400));
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
  await entrar(v, 250);
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
  await entrar(a, 300);
  check('ve la administración', /Campañas[\s\S]*Congregaciones[\s\S]*Administradores/i.test(await text(a, '#app')));
  await a.screenshot({ path: SHOTS + '/admin.png', fullPage: true });
  await a.click('[data-nueva]'); await a.fill('#ncNom', 'Plaza San Martín'); await a.fill('#ncCiu', 'Gualeguaychú'); await a.click('#ncOk'); await a.waitForFunction(() => /#\/coord\//.test(location.hash), null, { timeout: 5000 }).catch(() => {}); await a.waitForTimeout(200);
  const nueva = await a.evaluate(() => Object.keys(window.__store).find(k => k.startsWith('campanas/gualeguaychu-plaza-san-martin')));
  check('crea una campaña y va a configurarla', !!nueva && /#\/coord\/gualeguaychu-plaza-san-martin/.test(await a.evaluate(() => location.hash)), [nueva, await a.evaluate(() => location.hash), await text(a, '.sheet'), a.errs]);
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
    await m.goto(FILE + '#/mis'); await m.waitForTimeout(250); await entrar(m, 300);
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
    await m.goto(FILE + '#/c/parana-terminal'); await m.waitForTimeout(250); await entrar(m, 300);
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
    await k.goto(FILE); await k.waitForTimeout(250); await entrar(k, 300); await k.evaluate(() => { location.hash = '#/coord/parana-terminal'; }); await k.waitForTimeout(300);
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
    check('la ventana muestra lo que se envía también (pantalla, celular, versión, último error)', /Reportar un problema/.test(sh) && /Pantalla:\s*Terminal de ómnibus \(Paraná\)/.test(sh) && /Versión:\s*\d+/.test(sh) && /Último error:\s*"Prueba de error/.test(sh) && /Tu cuenta:\s*Visita Prueba/.test(sh), sh);
    await m.fill('#rpTx', 'No me deja anotarme el sábado'); await m.click('#rpGo');
    check('pide elegir qué pasó', /Elegí qué pasó/.test(await text(m, '#rpErr')));
    await m.click('[data-rptipo="No me deja anotarme"]'); await m.fill('#rpCel', '343 555-9999');
    await m.screenshot({ path: SHOTS + '/reportar.png' });
    await m.click('#rpGo'); await m.waitForTimeout(200);
    let reps = await m.evaluate(() => Object.entries(window.__store).filter(([k]) => k.startsWith('reportes/') && !k.includes('viejo')).map(([, v]) => v));
    check('un hermano: el reporte lleva su id y nombre (sin email), el celular que dejó y el último error', reps.length === 1 && reps[0].estado === 'nuevo' && reps[0].tipo === 'No me deja anotarme' && reps[0].celular === '343 555-9999' && reps[0].uid === 'u-visita' && reps[0].nombre === 'Visita Prueba' && !reps[0].email && /Prueba de error/.test(reps[0].ultErr), reps);
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
    await entrar(m, 300);
    await m.click('#repBtn'); await m.waitForTimeout(80);
    check('muestra "Tu cuenta" con su nombre', /Tu cuenta:\s*Ana Paz/.test(await text(m, '.sheet')));
    await m.click('[data-rptipo="No veo un botón"]'); await m.fill('#rpTx', 'No veo Coordinar'); await m.click('#rpGo'); await m.waitForTimeout(200);
    const r2 = await m.evaluate(() => Object.values(window.__store).find(v => v && v.texto === 'No veo Coordinar'));
    check('guarda su id y nombre para responderle', r2 && r2.uid === 'u-ana' && !r2.email && r2.nombre === 'Ana Paz' && r2.pantalla === '#/mis', r2);
    check('un publicador no ve "Coordinar"', await m.evaluate(() => document.getElementById('coordBtn').classList.contains('hidden')));
    const seed3 = await m.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
    await cx.close();
    // Equipo de soporte
    ({ cx, m } = await abrir(seed3, [{ uid: 'u-sop', email: 'sop@x.com', displayName: 'Sofía Soporte' }]));
    await entrar(m, 300);
    check('soporte ve "Coordinar" en la barra', await m.evaluate(() => !document.getElementById('coordBtn').classList.contains('hidden')));
    await m.click('#coordBtn'); await m.waitForTimeout(300);
    let tx = await text(m, '#app');
    check('va directo a "Reportes y errores"', /#\/soporte/.test(await m.evaluate(() => location.hash)) && /Reportes y errores/.test(await text(m, '#tbTitle')), await m.evaluate(() => location.hash));
    check('resumen de errores automáticos de las últimas 24 h', /Errores automáticos: 1 en las últimas 24 h\s*1 × "Prueba de error/.test(tx), tx.slice(0, 300));
    check('reportes: Nuevos (6), con el más nuevo arriba', /Nuevos \(6\)\s*Vistos \(1\)\s*Resueltos \(0\)/.test(tx) && /No veo un botón\s*Nuevo\s*Ana Paz · Mis turnos/.test(tx), tx.slice(0, 600));
    check('el reporte del hermano dice su nombre y tiene WhatsApp', /Visita Prueba · Terminal de ómnibus \(Paraná\)/.test(tx) && await m.evaluate(() => [...document.querySelectorAll('#app a[href*="wa.me"]')].some(a => /5493435559999/.test(a.href))), tx);
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
    await entrar(m, 400);
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
    await m.click('[data-instalar]'); await m.waitForTimeout(400);
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
    await entrar(m, 300); await m.click('#userBtn'); await m.waitForTimeout(100);
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
    await m.goto(FILE); await m.waitForTimeout(300); await entrar(m, 300);
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
    check('tocar una campaña: se vuelve su foto y sube la tarjeta con los lugares que faltan', ab.sel && ab.dim && ab.on && /Terminal de ómnibus/.test(ab.t) && /2 puntos/.test(ab.t) && /\d+ lugares libres|1 lugar libre/.test(ab.t), ab);
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
    await entrar(m, 300);
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
    await entrar(q, 300); await q.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await q.waitForTimeout(200);
    await q.click('[data-pedir="t2"]'); await q.waitForTimeout(150);
    await q.selectOption('#pCong', 'San Agustín (Paraná)'); await q.fill('#pCel', '343 555-1234'); await q.check('#pOk'); await q.click('#pGo'); await q.waitForTimeout(250);
    await q.click('.sheet [data-cerrar]'); await q.waitForTimeout(80);
    check('los datos quedan guardados para esa cuenta', await q.evaluate(() => /343 555-1234/.test(localStorage.getItem('ppam-perfil:u-a1') || '')));
    await q.click('#userBtn'); await q.waitForTimeout(100); await q.click('#uOut'); await q.waitForTimeout(250);
    await entrar(q, 300); await q.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await q.waitForTimeout(200);
    await q.click('[data-dia="2026-10-02"]'); await q.waitForTimeout(80); await q.click('[data-pedir="t1"]'); await q.waitForTimeout(150);
    check('otro hermano en el mismo celular NO ve los datos del anterior (ve los suyos)', await q.evaluate(() => document.querySelector('#pNom').value === 'Beto' && document.querySelector('#pCel').value === '343 555-0000' && !document.querySelector('#pOk').checked));
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
  check('el service worker solo borra sus propias copias (ppam-…) y conserva las fotos', /ks\.filter\(k => k\.startsWith\('ppam-'\) && !k\.startsWith\('ppam-fotos'\) && k !== SDK && k !== CACHE\)/.test(require('fs').readFileSync(path.resolve(__dirname, '..', 'service-worker.js'), 'utf8')));
  console.log('\nAccesibilidad (WCAG 2.2 AA) y ayudas');
  {
    const AXE = axePath();
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
    await entrar(q, 300); await q.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await q.waitForTimeout(200);
    await q.click('[data-dia="2026-10-03"]'); await q.waitForTimeout(80); await q.click('[data-pedir="t3"]'); await q.waitForTimeout(150);
    check('no avisa superposición si no hay', !/Se superpone/.test(await text(q, '.sheet')));
    await q.keyboard.press('Escape'); await q.waitForTimeout(50);
    SEED['campanas/parana-terminal'].turnos.t9 = { punto: 'p2', desde: '11:00', hasta: '13:00', dias: [6] };
    const q2 = await open([A2], '#/c/parana-terminal'); await entrar(q2, 300); await q2.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await q2.waitForTimeout(200);
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
    await entrar(k, 300); await k.evaluate(() => { location.hash = '#/coord/parana-terminal'; }); await k.waitForTimeout(300);
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
  console.log('\nTanda 2: diseño del coordinador, sin señal y avisos de error');
  {
    const k = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], ''); await entrar(k, 300);
    check('campaña sin foto: muestra el ícono del tipo de punto', await k.evaluate(() => [...document.querySelectorAll('.cc .th.sinf')].some(x => !!x.querySelector('svg'))));
    await entrar(k, 300); await k.evaluate(() => { location.hash = '#/coord/parana-terminal'; }); await k.waitForTimeout(300);
    const kt = await text(k, '#app');
    check('números del coordinador dicen el período y "hermanos confirmados"', /cubierto de hoy al 31 oct/i.test(kt) && /hermanos? confirmados?/i.test(kt) && !/publicadores/i.test(kt), kt.slice(0, 200));
    await k.click('[data-tab="config"]'); await k.waitForTimeout(150);
    check('las sub-pestañas de Ajustes se ven subrayadas (otro nivel)', await k.evaluate(() => { const b = document.querySelector('.seg2.aj button.on'); const cs = getComputedStyle(b); return cs.borderBottomStyle === 'solid' && parseFloat(cs.borderBottomWidth) >= 2 && getComputedStyle(document.querySelector('.seg2.aj')).backgroundColor === 'rgba(0, 0, 0, 0)'; }));
    await k.evaluate(() => { location.hash = '#/'; }); await k.waitForTimeout(200);
    check('al salir de Coordinación se cierran sus conexiones', await k.evaluate(() => window.__ppam.coord.unsub.length === 0 && window.__ppam.coord.cid === null));
    check('sin errores (tanda 2, coordinador)', k.errs.length === 0, k.errs);

    const u = await open([{ uid: 'u-beto', email: 'beto@x.com', displayName: 'Beto Ruiz' }], '');
    await entrar(u, 300); await u.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await u.waitForTimeout(300);
    await u.click('[data-dia="2026-10-03"]'); await u.waitForTimeout(80); await u.click('[data-pedir="t3"]'); await u.waitForTimeout(100);
    await u.selectOption('#pCong', 'San Agustín (Paraná)'); await u.fill('#pCel', '343 555-0000'); await u.check('#pOk');
    await u.evaluate(() => { const db = window.__ppamMock.db, b0 = db.batch; db.batch = () => { const x = b0(); x.commit = () => new Promise(() => {}); return x; }; });
    await u.click('#pGo'); await u.waitForTimeout(100);
    await u.context().clock.fastForward(16000); await u.waitForTimeout(150);
    const ut = await text(u, '.sheet');
    check('sin señal: no queda colgado en "Enviando…", explica que se manda solo', /Todavía no hay respuesta[\s\S]*se manda solo[\s\S]*Mis turnos/.test(ut), ut);
    check('sin errores (sin señal)', u.errs.length === 0, u.errs);

    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await ctx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await ctx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await ctx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, ${JSON.stringify([{ uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' }])})`);
    await ctx.addInitScript(() => { const db = window.__ppamMock.db, c0 = db.collection; db.collection = (x) => { const c = c0(x); if (x !== 'pedidos') return c; const w0 = c.where; return Object.assign({}, c, { where: (f, op, v) => f === 'uid' ? { onSnapshot: (a, bb, cc) => { setTimeout(() => (typeof a === 'function' ? bb : cc)(Object.assign(new Error('x'), { code: 'unavailable' })), 0); return () => {}; } } : w0(f, op, v) }); }; });
    const m = await ctx.newPage(); m.errs = []; m.on('pageerror', e => m.errs.push(e.message));
    await m.goto(FILE); await m.waitForTimeout(200); await entrar(m, 300);
    await m.evaluate(() => { location.hash = '#/mis'; }); await m.waitForTimeout(200);
    const mt = await text(m, '#app');
    check('si no cargan Mis turnos, avisa y ofrece Reintentar (no dice "no tenés turnos")', /No pudimos cargar tus turnos/.test(mt) && !!(await m.$('#misRe')), mt.slice(0, 200));
    check('sin errores (aviso de Mis turnos)', m.errs.length === 0, m.errs);
  }
  {
    const src = require('fs').readFileSync(path.resolve(__dirname, '..', 'service-worker.js'), 'utf8');
    check('el service worker guarda Firebase para abrir sin señal', /ppam-sdk-10\.13\.2/.test(src) && /firebasejs\/10\.13\.2/.test(src));
    const appSrc = require('fs').readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
    check('el enlace de Maps solo se usa si empieza con https://', /p\.mapsUrl && \/\^https:/.test(appSrc));
  }
  console.log('\nBienvenida (4 pasos con animación) y guía del coordinador');
  {
    const w = await open([], '', { nuevo: true }); await w.waitForTimeout(600);
    const st = () => w.evaluate(() => { const o = document.querySelector('.ovbv'); return o ? { t: o.innerText, img: (o.querySelector('.bvan img') || {}).getAttribute ? o.querySelector('.bvan img').getAttribute('src') : '', fijo: (o.querySelector('.bvan source') || { getAttribute: () => '' }).getAttribute('srcset'), sal: !o.querySelector('#bvSal').classList.contains('oculto'), dlg: !!o.querySelector('[role="dialog"]') } : null; });
    let s1 = await st();
    check('la primera vez aparece la bienvenida: paso 1 de 4, elegir campaña, con animación', s1 && /Paso 1 de 4/i.test(s1.t) && /Elegí una campaña/.test(s1.t) && s1.img === 'img/bienvenida/paso1.webp' && s1.fijo === 'img/bienvenida/paso1-fijo.webp' && s1.dlg, s1);
    for (let k = 0; k < 3; k++) { await w.click('#bvSig'); await w.waitForTimeout(80); }
    const s4 = await st();
    check('el último paso: el coordinador confirma, "Empezar" y sin "Saltear"', s4 && /Paso 4 de 4/i.test(s4.t) && /Un coordinador te confirma/.test(s4.t) && /Empezar/.test(s4.t) && !s4.sal && s4.img === 'img/bienvenida/paso4.webp', s4);
    await w.click('#bvSig'); await w.waitForTimeout(100);
    check('"Empezar" la cierra y queda marcada como vista', !(await st()) && await w.evaluate(() => localStorage.getItem('ppam-bienvenida') === '1'));
    await w.reload(); await w.waitForTimeout(700);
    if (await st()) await w.waitForTimeout(1000);   // con la máquina cargada, la primera pintura puede demorar
    check('no vuelve a aparecer', !(await st()));
    if (await st()) await w.click('#bvSal').catch(() => {});
    await w.click('#tabAyuda'); await w.waitForTimeout(200); await w.click('#ayBv'); await w.waitForTimeout(150);
    check('desde Ayuda, "Ver la bienvenida otra vez" la vuelve a abrir', /Paso 1 de 4/i.test(((await st()) || {}).t || ''));
    await w.click('#bvSal'); await w.waitForTimeout(100);
    check('"Saltear" la cierra', !(await st()));
    check('las 4 animaciones y sus imágenes fijas existen y pesan poco', [1, 2, 3, 4].every(k => ['', '-fijo'].every(x => { try { return fs.statSync(path.resolve(__dirname, '..', 'img/bienvenida/paso' + k + x + '.webp')).size < 70000; } catch (e) { return false; } })));
    check('sin errores (bienvenida)', w.errs.length === 0, w.errs);
    const dl = await open([], '#/c/parana-terminal', { nuevo: true }); await dl.waitForTimeout(600);
    check('si entra por un enlace a una campaña, no aparece', !(await dl.$('.ovbv')));
    const g = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/coord/parana-terminal', { nuevo: true });
    await g.evaluate(() => { try { localStorage.setItem('ppam-bienvenida', '1'); } catch (e) {} document.querySelectorAll('.ov').forEach(x => x.remove()); });
    await entrar(g, 300); await g.evaluate(() => { location.hash = '#/coord/parana-terminal'; }); await g.waitForTimeout(300);
    check('la primera vez en Coordinación: tarjeta "Cómo se usa Coordinación"', /Cómo se usa Coordinación[\s\S]*Pedidos:[\s\S]*Del día:[\s\S]*lupa/i.test(await text(g, '#app')));
    await g.click('[data-cguia]'); await g.waitForTimeout(150);
    check('"Entendido" la cierra para siempre', !(await g.$('.cguia')) && await g.evaluate(() => localStorage.getItem('ppam-guia-coord') === '1'));
    check('sin errores (guía del coordinador)', g.errs.length === 0, g.errs);
  }
  console.log('\nAyuda: preguntas frecuentes');
  {
    const a = await open([], '');
    check('la pestaña Ayuda está siempre en la barra de abajo', await a.evaluate(() => { const b = document.getElementById('tabAyuda'); return b && !b.classList.contains('hidden') && /Ayuda/.test(b.textContent); }));
    await a.click('#tabAyuda'); await a.waitForTimeout(200);
    const at = await text(a, '#app');
    check('Ayuda: 16 preguntas para publicadores, en 3 grupos, sin las de coordinadores', await a.evaluate(() => document.querySelectorAll('.faq details').length) === 16 && /Anotarme[\s\S]*Mis turnos[\s\S]*Mis datos y la app/.test(at) && !/Para coordinadores/.test(at), at.slice(0, 200));
    check('la pestaña queda marcada y el título dice "Preguntas frecuentes"', await a.evaluate(() => document.getElementById('tabAyuda').classList.contains('on')) && /Preguntas frecuentes/.test(await text(a, '#tbTitle')));
    await a.click('#faq-completo summary'); await a.waitForTimeout(80);
    check('tocar una pregunta muestra la respuesta', await a.evaluate(() => document.getElementById('faq-completo').open) && /Con lugar/.test(await text(a, '#faq-completo')));
    await a.click('#faq-cancelar summary'); await a.waitForTimeout(80);
    check('al abrir otra, la anterior se cierra', await a.evaluate(() => document.getElementById('faq-cancelar').open && !document.getElementById('faq-completo').open));
    await a.click('#ayRep'); await a.waitForTimeout(150);
    check('"¿No encontraste tu respuesta?" abre Reportar un problema', /Reportar un problema/.test(await text(a, '.sheet')));
    check('sin errores (ayuda)', a.errs.length === 0, a.errs);
    const ax2 = axePath();
    if (fs.existsSync(ax2)) { await a.keyboard.press('Escape'); await a.waitForTimeout(100); await a.addScriptTag({ content: fs.readFileSync(ax2, 'utf8') }); const v = await a.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(x => x.id + ' x' + x.nodes.length)); check('axe (WCAG 2.2 AA) sin problemas: Ayuda', v.length === 0, v); }
    const k = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '');
    await entrar(k, 300); await k.evaluate(() => { location.hash = '#/ayuda/recuperar'; }); await k.waitForTimeout(300);
    check('el coordinador ve además "Para coordinadores", y un enlace abre esa respuesta', /Para coordinadores/.test(await text(k, '#app')) && await k.evaluate(() => document.getElementById('faq-recuperar').open) && await k.evaluate(() => document.querySelectorAll('.faq details').length) === 19);
    const u = await open([{ uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' }], '');
    await entrar(u, 300);
    await u.evaluate(() => { const db = window.__ppamMock.db; db.doc('pedidos/parana-terminal__2026-10-02__t2__u-ana').set({ cid: 'parana-terminal', fecha: '2026-10-02', tid: 't2', punto: 'p1', desde: '10:00', hasta: '12:00', uid: 'u-ana', email: 'ana@x.com', nombre: 'Ana', apellido: 'Paz', congregacion: 'X', celular: '343 555-0000', estado: 'pendiente', creado: 'x' }); });
    await u.evaluate(() => { location.hash = '#/t/parana-terminal__2026-10-02__t2__u-ana'; }); await u.waitForTimeout(400);
    check('en un turno pendiente: "¿Qué significa?"', !!(await u.$('.qhelp')));
    await u.click('.qhelp'); await u.waitForTimeout(300);
    check('lleva a la Ayuda con esa respuesta abierta', await u.evaluate(() => location.hash === '#/ayuda/espera' && document.getElementById('faq-espera').open));
    check('sin errores (enlaces de ayuda)', k.errs.length === 0 && u.errs.length === 0, [k.errs, u.errs]);
  }
  console.log('\nPrimera visita y espera de confirmación');
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await ctx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await ctx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await ctx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, [])`);
    await ctx.addInitScript(() => { const db = window.__ppamMock.db, c0 = db.collection; db.collection = (x) => x === 'campanas' ? { onSnapshot: () => () => {} } : c0(x); });
    const l = await ctx.newPage(); await l.goto(FILE); await l.waitForTimeout(300);
    check('mientras cargan las campañas se ve la forma de la pantalla (no un "Cargando…" suelto)', await l.evaluate(() => !!document.querySelector('#app .sk .skc') && /Cargando las campañas/.test(document.querySelector('#app [role="status"]').textContent)));
    const h = await open([], '');
    check('el hermano ve sus iniciales arriba (no hay "Ingresar")', await h.evaluate(() => { const b = document.getElementById('userBtn'); return b.classList.contains('av') && b.textContent === 'VP'; }));
    check('"Predicación pública" no se repite en el inicio', !/Predicación pública/i.test(await text(h, '#app')));
    const u = await open([{ uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' }], '');
    await entrar(u, 300);
    await u.evaluate(() => window.__ppamMock.db.doc('pedidos/parana-terminal__2026-10-01__t2__u-ana').set({ cid: 'parana-terminal', fecha: '2026-10-01', tid: 't2', punto: 'p1', desde: '10:00', hasta: '12:00', uid: 'u-ana', email: 'ana@x.com', nombre: 'Ana', apellido: 'Paz', congregacion: 'X', celular: '343 555-0000', estado: 'pendiente', creado: 'x' }));
    await u.waitForTimeout(300);
    check('inicio: si el turno es mañana y sigue sin confirmar, sugiere avisar al coordinador', /Si falta poco y todavía no te confirmaron, avisale al coordinador de tu congregación/.test(await text(u, '#app')));
    await u.evaluate(() => { location.hash = '#/mis'; }); await u.waitForTimeout(300);
    check('Mis turnos: "Esperando confirmación" es una etiqueta chica, no parece un botón', await u.evaluate(() => { const e = document.querySelector('.tc .est.pe'); return !!e && e.getBoundingClientRect().height < 32 && getComputedStyle(e).cursor !== 'pointer'; }));
    await u.evaluate(() => { location.hash = '#/t/parana-terminal__2026-10-01__t2__u-ana'; }); await u.waitForTimeout(300);
    check('detalle: explica la espera y qué hacer si falta poco', /Un coordinador lo revisa y te confirma\. Si falta poco para el turno/.test(await text(u, '.espera')));
    check('sin errores (espera)', u.errs.length === 0 && h.errs.length === 0, [u.errs, h.errs]);
    const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await ctx2.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await ctx2.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await ctx2.addInitScript(() => { window.__avisoWa = true; });
    const S2 = JSON.parse(JSON.stringify(SEED)); S2['pedidos/parana-terminal__2026-10-02__t1__u-luis'] = { cid: 'parana-terminal', fecha: '2026-10-02', tid: 't1', punto: 'p1', desde: '08:00', hasta: '10:00', uid: 'u-luis', email: 'luis@x.com', nombre: 'Luis', apellido: 'Sosa', congregacion: 'X', celular: '343 444-1234', estado: 'pendiente', creado: 'x' };
    S2['cupos/parana-terminal__2026-10-02__t1'] = { cid: 'parana-terminal', fecha: '2026-10-02', tid: 't1', ocupados: { 'u-luis': 'p' } };
    await ctx2.addInitScript(`(${mock.toString()})(${JSON.stringify(S2)}, ${JSON.stringify([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }])})`);
    const k = await ctx2.newPage(); k.errs = []; k.on('pageerror', e => k.errs.push(e.message));
    await k.goto(FILE); await k.waitForTimeout(300); await entrar(k, 300);
    await k.evaluate(() => { location.hash = '#/coord/parana-terminal'; }); await k.waitForTimeout(500);
    await k.click('[data-confirmar="parana-terminal__2026-10-02__t1__u-luis"]'); await k.waitForTimeout(400);
    const av = await k.evaluate(() => { const a = document.getElementById('avWa'); return a && { t: document.querySelector('.sheet').innerText, href: a.getAttribute('href') }; });
    check('al confirmar, ofrece avisarle por WhatsApp con el mensaje armado', av && /¿Le avisás a Luis\?/.test(av.t) && av.href.startsWith('https://wa.me/5493434441234?text=') && /confirmado/.test(decodeURIComponent(av.href)), av);
    await k.click('#avNo'); await k.click('.sheet [data-cerrar]'); await k.waitForTimeout(150);
    check('"No volver a preguntar" queda guardado', await k.evaluate(() => localStorage.getItem('ppam-avisar-wa') === 'no' && !document.querySelector('.sheet')));
    check('sin errores (aviso por WhatsApp)', k.errs.length === 0, k.errs);
  }
  console.log('\nMovimiento, cuenta regresiva y presentación de la campaña');
  {
    SEED['campanas/futura'] = { nombre: 'Feria del libro', ciudad: 'Paraná', desde: '2026-10-12', hasta: '2026-10-18', activa: true, puntos: { p1: { nombre: 'Stand 1', tipo: 'stand', cupo: 2 } }, turnos: { t1: { punto: 'p1', desde: '09:00', hasta: '11:00', dias: [0, 1, 2, 3, 4, 5, 6] } } };
    const h = await open([], '');
    check('lista: la campaña que todavía no empezó dice "Empieza en 12 días"', await h.evaluate(() => /Empieza en 12 días/.test(document.querySelector('.cc.camp[data-go="#/c/futura"] .pronto').textContent)));
    check('lista: "Empieza mañana" y "Empieza en 3 días" según la fecha', await h.evaluate(() => /Empieza mañana/.test((document.querySelector('.cc.camp[data-go="#/c/parana-terminal"] .pronto') || {}).textContent || '') && /Empieza en 3 días/.test((document.querySelector('.cc.camp[data-go="#/c/concordia-costanera"] .pronto') || {}).textContent || '')));
    await h.evaluate(() => { window.__vts = 0; const o = document.startViewTransition && document.startViewTransition.bind(document); if (o) document.startViewTransition = (f) => { window.__vts++; return o(f); }; });
    await h.click('.cc.camp[data-go="#/c/futura"]'); await h.waitForTimeout(600);
    check('campaña futura: recuadro "Faltan 12 días para que empiece · Ya podés anotarte"', /Faltan 12 días para que empiece[\s\S]*Ya podés anotarte/.test(await text(h, '.cuenta')));
    check('al navegar se usa la transición del navegador (si la tiene)', await h.evaluate(() => !document.startViewTransition || window.__vts >= 1));
    check('sin errores (cuenta regresiva)', h.errs.length === 0, h.errs);
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    await ctx.clock.install({ time: new Date('2026-09-30T12:00:00-03:00') });
    await ctx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await ctx.addInitScript(() => { window.__introNueva = true; });
    await ctx.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, [])`);
    const i = await ctx.newPage(); i.errs = []; i.on('pageerror', e => i.errs.push(e.message));
    await i.goto(FILE); await i.waitForTimeout(400);
    await i.click('.cc.camp[data-go="#/c/futura"]'); await i.waitForTimeout(700);
    const it = await i.evaluate(() => { const x = document.querySelector('.intro'); return x && x.innerText; });
    check('primera vez: la presentación en grande con nombre, fechas, "Empieza en 12 días" y lugares libres', !!it && /Feria del libro[\s\S]*12 al 18 de octubre[\s\S]*Empieza en 12 días[\s\S]*1 punto/.test(it), it);
    await i.waitForTimeout(2600);
    check('a los 2 segundos se achica sola y queda la campaña', !(await i.$('.intro')) && /Faltan 12 días/.test(await text(i, '#app')));
    await i.click('#backBtn'); await i.waitForTimeout(500); await i.click('.cc.camp[data-go="#/c/futura"]'); await i.waitForTimeout(700);
    check('la segunda vez no se repite', !(await i.$('.intro')));
    await i.click('#backBtn'); await i.waitForTimeout(500); await i.click('.cc.camp[data-go="#/c/parana-terminal"]'); await i.waitForTimeout(700);
    await i.click('.intro'); await i.waitForTimeout(900);
    check('tocando la presentación se saltea', !(await i.$('.intro')));
    check('sin errores (presentación)', i.errs.length === 0, i.errs);
    const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' });
    await ctx2.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
    await ctx2.addInitScript(() => { window.__introNueva = true; });
    await ctx2.addInitScript(`(${mock.toString()})(${JSON.stringify(SEED)}, [])`);
    const r = await ctx2.newPage(); await r.goto(FILE + '#/c/futura'); await r.waitForTimeout(700);
    check('con "reducir movimiento" no hay presentación', !(await r.$('.intro')));
    delete SEED['campanas/futura'];
  }
  console.log('\nWeb cerrada y link personal');
  {
    const c0 = await open([], '', { cerrado: true });
    let t0 = await text(c0, '#app');
    check('sin link no se ve ninguna campaña: solo cómo entrar', /tocá el link que te mandó por WhatsApp/.test(t0) && !/Terminal de ómnibus|Costanera/.test(t0) && !(await c0.$('.cc.camp')), t0);
    check('sin barra de abajo y arriba solo "Coordinadores"', await c0.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).display === 'none' && document.getElementById('userBtn').textContent === 'Coordinadores'));
    await c0.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await c0.waitForTimeout(200);
    check('el link de una campaña tampoco muestra nada', !/Terminal de ómnibus|Andén/.test(await text(c0, '#app')) && !/Terminal/.test(await text(c0, '#tbTitle')));
    check('sin errores (web cerrada)', c0.errs.length === 0, c0.errs);
    // Entrar con el link
    SEED['hermanos/h-marta'] = { nombre: 'Marta', apellido: 'Gómez', congregacion: 'Crespo Sur (Crespo)', celular: '343 412-3412', cod: 'MARTA001', creado: '2026-09-29T10:00:00Z', por: 'coord@x.com' };
    SEED['links/MARTA001'] = { hid: 'h-marta', nombre: 'Marta', congregacion: 'Crespo Sur (Crespo)' };
    SEED['hermanos/u-luis'] = { nombre: 'Luis', apellido: 'Gómez', congregacion: 'San Agustín (Paraná)', celular: '343 555-2222', cod: 'LUIS0001', creado: '2026-09-29T10:00:00Z', por: 'coord@x.com' };
    SEED['links/LUIS0001'] = { hid: 'u-luis', nombre: 'Luis', congregacion: 'San Agustín (Paraná)', turnos: 2 };
    const c1 = await open([], '#/?cod=MARTA001', { cerrado: true }); await c1.waitForTimeout(200);
    check('con su link: "¡Hola, Marta!" y "Confirmar ingreso" (no entra solo al abrirlo)', /¡Hola, Marta![\s\S]*Crespo Sur[\s\S]*Confirmar ingreso[\s\S]*Sin contraseña ni cuenta de Google/.test(await text(c1, '#app')) && !(await c1.evaluate(() => Object.keys(window.__store).some(k => k.startsWith('sesiones/')))), await text(c1, '#app'));
    await c1.click('#cjOk'); await c1.waitForTimeout(400);
    const e1 = await c1.evaluate(() => { const s = window.__store, sk = Object.keys(s).find(k => k.startsWith('sesiones/')); return { ses: s[sk], uid: sk && sk.slice(9), h: s['hermanos/h-marta'], l: s['links/MARTA001'], hash: location.hash }; });
    check('al confirmar: el celular queda atado a Marta y el link marcado como usado', e1.ses && e1.ses.hid === 'h-marta' && e1.ses.cod === 'MARTA001' && e1.h.uid === e1.uid && !!e1.h.ultimo && !!e1.h.disp && !e1.h.aviso && e1.l.usado === true, e1);
    check('el código se borra de la dirección y entra al inicio con las campañas', e1.hash === '#/' && /Terminal de ómnibus/.test(await text(c1, '#app')) && await c1.evaluate(() => document.getElementById('userBtn').textContent === 'MG'));
    await c1.click('[data-go="#/c/parana-terminal"]'); await c1.waitForTimeout(200); await c1.click('[data-pedir="t2"]'); await c1.waitForTimeout(150);
    check('al anotarse, sus datos ya están cargados', await c1.evaluate(() => document.querySelector('#pNom').value === 'Marta' && document.querySelector('#pApe').value === 'Gómez' && document.querySelector('#pCel').value === '343 412-3412'));
    await c1.check('#pOk'); await c1.click('#pGo'); await c1.waitForTimeout(250);
    check('el pedido queda a nombre de su id de hermano, sin email', await c1.evaluate(() => { const p = window.__store['pedidos/parana-terminal__2026-10-01__t2__h-marta']; return p && p.uid === 'h-marta' && !p.email && p.congregacion === 'Crespo Sur (Crespo)' && window.__store['cupos/parana-terminal__2026-10-01__t2'].ocupados['h-marta'] === 'p'; }));
    await c1.evaluate(() => document.querySelectorAll('.ov').forEach(x => x.remove()));
    // La copia del celular dice que sigue adentro, pero en la base el link ya se usó en otro navegador: antes de anotarse se revisa
    await c1.evaluate(() => { window.__store['hermanos/h-marta'].uid = 'anon-otro-navegador'; window.__writes.length = 0; });   // sin avisar a la página (como una copia vieja)
    await c1.click('[data-pedir="t1"]').catch(() => {}); await c1.waitForTimeout(150);
    if (!(await c1.$('#pGo'))) { await c1.click('[data-dia="2026-10-02"]'); await c1.waitForTimeout(80); await c1.click('[data-pedir="t1"]'); await c1.waitForTimeout(150); }
    await c1.check('#pOk'); await c1.click('#pGo'); await c1.waitForTimeout(300);
    check('con la sesión cerrada en la base: no manda el pedido, lo dice claro y muestra que su acceso se abrió en otro lado', await c1.evaluate(() => !window.__writes.some(w => w[0] === 'batch')) && /Tu acceso se cerró en este celular/.test(await text(c1, '#toast')) && /Tu acceso se abrió en otro celular/.test(await text(c1, '#app')), await text(c1, '#app'));
    check('…y queda anotado en los errores automáticos', await c1.evaluate(() => Object.values(window.__store).some(d => d && /Pedir turno: acceso cerrado/.test(d.msg || ''))));
    await c1.evaluate(() => { window.__store['hermanos/h-marta'].uid = window.__store[Object.keys(window.__store).find(k => k.startsWith('sesiones/') && window.__store[k].hid === 'h-marta')] ? Object.keys(window.__store).find(k => k.startsWith('sesiones/') && window.__store[k].hid === 'h-marta').slice(9) : ''; });
    // Alguien entra con el mismo link en otro celular: en este se cierra
    await c1.evaluate(() => window.__ppamMock.db.doc('hermanos/h-marta').update({ uid: 'anon-otro', ultimo: '2026-09-30T14:42:00Z', disp: 'iPhone · Safari', aviso: true })); await c1.waitForTimeout(250);
    let t1 = await text(c1, '#app');
    check('si su link se usa en otro celular, en este se cierra y lo dice', /Tu acceso se abrió en otro celular[\s\S]*iPhone · Safari[\s\S]*¿Fuiste vos\?[\s\S]*¿No fuiste vos\?/.test(t1) && !/Terminal de ómnibus/.test(t1), t1);
    await c1.evaluate(() => window.__ppamMock.db.doc('hermanos/h-marta').update({ baja: true })); await c1.waitForTimeout(200);
    check('dado de baja: lo dice y no ve nada', /Tu acceso fue dado de baja/.test(await text(c1, '#app')));
    check('sin errores (entrar con el link)', c1.errs.length === 0, c1.errs);
    // El mismo link en otro celular
    SEED['links/MARTA001'].usado = true; Object.assign(SEED['hermanos/h-marta'], { uid: 'anon-viejo', ultimo: '2026-09-25T10:00:00Z' });
    const c2 = await open([], '#/?cod=MARTA001', { cerrado: true }); await c2.waitForTimeout(200);
    check('otro celular con el mismo link: "Hola de nuevo" y "Entrar desde este celular"', /Hola de nuevo, Marta[\s\S]*Entrar desde este celular[\s\S]*el otro se cierra/.test(await text(c2, '#app')), await text(c2, '#app'));
    await c2.click('#cjOk'); await c2.waitForTimeout(400);
    check('al entrar: el acceso pasa a este celular y queda el aviso para el coordinador', await c2.evaluate(() => { const h = window.__store['hermanos/h-marta']; return h.uid !== 'anon-viejo' && /^anon-/.test(h.uid) && h.aviso === true; }) && /Terminal de ómnibus/.test(await text(c2, '#app')));
    delete SEED['links/MARTA001'].usado; delete SEED['hermanos/h-marta'].uid; delete SEED['hermanos/h-marta'].ultimo;
    const c3 = await open([], '#/?cod=NOEXISTE', { cerrado: true }); await c3.waitForTimeout(200);
    check('un link anulado o mal copiado: "Este link ya no sirve"', /Este link ya no sirve[\s\S]*responsable/.test(await text(c3, '#app')));
    const c4 = await open([], '#/?cod=LUIS0001', { cerrado: true }); await c4.waitForTimeout(200);
    check('quien usaba Google: sus turnos pasan a su acceso nuevo', /¡Hola, Luis![\s\S]*Tus 2 turnos pasan a tu acceso nuevo/.test(await text(c4, '#app')));
    const c5 = await open([{ uid: 'u-g', email: 'gente@x.com', displayName: 'Gente Google', google: true }], '', { cerrado: true });
    await entrar(c5, 300);
    check('una cuenta de Google que no coordina: lo dice y no ve nada', /Esta cuenta no coordina ninguna campaña[\s\S]*gente@x.com/.test(await text(c5, '#app')) && !(await c5.$('.cc.camp')));
    // Panel del coordinador
    SEED['pedidos/parana-terminal__2026-10-03__t3__u-vieja'] = { cid: 'parana-terminal', fecha: '2026-10-03', tid: 't3', punto: 'p2', desde: '16:00', hasta: '18:00', uid: 'u-vieja', email: 'vieja@x.com', nombre: 'Elsa', apellido: 'Vieja', congregacion: 'San Agustín (Paraná)', celular: '343 555-7777', estado: 'confirmado', creado: 'x' };
    SEED['pedidos/parana-terminal__2026-09-02__t1__u-prueba'] = { cid: 'parana-terminal', fecha: '2026-09-02', tid: 't1', punto: 'p1', desde: '08:00', hasta: '10:00', uid: 'u-prueba', email: 'prueba@x.com', nombre: 'Hugo', apellido: 'Prueba', congregacion: 'San Agustín (Paraná)', celular: '343 555-1111', estado: 'confirmado', creado: 'x' };
    SEED['hermanos/h-ana2'] = { nombre: 'Ana', apellido: 'Benítez', congregacion: 'San Agustín (Paraná)', celular: '343 411-4444', cod: 'ANAB0001', uid: 'anon-ab', ultimo: '2026-09-30T10:42:00Z', disp: 'Android · Chrome', aviso: true, creado: '2026-09-20T01:00:00Z', por: 'coord@x.com', porNombre: 'Carlos Vega' };
    SEED['links/ANAB0001'] = { hid: 'h-ana2', nombre: 'Ana' };
    const k = await open([{ uid: 'u-co', email: 'coord@x.com', displayName: 'Carlos Vega' }], '');
    await entrar(k, 300); await k.click('#coordBtn'); await k.waitForTimeout(300);
    check('Coordinar: tarjeta con habilitados, sin entrar, los que usaban Google y el aviso', /Hermanos habilitados\s*1 aviso[\s\S]*habilitados · 2 todavía no entraron · 2 usaban Google/.test(await text(k, '.hcard')), await text(k, '.hcard'));
    await k.click('.hcard'); await k.waitForTimeout(300);
    let tk = await text(k, '#app');
    check('lista: aviso, "Todavía no entraron", "Usaban la página con Google" (también sin turnos por delante) y "Habilitados"', /Ana Benítez entró desde otro celular[\s\S]*Todavía no entraron[\s\S]*Luis Gómez[\s\S]*Marta Gómez[\s\S]*Usaban la página con Google[\s\S]*Elsa Vieja[\s\S]*1 turno[\s\S]*Habilitados[\s\S]*Ana Benítez/.test(tk) && /Usaban la página con Google\s*2[\s\S]*Hugo Prueba[\s\S]*Habilitados/.test(tk) && /Hermanos habilitados/.test(await text(k, '#tbTitle')), tk);
    await k.click('[data-hquitar="u-prueba"]'); await k.waitForTimeout(150);
    check('la ✕ pide confirmar y aclara que no se borra nada', /¿Quitar a Hugo Prueba de esta lista\?[\s\S]*no se borran/.test(await text(k, '.sheet')) && await k.evaluate(() => !window.__store['descartados/u-prueba']));
    await k.click('#qOk'); await k.waitForTimeout(250);
    check('la ✕ quita a alguien de "Usaban Google" (queda guardado para todos los coordinadores)', await k.evaluate(() => { const d = window.__store['descartados/u-prueba']; return d && d.por === 'coord@x.com' && d.nombre === 'Hugo Prueba'; }) && !/Usaban la página con Google[\s\S]*Hugo Prueba[\s\S]*Habilitados/.test(await text(k, '#app')) && /Quitados de la lista \(1\)/.test(await text(k, '#app')));
    await k.click('.hbajas summary'); await k.waitForTimeout(80); await k.click('[data-hvolver="u-prueba"]'); await k.waitForTimeout(250);
    check('"Volver a mostrar" lo devuelve a la lista', await k.evaluate(() => !window.__store['descartados/u-prueba']) && /Usaban la página con Google[\s\S]*Hugo Prueba[\s\S]*Habilitados/.test(await text(k, '#app')));
    await k.fill('#hBus', 'marta'); await k.waitForTimeout(400);
    check('el buscador filtra por nombre', /Marta Gómez/.test(await text(k, '#app')) && !/Luis Gómez|Ana Benítez/.test(await text(k, '#app')));
    await k.fill('#hBus', ''); await k.waitForTimeout(400);
    await k.click('[data-hok="h-ana2"]'); await k.waitForTimeout(200);
    check('"Ya está, fue ella" saca el aviso', await k.evaluate(() => window.__store['hermanos/h-ana2'].aviso === false) && !/entró desde otro celular/.test(await text(k, '#app')));
    await k.click('[data-hnuevo]'); await k.waitForTimeout(150);
    await k.fill('#hNom', 'Raúl'); await k.fill('#hApe', 'Schmidt'); await k.selectOption('#hCong', 'Paraná Centro (Paraná)'); await k.fill('#hCel', '0343 15 444-1111');
    await k.click('#hGo'); await k.waitForTimeout(100);
    check('habilitar pide confirmar que lo aprobó el comité de servicio', /comité de servicio/.test(await text(k, '#hErr')));
    await k.fill('#hCel', '343 412-3412'); await k.check('#hOk'); await k.click('#hGo'); await k.waitForTimeout(100);
    check('NO habilita dos veces el mismo celular', /ya es de Marta Gómez/.test(await text(k, '#hErr')));
    await k.fill('#hCel', '0343 15 444-1111'); await k.click('#hGo'); await k.waitForTimeout(250);
    const nh = await k.evaluate(() => { const s = window.__store, id = Object.keys(s).find(x => x.startsWith('hermanos/') && s[x].apellido === 'Schmidt'); const h = s[id]; return { id, h, l: s['links/' + (h && h.cod)], wa: (document.querySelector('#hWa') || {}).href || '' }; });
    check('habilitado: hermano con su código y el link que lo saluda', nh.h && /^[A-Z2-9]{8}$/.test(nh.h.cod) && nh.h.celular === '343 444-1111' && nh.h.por === 'coord@x.com' && !nh.h.uid && nh.l && nh.l.hid === nh.id.slice(9) && nh.l.nombre === 'Raúl', nh);
    check('"Mandarle su link por WhatsApp" a su celular, con el link personal', /wa\.me\/5493434441111\?text=/.test(nh.wa) && decodeURIComponent(nh.wa).includes('#/?cod=' + nh.h.cod) && /Guardá este mensaje/.test(decodeURIComponent(nh.wa)), nh.wa);
    await k.click('.sheet [data-cerrar]'); await k.waitForTimeout(100);
    await k.click('[data-hviejo="u-vieja"]'); await k.waitForTimeout(150);
    check('"Habilitar" a quien usaba Google trae sus datos', await k.evaluate(() => document.querySelector('#hNom').value === 'Elsa' && document.querySelector('#hCel').value === '343 555-7777') && /1 turno por delante/.test(await text(k, '.sheet')));
    await k.check('#hOk'); await k.click('#hGo'); await k.waitForTimeout(250);
    check('…con su mismo id (sus turnos quedan) y el link dice cuántos turnos pasan', await k.evaluate(() => { const h = window.__store['hermanos/u-vieja']; return h && window.__store['links/' + h.cod].turnos === 1 && window.__store['links/' + h.cod].hid === 'u-vieja'; }));
    await k.click('.sheet [data-cerrar]'); await k.waitForTimeout(100);
    await k.click('.arow[data-hfic="h-ana2"]'); await k.waitForTimeout(150);
    check('ficha: la fecha de habilitado va en horario argentino (habilitado el 19/9 a las 22 hs, no "20/9")', /Habilitado\s*Sáb 19\/9, por Carlos Vega/.test(await text(k, '.sheet')), await text(k, '.sheet'));
    check('ficha: celular, quién lo habilitó, último ingreso y las acciones', /Ana Benítez[\s\S]*343 411-4444[\s\S]*Carlos Vega[\s\S]*Android · Chrome[\s\S]*Reenviarle su link[\s\S]*Mandarle un link nuevo[\s\S]*Cambiar datos[\s\S]*Dar de baja/.test(await text(k, '.sheet')), await text(k, '.sheet'));
    await k.click('#fNuevo'); await k.waitForTimeout(250);
    const ln = await k.evaluate(() => { const h = window.__store['hermanos/h-ana2']; return { cod: h.cod, uid: h.uid, viejo: !!window.__store['links/ANAB0001'], nuevo: window.__store['links/' + h.cod] }; });
    check('link nuevo: cambia el código, cierra el celular que estaba y anula el link viejo', ln.cod !== 'ANAB0001' && ln.uid === null && !ln.viejo && ln.nuevo && ln.nuevo.hid === 'h-ana2', ln);
    await k.click('.sheet [data-cerrar]'); await k.waitForTimeout(100);
    await k.click('.arow[data-hfic="h-ana2"]'); await k.waitForTimeout(150); await k.click('#fBaja'); await k.waitForTimeout(100);
    check('dar de baja pide confirmar y explica que no se borran sus turnos', /¿Dar de baja a Ana Benítez\?[\s\S]*No se borran sus datos ni sus turnos/.test(await text(k, '.sheet')));
    await k.click('#bOk'); await k.waitForTimeout(250);
    check('dado de baja: marcado, sin celular y sin link', await k.evaluate(() => { const h = window.__store['hermanos/h-ana2']; return h.baja === true && h.uid === null && h.bajaPor === 'coord@x.com' && !window.__store['links/' + h.cod]; }) && /Dados de baja \(1\)/.test(await text(k, '#app')));
    check('un coordinador NO ve "Borrar para siempre"', await (async () => { await k.click('summary'); await k.waitForTimeout(80); await k.click('.hbajas .arow[data-hfic="h-ana2"]'); await k.waitForTimeout(150); const no = !(await k.$('#fBorrar')); await k.click('.sheet [data-cerrar]').catch(() => {}); await k.evaluate(() => document.querySelectorAll('.ov').forEach(x => x.remove())); return no; })());
    check('sin errores (panel de hermanos)', k.errs.length === 0, k.errs);
    {
      const ad = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/hermanos'); await entrar(ad, 300);
      await ad.evaluate(() => window.__ppamMock.db.doc('hermanos/h-ana2').update({ baja: true })); await ad.evaluate(() => { location.hash = '#/hermanos'; }); await ad.waitForTimeout(300);
      await ad.click('summary'); await ad.waitForTimeout(80); await ad.click('.hbajas .arow[data-hfic="h-ana2"]'); await ad.waitForTimeout(150);
      await ad.click('#fBorrar'); await ad.waitForTimeout(100);
      check('el administrador borra para siempre a un dado de baja (pide confirmar)', /¿Borrar a Ana Benítez para siempre\?/.test(await text(ad, '.sheet')));
      await ad.click('#dOk'); await ad.waitForTimeout(200);
      check('…y sale de la lista', await ad.evaluate(() => !window.__store['hermanos/h-ana2']) && !/Dados de baja/.test(await text(ad, '#app')));
      check('sin errores (borrar hermano)', ad.errs.length === 0, ad.errs);
    }
    ['hermanos/h-marta', 'links/MARTA001', 'hermanos/u-luis', 'links/LUIS0001', 'pedidos/parana-terminal__2026-10-03__t3__u-vieja', 'pedidos/parana-terminal__2026-09-02__t1__u-prueba', 'hermanos/h-ana2', 'links/ANAB0001'].forEach(x => delete SEED[x]);
  }

  console.log('\nTarjeta del inicio cuando no hay turnos esta semana');
  {
    const D = [5, 6, 0];
    const camp = (nombre, ciudad, desde, hasta) => ({ nombre, ciudad, desde, hasta, activa: true, puntos: { p1: { nombre: 'Carrito 1', tipo: 'carrito', cupo: 2 }, p2: { nombre: 'Carrito 2', tipo: 'carrito', cupo: 2 } }, turnos: { a: { punto: 'p1', desde: '08:30', hasta: '10:30', dias: D }, b: { punto: 'p2', desde: '10:30', hasta: '12:30', dias: D } } });
    const base = { 'config/publico': SEED['config/publico'], 'config/admins': SEED['config/admins'] };
    const ver = async (seed, cuando) => {
      const cx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Argentina/Buenos_Aires' });
      await cx.clock.install({ time: new Date(cuando) }); await cx.route(/gstatic|googleapis|openstreetmap/, r => r.abort());
      await cx.addInitScript(`(${mock.toString()})(${JSON.stringify(seed)}, [])`);
      const q = await cx.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message)); await q.goto(FILE); await q.waitForTimeout(400); return q;
    };
    const dos = Object.assign({}, base, { 'campanas/crespo': camp('Campaña de Predicación Pública Fiesta Nacional de la Avicultura', 'Crespo', '2026-11-06', '2026-11-08'), 'campanas/viale': camp('Campaña Especial - Viale "Fiesta Nacional Asado con Cuero"', 'Viale', '2026-11-20', '2026-11-22') });
    let q = await ver(dos, '2026-10-18T14:30:00-03:00');
    let w = await text(q, '.welcome');
    check('sin turnos esta semana: "La próxima campaña empieza en 19 días", con nombre, ciudad, fechas y lugares libres', /La próxima campaña empieza en 19 días\s*Fiesta Nacional de la Avicultura · Crespo · 6 al 8 de noviembre\.\s*Ya podés anotarte\. Hay 12 lugares libres la primera semana\.\s*Ver turnos/.test(w) && !/0 lugares libres/.test(w), w);
    check('"Ver turnos" lleva a esa campaña', await q.evaluate(() => document.querySelector('.welcome [data-go]').dataset.go === '#/c/crespo'));
    check('sin errores (próxima campaña)', q.errs.length === 0, q.errs);
    const llena = JSON.parse(JSON.stringify(dos));
    ['2026-11-06', '2026-11-07', '2026-11-08'].forEach(f => ['a', 'b'].forEach(t => { llena[`cupos/crespo__${f}__${t}`] = { cid: 'crespo', fecha: f, tid: t, ocupados: { x1: 'c', x2: 'c' } }; }));
    q = await ver(llena, '2026-11-03T14:30:00-03:00');
    w = await text(q, '.welcome');
    check('turnos esta semana pero todo ocupado: "Esta semana ya está todo cubierto" y ofrece la siguiente', /Esta semana ya está todo cubierto\s*Los turnos de Fiesta Nacional de la Avicultura \(Crespo\) ya están completos\.\s*La próxima: Fiesta Nacional Asado con Cuero · Viale · 20 al 22 de noviembre, en 17 días\. Hay 12 lugares libres la primera semana\.\s*Ver la próxima campaña/.test(w), w);
    check('…y el botón lleva a la siguiente', await q.evaluate(() => document.querySelector('.welcome [data-go]').dataset.go === '#/c/viale'));
    q = await ver(dos, '2026-11-03T14:30:00-03:00');
    check('con lugar esta semana: sigue "¿Te sumás esta semana?"', /¿Te sumás esta semana\?\s*En Entre Ríos hay 12 lugares libres en los próximos 7 días\./.test(await text(q, '.welcome')), await text(q, '.welcome'));
    q = await ver(base, '2026-10-18T14:30:00-03:00');
    check('sin campañas por delante: sin tarjeta y la lista lo explica', !(await q.$('.welcome')) && /Por ahora no hay campañas programadas\.\s*Cuando haya una, la vas a ver acá/.test(await text(q, '#app')), await text(q, '#app'));
    check('sin errores (tarjeta del inicio)', q.errs.length === 0, q.errs);
  }

  console.log('\nCampaña corta: solo sus días');
  {
    SEED['campanas/corta'] = { nombre: 'Fin de semana', ciudad: 'Crespo', desde: '2026-11-06', hasta: '2026-11-07', activa: true,
      puntos: { p1: { nombre: 'Carrito 1', tipo: 'carrito', cupo: 2 }, p2: { nombre: 'Carrito 2', tipo: 'carrito', cupo: 2 } },
      turnos: { t1: { punto: 'p1', desde: '09:00', hasta: '11:00', dias: [1, 5, 6] } } };
    const k = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/coord/corta');
    await entrar(k, 300); await k.evaluate(() => { location.hash = '#/coord/corta'; }); await k.waitForTimeout(300);
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
  {
    console.log('\nComodidades, clima, compañeros de turno y avisar al coordinador');
    const orig = JSON.parse(JSON.stringify(SEED));
    const cp = SEED['campanas/parana-terminal'];
    cp.contacto = '343 555-1234';
    Object.assign(cp.puntos.p1, { lat: -31.741234, lng: -60.523678, direccion: 'Av. Ramírez 2598', comod: { sombra: true, estac: true, bano: true }, lugares: { estac: { lat: -31.7402, lng: -60.5248, nota: 'Playa de la terminal, gratis la primera hora' }, bano: { nota: 'Dentro de la terminal, al fondo' } }, pubs: 'Español e inglés. Folletos y tarjetas.' });
    SEED['pedidos/parana-terminal__2026-10-01__t2__u-ana'] = { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't2', punto: 'p1', desde: '10:00', hasta: '12:00', uid: 'u-ana', nombre: 'Ana', apellido: 'Paz', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', estado: 'confirmado', creado: '2026-09-29T10:00:00Z' };
    SEED['cupos/parana-terminal__2026-10-01__t2'] = { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't2', ocupados: { 'u-ana': 'c', 'u-luis': 'c', 'u-rosa': 'c', otro3: 'p' } };
    SEED['companeros/parana-terminal__2026-10-01__t2'] = { cid: 'parana-terminal', fecha: '2026-10-01', n: { 'u-luis': 'Luis Benítez · Crespo Sur (Crespo)', otro3: 'Pendiente Prueba · Otra' } };
    SEED['companeros/parana-terminal__2026-09-02__t1'] = { cid: 'parana-terminal', fecha: '2026-09-02', n: { viejo1: 'Viejo Prueba' } };
    const pub = { uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' };
    const k = await open([pub], '#/t/' + encodeURIComponent('parana-terminal__2026-10-01__t2__u-ana'));
    await k.waitForTimeout(500);
    const det = await text(k, '#app');
    check('detalle del turno: el pronóstico para esa hora', /Mayormente soleado/.test(await text(k, '#clima')) && /de 10\D+a 12/.test(await text(k, '#clima')) && /10% de lluvia/.test(await text(k, '#clima')) && /20°/.test(await text(k, '#clima')), await text(k, '#clima'));
    check('van con vos: solo los confirmados que mostraron su nombre (y cuántos más)', /Van con vos\s*LB\s*Luis Benítez\s*Crespo Sur \(Crespo\)\s*1\s*1 hermano más/i.test(await text(k, '#comp')) && !/Pendiente Prueba/.test(det), await text(k, '#comp'));
    check('y avisa que tu nombre no se ve', /no ven tu nombre/.test(await text(k, '#comp')));
    const av = await k.evaluate(() => { const a = document.querySelector('a.avisar'); return a && decodeURIComponent(a.href); });
    check('botón "Avisar al coordinador que no puedo ir" con el WhatsApp de la campaña y el turno escrito', !!av && av.startsWith('https://wa.me/5493435551234?text=') && /Hola, soy Ana Paz \(San Agustín \(Paraná\)\)\. No voy a poder ir a mi turno del jueves 1 de octubre de 10:00 a 12:00 en Andén 1 \(Terminal de ómnibus\)\./.test(av), av);
    await k.click('[data-compartir]'); await k.waitForTimeout(300);
    check('"Mostrarlo": pone solo su nombre y congregación (sin celular)', await k.evaluate(() => window.__store['companeros/parana-terminal__2026-10-01__t2'].n['u-ana'] === 'Ana Paz · San Agustín (Paraná)') && /✓ Tus compañeros de este turno ven tu nombre/.test(await text(k, '#comp')));
    await k.click('[data-compartir]'); await k.waitForTimeout(300);
    check('"Dejar de mostrarlo" lo saca', await k.evaluate(() => !('u-ana' in window.__store['companeros/parana-terminal__2026-10-01__t2'].n)));
    await k.click('[data-lugar]'); await k.waitForTimeout(250);
    const lug = await text(k, '.ov:last-child .sheet');
    check('ver lugar: comodidades (las que tienen lugar se pueden tocar) y publicaciones', /Sombra\s*Estacionamiento\s*Baño/.test(lug) && await k.evaluate(() => !!document.querySelector('.cmds span.cmd') && !!document.querySelector('[data-comod="parana-terminal|p1|estac"]') && !!document.querySelector('[data-comod="parana-terminal|p1|bano"]')) && /Publicaciones en el carrito\s*Español e inglés/i.test(lug), lug);
    await k.click('[data-comod="parana-terminal|p1|estac"]'); await k.waitForTimeout(250);
    const es = await text(k, '.ov:last-child .sheet');
    check('estacionamiento: distancia caminando, nota y "Cómo llegar en auto"', /Estacionamiento/.test(es) && /unos 1\d0 m caminando hasta el carrito · 2 minutos/.test(es) && /Playa de la terminal/.test(es) && await k.evaluate(() => /destination=-31\.7402,-60\.5248&travelmode=driving/.test(document.querySelector('.ov:last-child a.go').href)), es);
    await k.click('.ov:last-child [data-cerrar]'); await k.waitForTimeout(100);
    await k.click('[data-comod="parana-terminal|p1|bano"]'); await k.waitForTimeout(200);
    check('baño sin ubicación: solo la nota, sin mapa', /Dentro de la terminal, al fondo/.test(await text(k, '.ov:last-child .sheet')) && !(await k.$('.ov:last-child .cmapa')));
    await k.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.remove()));
    await k.click('.grid4 a.pr'); await k.waitForTimeout(200);
    check('"Llegar" con estacionamiento cargado pregunta cómo vas', /¿Cómo vas\?/.test(await text(k, '.ov .sheet')) && await k.evaluate(() => { const o = [...document.querySelectorAll('.ov a.opt')]; return o.length === 2 && /destination=-31\.741234,-60\.523678/.test(o[0].href) && /destination=-31\.7402,-60\.5248&travelmode=driving/.test(o[1].href); }) && /En auto\s*Te lleva al estacionamiento · después unos 1\d0 m caminando/.test(await text(k, '.ov .sheet')), await text(k, '.ov .sheet'));
    await k.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.remove()));
    await k.evaluate(() => { location.hash = '#/c/parana-terminal'; }); await k.waitForTimeout(250);
    await k.click('[data-dia="2026-10-03"]'); await k.waitForTimeout(80); await k.click('[data-pedir="t1"]'); await k.waitForTimeout(150);
    check('pedir turno: la casilla de mostrar el nombre viene apagada', await k.evaluate(() => !!document.getElementById('pComp') && !document.getElementById('pComp').checked));
    await k.check('#pComp'); await k.check('#pOk'); await k.click('#pGo'); await k.waitForTimeout(400);
    check('con la casilla marcada, al anotarse queda su nombre para los compañeros', await k.evaluate(() => (window.__store['companeros/parana-terminal__2026-10-03__t1'] || { n: {} }).n['u-ana'] === 'Ana Paz · San Agustín (Paraná)' && window.__store['companeros/parana-terminal__2026-10-03__t1'].cid === 'parana-terminal'));
    await k.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.remove()));
    await k.click('#userBtn'); await k.waitForTimeout(150);
    check('"Mis datos": queda marcado para los próximos turnos', await k.evaluate(() => !!document.getElementById('uComp') && document.getElementById('uComp').checked));
    check('sin errores (comodidades, clima, compañeros)', k.errs.length === 0, k.errs);
    const c = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/coord/parana-terminal'); await entrar(c, 400);
    check('el coordinador borra los nombres de turnos que ya pasaron', await c.evaluate(() => !window.__store['companeros/parana-terminal__2026-09-02__t1'] && !!window.__store['companeros/parana-terminal__2026-10-01__t2']));
    await c.click('[data-tab="config"]'); await c.waitForTimeout(150); await c.click('[data-aj="campana"]'); await c.waitForTimeout(150);
    check('datos de la campaña: el WhatsApp de contacto', await c.evaluate(() => document.getElementById('cfCon').value === '343 555-1234'));
    await c.fill('#cfCon', '343 4'); await c.click('#cfSave'); await c.waitForTimeout(150);
    check('no guarda un WhatsApp que no es un celular', await c.evaluate(() => window.__store['campanas/parana-terminal'].contacto === '343 555-1234') && /no parece un celular/.test(await text(c, '#toast')));
    await c.fill('#cfCon', ''); await c.click('#cfSave'); await c.waitForTimeout(200);
    check('vacío lo quita (y el botón de avisar no aparece)', await c.evaluate(() => !('contacto' in window.__store['campanas/parana-terminal'])));
    await c.click('[data-aj="puntos"]'); await c.waitForTimeout(150); await c.click('#pc-p1 .pt .sbtn'); await c.waitForTimeout(250);
    check('editar punto: comodidades marcadas y el estacionamiento ubicado', await c.evaluate(() => [...document.querySelectorAll('.cmsel input')].map(x => x.dataset.cm + (x.checked ? '1' : '0')).join() === 'sombra1,sentarse0,estac1,bano1' && !document.getElementById('lx-estac').classList.contains('hidden') && /Ubicado en el mapa · a unos 1\d0 m del punto/.test(document.getElementById('lxOk-estac').textContent) && document.getElementById('lxNota-bano').value === 'Dentro de la terminal, al fondo'), await c.evaluate(() => document.getElementById('lxOk-estac').textContent));
    await c.click('.cmsel label:has([data-cm="sombra"])'); await c.click('.cmsel label:has([data-cm="sentarse"])'); await c.click('.cmsel label:has([data-cm="bano"])');
    check('al destildar el baño se esconde su recuadro', await c.evaluate(() => document.getElementById('lx-bano').classList.contains('hidden')));
    await c.fill('#ptPubs', 'Solo español'); await c.click('#ptOk'); await c.waitForTimeout(250);
    check('guarda comodidades, el lugar del estacionamiento y las publicaciones', await c.evaluate(() => { const p = window.__store['campanas/parana-terminal'].puntos.p1; return JSON.stringify(p.comod) === '{"sentarse":true,"estac":true}' && p.lugares.estac.lat === -31.7402 && p.lugares.estac.nota === 'Playa de la terminal, gratis la primera hora' && !p.lugares.bano && p.pubs === 'Solo español'; }), await c.evaluate(() => window.__store['campanas/parana-terminal'].puntos.p1));
    check('sin errores (coordinador)', c.errs.length === 0, c.errs);
    Object.keys(SEED).forEach(x => delete SEED[x]); Object.assign(SEED, orig);
  }
  {
    console.log('\nPublicaciones y carritos con QR');
    const orig = JSON.parse(JSON.stringify(SEED));
    const cp = SEED['campanas/parana-terminal'];
    cp.pubsOn = true;
    cp.carritos = { k1: { n: 1, color: 'azul', cod: 'K7Q2M9XA', habitual: 'p1', items: { pA: 40, pD: 40, pT: 100 } }, k2: { n: 2, color: 'verde', cod: 'P3ZT8WLC', habitual: 'p2', items: { pA: 20, pF: 15 } } };
    SEED['publicaciones/pA'] = { nombre: 'La Atalaya', tipo: 'Revista', idioma: 'Español', edicion: 'N.º 1 de 2026' };
    SEED['publicaciones/pD'] = { nombre: '¡Despertad!', tipo: 'Revista', idioma: 'Español' };
    SEED['publicaciones/pT'] = { nombre: 'Tarjeta de contacto', tipo: 'Tarjeta', idioma: 'Español' };
    SEED['publicaciones/pF'] = { nombre: 'Escuche a Dios', tipo: 'Folleto', idioma: 'Español' };
    SEED['pedidos/parana-terminal__2026-10-01__t2__u-ana'] = { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't2', punto: 'p1', desde: '10:00', hasta: '12:00', uid: 'u-ana', nombre: 'Ana', apellido: 'Paz', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', estado: 'confirmado', creado: '2026-09-29T10:00:00Z' };
    SEED['cupos/parana-terminal__2026-10-01__t2'] = { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't2', ocupados: { 'u-ana': 'c' } };
    SEED['entregas/parana-terminal__2026-10-01__t1'] = { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't1', k: 'k2', modo: 'qr', items: { pA: 3 }, por: 'otro1', porNombre: 'Luis Benítez', at: '2026-10-01T13:05:00Z' };
    const pub = { uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' };
    const k = await open([pub], '', { reloj: '2026-10-01T12:40:00-03:00' }); await k.waitForTimeout(500);
    check('inicio: al terminar el turno, "Escaneá el carrito y contá lo que se dejó"', /Terminó tu turno · Andén 1\s*Escaneá el carrito y contá lo que se dejó/.test(await text(k, '#app')) && !!(await k.$('.avcont [data-contar]')), (await text(k, '#app')).slice(0, 200));
    await k.click('.avcont [data-contar]'); await k.waitForTimeout(400);
    check('el escáner se abre adentro de la app, con los números de los carritos por si falla la cámara', await k.evaluate(() => !!document.querySelector('.esc video') && [...document.querySelectorAll('.esc [data-kman]')].map(b => b.textContent).join() === '1,2'));
    await k.click('.esc [data-kman="k1"]'); await k.waitForTimeout(300);
    const ct = await text(k, '.ov .sheet');
    check('contar: el carrito elegido y sus publicaciones (con tipo e idioma)', !(await k.$('.esc')) && /Carrito 1 · azul\s*Elegido a mano/.test(ct) && /La Atalaya\s*Revista · Español · N\.º 1 de 2026/.test(ct) && /¡Despertad!/.test(ct) && /Tarjeta de contacto/.test(ct) && !/Escuche a Dios/.test(ct), ct.slice(0, 300));
    await k.click('[data-mas="pA"]'); await k.click('[data-mas="pA"]'); await k.click('[data-mas="pA"]'); await k.click('[data-mn="pA"]'); await k.fill('[data-cnt="pT"]', '12');
    await k.click('#ctOk'); await k.waitForTimeout(300);
    check('guarda lo entregado: solo cantidades, el carrito y quién lo cargó', await k.evaluate(() => { const e = window.__store['entregas/parana-terminal__2026-10-01__t2']; return e && e.k === 'k1' && e.modo === 'mano' && JSON.stringify(e.items) === '{"pA":2,"pT":12}' && e.por === 'u-ana' && e.porNombre === 'Ana Paz' && e.cid === 'parana-terminal' && e.tid === 't2' && !('celular' in e); }), await k.evaluate(() => window.__store['entregas/parana-terminal__2026-10-01__t2']));
    check('y el aviso del inicio se va', !(await k.$('.avcont')));
    await k.evaluate(() => { location.hash = '#/t/' + encodeURIComponent('parana-terminal__2026-10-01__t2__u-ana'); }); await k.waitForTimeout(400);
    check('detalle del turno: lo entregado, el carrito, quién lo cargó y "Corregir"', /Lo entregado en este turno\s*2 La Atalaya · 12 Tarjeta de contacto\s*Carrito 1 · azul · Lo cargó Ana Paz/i.test(await text(k, '#entr')) && !!(await k.$('[data-corregir]')), await text(k, '#entr'));
    await k.click('[data-corregir]'); await k.waitForTimeout(300);
    check('"Corregir" abre lo cargado', await k.evaluate(() => document.querySelector('[data-cnt="pA"]').value === '2' && document.querySelector('[data-cnt="pT"]').value === '12' && /ya lo cargó Ana Paz/.test(document.querySelector('.ov .sheet').innerText)));
    await k.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.remove()));
    await k.evaluate(() => { location.hash = '#/k/P3ZT8WLC'; }); await k.waitForTimeout(400);
    check('abrir el QR de un carrito (link) lleva a contar con ese carrito', /Carrito 2 · verde\s*✓ Escaneado/.test(await text(k, '.ov .sheet')) && /Escuche a Dios/.test(await text(k, '.ov .sheet')), await text(k, '.ov .sheet'));
    await k.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.remove()));
    await k.evaluate(() => { location.hash = '#/k/ZZZZZZZZ'; }); await k.waitForTimeout(300);
    check('un QR que no es de ningún carrito', /No encontramos ese carrito/.test(await text(k, '.ov .sheet')));
    check('sin errores (carritos, hermano)', k.errs.length === 0, k.errs);
    const pq = await open([], '#/k/K7Q2M9XA', { cerrado: true });
    check('alguien sin la app que escanea el QR: mensaje para el público con jw.org', /Este carrito es de la predicación pública/.test(await text(pq, '#app')) && await pq.evaluate(() => /^https:\/\/www\.jw\.org\//.test(document.querySelector('#app a.btn').href)) && /¿Sos publicador\?/.test(await text(pq, '#app')));
    const c = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/coord/parana-terminal', { reloj: '2026-10-01T12:40:00-03:00' }); await entrar(c, 400);
    await c.click('[data-tab="dia"]'); await c.waitForTimeout(300);
    check('del día: lo que se dejó en cada turno, con el carrito y quién lo cargó', /Se dejaron: 3 La Atalaya\s*Carrito 2 · verde \(escaneado\) · cargó Luis Benítez/.test(await text(c, '#dt-t1')) && /Sin contar lo que se dejó/.test(await text(c, '#dt-t2')), [await text(c, '#dt-t1'), await text(c, '#dt-t2')]);
    await c.click('[data-tab="config"]'); await c.waitForTimeout(200); await c.click('[data-aj="carritos"]'); await c.waitForTimeout(300);
    const kt = await text(c, '#cTab');
    check('ajustes, carritos: la lista y el aviso de carrito fuera de su lugar', /Carrito 1 · azul\s*Habitual: Andén 1\s*40 La Atalaya · 40 ¡Despertad! · 100 Tarjeta de contacto/.test(kt) && /El carrito 2 · verde se usó en Andén 1 el jueves 1 de octubre/.test(kt) && /Imprimir etiquetas/.test(kt), kt.slice(0, 500));
    await c.click('[data-knuevo]'); await c.waitForTimeout(300);
    check('carrito nuevo: número siguiente y color', await c.evaluate(() => document.getElementById('kN').value === '3' && document.getElementById('kCol').value === 'rojo'));
    await c.selectOption('#kAdd', 'pF'); await c.waitForTimeout(80); await c.fill('[data-kq="pF"]', '25'); await c.selectOption('#kHab', 'p2');
    await c.click('#kOk'); await c.waitForTimeout(300);
    check('guarda el carrito con su código para el QR', await c.evaluate(() => { const ks = Object.values(window.__store['campanas/parana-terminal'].carritos); const n = ks.find(x => x.n === 3); return !!n && /^[A-Z2-9]{8}$/.test(n.cod) && n.habitual === 'p2' && JSON.stringify(n.items) === '{"pF":25}' && n.color === 'rojo'; }));
    await c.click('[data-knuevo]'); await c.waitForTimeout(300); await c.fill('#kN', '1'); await c.click('#kOk'); await c.waitForTimeout(150);
    check('no deja dos carritos con el mismo número', /Ya hay un carrito 1/.test(await text(c, '#toast')));
    await c.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.remove()));
    await c.click('[data-kficha="k2"]'); await c.waitForTimeout(300);
    check('ficha del carrito: publicaciones y últimos turnos', /Carrito 2 · verde/.test(await text(c, '.ov .sheet')) && /Jueves 1 de octubre · Andén 1[\s\S]*3 La Atalaya · Luis Benítez/.test(await text(c, '.ov .sheet')), await text(c, '.ov .sheet'));
    await c.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.remove()));
    await c.evaluate(() => { location.hash = '#/coord/concordia-costanera'; }); await c.waitForTimeout(300); await c.click('[data-tab="config"]'); await c.waitForTimeout(200);
    check('en una campaña con la cuenta apagada no aparece "Carritos"', !(await c.$('[data-aj="carritos"]')));
    await c.evaluate(() => { location.hash = '#/admin'; }); await c.waitForTimeout(400);
    check('administración: la lista de publicaciones de la provincia', /Publicaciones \(toda la provincia\)[\s\S]*¡Despertad![\s\S]*La Atalaya\s*Revista · Español · N\.º 1 de 2026/.test(await text(c, '#app')));
    await c.click('[data-pubnueva]'); await c.waitForTimeout(200); await c.fill('#puN', 'Disfrute de la vida'); await c.selectOption('#puT', 'Libro'); await c.fill('#puE', '2025'); await c.click('#puOk'); await c.waitForTimeout(300);
    check('agrega una publicación', await c.evaluate(() => Object.values(window.__store).some(x => x && x.nombre === 'Disfrute de la vida' && x.tipo === 'Libro' && x.idioma === 'Español' && x.edicion === '2025')));
    check('sin errores (carritos, coordinador)', c.errs.length === 0, c.errs);
    Object.keys(SEED).forEach(x => delete SEED[x]); Object.assign(SEED, orig);
  }
  {
    console.log('\nMantenimiento de los carritos');
    const orig = JSON.parse(JSON.stringify(SEED));
    const cp = SEED['campanas/parana-terminal'];
    Object.assign(cp, { pubsOn: true, mantOn: true, revDias: 30 });
    cp.carritos = { k1: { n: 1, color: 'azul', cod: 'K7Q2M9XA', habitual: 'p1', items: { pA: 40 }, revisado: '2026-08-20' }, k2: { n: 2, color: 'verde', cod: 'P3ZT8WLC', habitual: 'p2', items: { pA: 20 }, estado: 'rep', motivo: 'Rueda trasera rota' } };
    SEED['publicaciones/pA'] = { nombre: 'La Atalaya', tipo: 'Revista', idioma: 'Español' };
    SEED['pedidos/parana-terminal__2026-10-01__t2__u-ana'] = { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't2', punto: 'p1', desde: '10:00', hasta: '12:00', uid: 'u-ana', nombre: 'Ana', apellido: 'Paz', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', estado: 'confirmado', creado: '2026-09-29T10:00:00Z' };
    SEED['cupos/parana-terminal__2026-10-01__t2'] = { cid: 'parana-terminal', fecha: '2026-10-01', tid: 't2', ocupados: { 'u-ana': 'c' } };
    SEED['problemas/prv1'] = { cid: 'parana-terminal', k: 'k1', tipo: 'Lona o cartel', nota: 'La lona está rota', noUsar: true, por: 'otro1', porNombre: 'Luis Benítez', at: '2026-09-30T20:00:00Z', estado: 'nuevo' };
    const pub = { uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' };
    const k = await open([pub], '#/t/' + encodeURIComponent('parana-terminal__2026-10-01__t2__u-ana'), { reloj: '2026-10-01T12:40:00-03:00' }); await k.waitForTimeout(500);
    await k.click('#entr [data-contar]'); await k.waitForTimeout(300); await k.click('.esc [data-kman="k1"]'); await k.waitForTimeout(300);
    await k.click('[data-mas="pA"]'); await k.click('#ctOk'); await k.waitForTimeout(300);
    check('después de contar: "¿El carrito quedó bien?"', /¿El carrito quedó bien\?/.test(await text(k, '.ov .sheet')) && /Sí, todo bien\s*Tiene un problema/.test(await text(k, '.ov .sheet')));
    await k.click('#qbNo'); await k.waitForTimeout(200);
    await k.click('#prOk'); await k.waitForTimeout(100);
    check('para avisar hay que elegir qué le pasa', /Elegí qué le pasa/.test(await text(k, '#prErr')));
    await k.click('[data-pt="Rueda"]'); await k.click('[data-pt="Freno"]'); await k.click('[data-pt="Freno"]'); await k.fill('#prN', 'La rueda de adelante está floja'); await k.check('#prNo'); await k.click('#prOk'); await k.waitForTimeout(300);
    check('el problema le llega al coordinador (sin datos de más)', await k.evaluate(() => { const p = Object.keys(window.__store).filter(x => x.startsWith('problemas/') && x !== 'problemas/prv1').map(x => window.__store[x]); return p.length === 1 && p[0].tipo === 'Rueda' && p[0].nota === 'La rueda de adelante está floja' && p[0].noUsar === true && p[0].k === 'k1' && p[0].por === 'u-ana' && p[0].porNombre === 'Ana Paz' && p[0].estado === 'nuevo' && p[0].turno === 'parana-terminal__2026-10-01__t2' && !('celular' in p[0]); }), await k.evaluate(() => Object.keys(window.__store).filter(x => x.startsWith('problemas/')).map(x => window.__store[x])));
    check('y en el detalle queda "Informar un problema del carrito"', !!(await k.$('#entr [data-probk]')));
    await k.evaluate(() => { location.hash = '#/k/P3ZT8WLC'; }); await k.waitForTimeout(400);
    check('un carrito en reparación avisa al escanearlo (con el motivo)', /Este carrito está en reparación\s*Rueda trasera rota/.test(await text(k, '.ov:last-of-type .sheet')), await text(k, '.ov:last-of-type .sheet'));
    check('sin errores (mantenimiento, hermano)', k.errs.length === 0, k.errs);
    const c = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/coord/parana-terminal', { reloj: '2026-10-01T12:40:00-03:00' }); await entrar(c, 400);
    await c.click('[data-tab="config"]'); await c.waitForTimeout(200); await c.click('[data-aj="campana"]'); await c.waitForTimeout(200);
    check('datos de la campaña: el interruptor de mantenimiento y cada cuánto revisar', await c.evaluate(() => document.getElementById('cfMant').checked && document.getElementById('cfRev').value === '30'));
    await c.click('[data-aj="carritos"]'); await c.waitForTimeout(300);
    const kt = await text(c, '#cTab');
    check('carritos: estado, problemas nuevos y revisión vencida', /Carrito 1 · azul[\s\S]*Disponible\s*1 problema nuevo\s*Revisar · hace 42 días/.test(kt) && /Carrito 2 · verde[\s\S]*En reparación/.test(kt), kt.slice(0, 600));
    check('avisos: pidieron que no se use, y un punto que se queda sin carrito', /Pidieron que no se use el carrito 1 · azul/.test(kt) && /Hall central se queda sin carrito/.test(kt), kt.slice(0, 900));
    await c.click('[data-kficha="k1"]'); await c.waitForTimeout(400);
    const fk = await text(c, '.ov .sheet');
    check('ficha: el problema con quién lo informó, y la revisión', /Lona o cartel · Nuevo/.test(fk) && /Pidió que no se use/.test(fk) && /Luis Benítez/.test(fk) && /Última: 20 ago · cada 30 días\s*Ya le toca/.test(fk), fk.slice(0, 600));
    await c.click('[data-pest="prv1|arreglo"]'); await c.waitForTimeout(500);
    check('"En arreglo" cambia el estado del problema', await c.evaluate(() => window.__store['problemas/prv1'].estado === 'arreglo' && window.__store['problemas/prv1'].cambio.por === 'admin@x.com'));
    await c.click('[data-kest="rep"]'); await c.waitForTimeout(250); await c.fill('#kMot', 'Lona rota'); await c.click('#kMOk'); await c.waitForTimeout(500);
    check('marcar en reparación con el motivo', await c.evaluate(() => { const k = window.__store['campanas/parana-terminal'].carritos.k1; return k.estado === 'rep' && k.motivo === 'Lona rota'; }));
    await c.click('[data-krev]'); await c.waitForTimeout(250); await c.uncheck('[data-rv="1"]'); await c.click('#rvOk'); await c.waitForTimeout(500);
    check('revisión: queda la fecha y lo que falló pasa a ser un problema', await c.evaluate(() => { const k = window.__store['campanas/parana-terminal'].carritos.k1; const p = Object.values(window.__store).filter(x => x && x.k === 'k1' && x.tipo === 'Frenos'); return k.revisado === '2026-10-01' && k.revs[0].mal.join() === 'Frenos' && p.length === 1 && p[0].estado === 'nuevo'; }));
    check('sin errores (mantenimiento, coordinador)', c.errs.length === 0, c.errs);
    Object.keys(SEED).forEach(x => delete SEED[x]); Object.assign(SEED, orig);
  }
  {
    console.log('\nPantalla ancha (PC)');
    const pub = { uid: 'u-ana', email: 'ana@x.com', displayName: 'Ana Paz' };
    const q = await open([pub], '', { ancho: 1440 });
    const ui = () => q.evaluate(() => ({ dir: getComputedStyle(document.getElementById('tabbar')).flexDirection, marca: getComputedStyle(document.querySelector('#tabbar .sbrand')).display !== 'none', cols: !!document.querySelector('.hcols .hizq .welcome') && !!document.querySelector('.hcols .hder .ccs .camp') }));
    check('PC: menú al costado, con la marca, y el inicio en dos columnas', JSON.stringify(await ui()) === JSON.stringify({ dir: 'column', marca: true, cols: true }), await ui());
    await q.click('[data-go="#/c/parana-terminal"]'); await q.waitForTimeout(200);
    const cal = () => q.evaluate(() => { const c = document.querySelector('.ccols .cizq .days.mcal'); return c ? { dias: c.querySelectorAll('.day').length, vacios: c.querySelectorAll('.nd').length, sem: c.querySelectorAll('.wd').length, ancho: c.offsetWidth > 250, mes: document.querySelector('.cal-h b').textContent, flechas: !!document.querySelector('[data-calmes]') } : null; });
    check('PC: la campaña muestra el mes entero como calendario (sin domingos con turnos), turnos a la derecha', JSON.stringify(await cal()) === JSON.stringify({ dias: 27, vacios: 4, sem: 7, ancho: true, mes: 'Octubre 2026', flechas: false }) && !!(await q.$('.cder [data-pedir="t1"]')), await cal());
    await q.click('[data-dia="2026-10-03"]'); await q.waitForTimeout(80);
    check('PC: tocar un día del calendario cambia los turnos', /Sábado 3 de octubre/.test(await text(q, '.cder')) && await q.evaluate(() => document.querySelector('[data-dia="2026-10-03"]').classList.contains('on')));
    await q.evaluate(() => { location.hash = '#/c/concordia-costanera'; }); await q.waitForTimeout(250);
    check('PC: campaña de dos meses con flechas (la de atrás apagada)', await q.evaluate(() => document.querySelector('.cal-h b').textContent === 'Octubre 2026' && document.querySelector('[data-calmes="-1"]').disabled && !document.querySelector('[data-calmes="1"]').disabled));
    await q.click('[data-calmes="1"]'); await q.waitForTimeout(100);
    check('PC: la flecha pasa a noviembre y elige su primer día', await q.evaluate(() => document.querySelector('.cal-h b').textContent === 'Noviembre 2026' && document.querySelector('.day.on').dataset.dia === '2026-11-01') && /Domingo 1 de noviembre/.test(await text(q, '.cder')), await text(q, '.cder'));
    await q.setViewportSize({ width: 390, height: 844 }); await q.waitForTimeout(150);
    check('al achicar la ventana vuelve la vista de celular (tira de días, menú abajo)', await q.evaluate(() => !document.querySelector('.mcal') && !!document.querySelector('.days .day') && getComputedStyle(document.getElementById('tabbar')).flexDirection === 'row' && getComputedStyle(document.querySelector('#tabbar .sbrand')).display === 'none'));
    await q.setViewportSize({ width: 1440, height: 900 }); await q.waitForTimeout(150);
    check('y al agrandarla vuelve el calendario', !!(await q.$('.days.mcal')));
    await q.evaluate(() => { location.hash = '#/ayuda'; }); await q.waitForTimeout(200);
    check('PC: la ayuda tiene un índice de temas', await q.evaluate(() => document.querySelectorAll('.aynav [data-ayg]').length >= 3 && getComputedStyle(document.querySelector('.aynav')).display !== 'none'));
    await q.click('.aynav [data-ayg="1"]'); await q.waitForTimeout(100);
    check('PC: tocar un tema lo marca', await q.evaluate(() => document.querySelector('.aynav [data-ayg="1"]').classList.contains('on')));
    check('sin errores (PC, hermano)', q.errs.length === 0, q.errs);
    SEED['hermanos/h-pc'] = { nombre: 'Rosa', apellido: 'Acosta', congregacion: 'San Agustín (Paraná)', celular: '343 410-8890', cod: 'ROSAPC01', uid: 'anon-pc', creado: '2026-09-20T10:00:00Z', por: 'coord@x.com', ultimo: '2026-09-29T10:00:00Z' };
    const k = await open([{ uid: 'u-adm', email: 'admin@x.com', displayName: 'Admin' }], '#/coord/parana-terminal', { ancho: 1440 }); await entrar(k, 300);
    delete SEED['hermanos/h-pc'];
    await k.click('[data-tab="cobertura"]'); await k.waitForTimeout(150);
    check('PC: la cobertura muestra dos semanas', await k.evaluate(() => document.querySelector('[data-sem]').dataset.sem === '-14' && document.querySelector('.grid').style.gridTemplateColumns.includes('repeat(14')));
    await k.click('[data-tab="dia"]'); await k.waitForTimeout(150);
    check('PC: del día con los puntos en cuadrícula', await k.evaluate(() => getComputedStyle(document.querySelector('.pcs')).display === 'grid'));
    await k.click('[data-tab="config"]'); await k.waitForTimeout(150); await k.click('[data-aj="campana"]'); await k.waitForTimeout(150);
    check('PC: datos de la campaña en dos columnas (foto | datos)', await k.evaluate(() => getComputedStyle(document.querySelector('.cfcard')).display === 'grid' && !!document.querySelector('.cfl .portada') && !!document.querySelector('.cfr #cfNom')));
    await k.evaluate(() => { location.hash = '#/hermanos'; }); await k.waitForTimeout(300);
    const tabla = () => k.evaluate(() => { const h = document.querySelector('.hhd'), f = document.querySelector('.arow.hf[data-hfic="h-pc"]'); return !!h && getComputedStyle(h).display === 'grid' && !!f && [...f.querySelectorAll('.hx')].map(x => getComputedStyle(x).display !== 'none' ? x.textContent : '').join('|'); });
    check('PC: hermanos como tabla (congregación, celular y último ingreso en columnas)', await tabla() === 'San Agustín (Paraná)|343 410-8890|Ayer 07:00' || await tabla() === 'San Agustín (Paraná)|343 410-8890|Ayer 7:00', await tabla());
    await k.evaluate(() => { location.hash = '#/admin'; }); await k.waitForSelector('.adm2', { timeout: 5000 }).catch(() => {}); await k.waitForTimeout(200);
    check('PC: administración en dos columnas', await k.evaluate(() => !!document.querySelector('.adm2') && getComputedStyle(document.querySelector('.adm2')).columnCount === '2' && document.querySelectorAll('.adm2 > section').length >= 5));
    check('sin errores (PC, coordinación)', k.errs.length === 0, k.errs);
    const m = await open([pub], '#/c/parana-terminal');
    check('celular: sin calendario de PC ni índice, contenedores invisibles', await m.evaluate(() => !document.querySelector('.mcal') && getComputedStyle(document.querySelector('.ccols')).display === 'contents'));
  }
  await b.close(); console.log(`\n${ok} OK, ${bad} fallaron`);
  process.exitCode = bad ? 1 : 0;
})();
