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
  const col = (p, filters) => ({
    doc: (id) => doc(p + '/' + id),
    where: (f, op, v) => col(p, [...(filters || []), [f, v]]),
    onSnapshot: (cb, err) => {
      const f = () => { const docs = Object.keys(store).filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/') && (filters || []).every(([ff, v]) => store[k][ff] === v)).map(snap); cb({ docs, forEach: (fn) => docs.forEach(fn) }); };
      listeners.add(f); f(); return () => listeners.delete(f);
    }
  });
  const db = {
    doc, collection: (p) => col(p),
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
  check('filtro por ciudad', await p.evaluate(() => [...document.querySelectorAll('#fCiudad option')].map(x => x.textContent).join() === 'Toda la provincia,Concordia,Paraná'));
  await p.selectOption('#fCiudad', 'Concordia'); await p.waitForTimeout(50);
  check('filtrando Concordia queda solo la Costanera', await p.evaluate(() => document.querySelectorAll('.camp').length === 1 && /Costanera/.test(document.querySelector('.camp').innerText)));
  await p.selectOption('#fCiudad', 'todas'); await p.waitForTimeout(50);
  await p.click('[data-go="#/c/parana-terminal"]'); await p.waitForTimeout(150);
  check('encabezado con la campaña', /Terminal de ómnibus/.test(await text(p, '#tbTitle')) && /Del 1 de octubre al 31 de octubre/.test(await text(p, '#tbSub')));
  let camp = await text(p, '#app');
  check('turnos agrupados por punto, con tipo y cupo (el stand no tiene turnos el jueves)', /Andén 1\s*Carrito · 2 por turno · Frente a boleterías\s*08:00/.test(camp) && !/Hall central/.test(camp), camp);
  check('los días marcan cuánto lugar queda (jueves 1: quedan pocos; viernes 2: hay lugar)', await p.evaluate(() => document.querySelector('[data-dia="2026-10-01"]').classList.contains('poco') && document.querySelector('[data-dia="2026-10-02"]').classList.contains('libre')));
  check('días desde el 1 de octubre (no antes), sin domingos', await p.evaluate(() => { const d = [...document.querySelectorAll('.day')].map(x => x.dataset.dia); return d[0] === '2026-10-01' && !d.includes('2026-10-04'); }));
  check('turnos del jueves 1: completo, falta 1 (uno pedido)', /08:00\s*hasta 10:00\s*sin lugar\s*Completo\s*10:00\s*hasta 12:00\s*falta 1\s*Anotarme/.test(camp), camp);
  check('sin ubicación cargada no aparece "Ver lugar"', !(await p.$('[data-lugar]')));
  await p.click('[data-dia="2026-10-03"]'); await p.waitForTimeout(80);
  camp = await text(p, '#app');
  check('el sábado aparece también el stand (3 lugares)', /Hall central\s*Stand · 3 por turno\s*16:00\s*hasta 18:00\s*faltan 3/.test(camp), camp);
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
  await p.fill('#pCel', '343 555-0000'); await p.uncheck('#pOk'); await p.click('#pGo');
  check('pide aceptar el uso de los datos', /aceptar/.test(await text(p, '#pErr')));
  await p.check('#pOk');
  await p.screenshot({ path: SHOTS + '/pedir.png' });
  await p.click('#pGo'); await p.waitForTimeout(250);
  const st = await p.evaluate(() => ({ cupo: window.__store['cupos/parana-terminal__2026-10-03__t3'], ped: window.__store['pedidos/parana-terminal__2026-10-03__t3__u-ana'] }));
  check('queda anotada en el cupo como "pedido", sin datos personales', st.cupo && st.cupo.ocupados['u-ana'] === 'p' && !JSON.stringify(st.cupo).includes('Ana'), st.cupo);
  check('el pedido guarda nombre, apellido, congregación y celular', st.ped && st.ped.nombre === 'Ana' && st.ped.apellido === 'Paz' && st.ped.congregacion === 'San Agustín (Paraná)' && st.ped.celular === '343 555-0000' && st.ped.estado === 'pendiente' && st.ped.email === 'ana@x.com', st.ped);
  check('confirmación en pantalla', /Te anotaste/.test(await text(p, '.sheet')));
  await p.click('.sheet .btn.alt[data-cerrar]'); await p.waitForTimeout(80);
  check('el turno ahora dice "Pedido" y faltan 2', /Hall central[\s\S]*16:00\s*hasta 18:00\s*faltan 2\s*Pedido/.test(await text(p, '#app')), await text(p, '#app'));
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
  check('lista del día: Ana en el stand del sábado', /16 a 18 · Hall central\s*Ana Paz \(San Agustín \(Paraná\)\) · 1\/3/.test(await text(c, '#app')), await text(c, '#app'));
  await c.click('[data-listadia]');
  const lista = await c.evaluate(() => decodeURIComponent(window.__opened.pop().split('text=')[1]));
  check('compartir la lista del día por WhatsApp', /\*16 a 18 · Hall central\*\n  – Ana Paz/.test(lista), lista);
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
  check('la lista de puntos muestra que tiene ubicación y foto', /Andén 1[\s\S]*Con ubicación · 1 foto/.test(await text(c, '#app')));
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
  // Foto de portada
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
  check('sin errores (el lugar)', v.errs.length === 0, v.errs);

  // Quitar la foto del punto
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

  await b.close(); console.log(`\n${ok} OK, ${bad} fallaron`);
  process.exitCode = bad ? 1 : 0;
})();
