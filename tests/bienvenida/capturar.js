// Animaciones de la bienvenida: saca capturas reales de la app (con los datos de prueba) para cada paso.
// Uso:  node tests/bienvenida/capturar.js   y después   python3 tests/bienvenida/armar.py
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(RAIZ, 'tests', 'app.test.js'), 'utf8');
const mockSrc = src.slice(src.indexOf('function mock('), src.indexOf('const SEED = {'));
const SEED = eval('(' + src.slice(src.indexOf('const SEED = {') + 13, src.indexOf('\n};', src.indexOf('const SEED = {')) + 2) + ')');
const OUT = path.join(__dirname, 'cuadros'); fs.mkdirSync(OUT, { recursive: true });
const D = [5, 6, 0];
SEED['coordinadores/crespo'] = { emails: ['coord@x.com'] };
SEED['roles/coord@x.com'] = { campanas: ['parana-terminal', 'crespo'] };
SEED['config/publico'] = { congregaciones: ['Crespo Norte (Crespo)', 'Crespo Sur (Crespo)', 'Ramírez (Gral. Ramírez)'] };
SEED['campanas/crespo'] = { nombre: 'Campaña de Predicación Pública Fiesta Nacional de la Avicultura', ciudad: 'Crespo', desde: '2026-11-06', hasta: '2026-11-08', activa: true, cupo: 2,
  puntos: { p4: { nombre: 'Carrito 4', tipo: 'carrito', cupo: 2, detalle: 'Frente a Biblioteca', lat: -32.03, lng: -60.31 },
    p1: { nombre: 'Carrito 1 Acceso Sur', tipo: 'carrito', cupo: 2, detalle: 'Parque del sol', lat: -32.04, lng: -60.3 },
    p2: { nombre: 'Carrito 2', tipo: 'carrito', cupo: 2, detalle: 'Los Constituyentes, acerca del paso a nivel', direccion: 'Los Constituyentes' },
    p3: { nombre: 'Carrito 3', tipo: 'carrito', cupo: 2, detalle: 'Av. Independencia frente a Sociedad Italiana', direccion: 'Av. Independencia' }, p5: { nombre: 'Carrito 5', tipo: 'carrito', cupo: 2, detalle: 'Plaza San Martín' } },
  turnos: {
    a1: { punto: 'p4', desde: '08:30', hasta: '10:30', dias: D },
    b1: { punto: 'p1', desde: '08:30', hasta: '10:30', dias: D }, b2: { punto: 'p1', desde: '10:30', hasta: '12:30', dias: D }, b3: { punto: 'p1', desde: '16:00', hasta: '18:00', dias: D }, b4: { punto: 'p1', desde: '18:00', hasta: '20:00', dias: D },
    c1: { punto: 'p2', desde: '08:30', hasta: '10:30', dias: D }, c2: { punto: 'p2', desde: '10:30', hasta: '12:30', dias: D }, c3: { punto: 'p2', desde: '10:30', hasta: '12:30', dias: D },
    d1: { punto: 'p3', desde: '08:30', hasta: '10:30', dias: D }, d2: { punto: 'p3', desde: '10:30', hasta: '12:30', dias: D }, d3: { punto: 'p3', desde: '10:30', hasta: '12:30', dias: D }, d4: { punto: 'p3', desde: '15:30', hasta: '17:30', dias: D }, d5: { punto: 'p3', desde: '17:30', hasta: '19:30', dias: D } } };
const T = SEED['campanas/crespo'].turnos;
const gente = [['b1','Luis','Gómez','Crespo Norte (Crespo)','c'],['b2','Jorge','Paz','Crespo Sur (Crespo)','p','Voy con mi esposa'],
  ['b3','Ana','Benítez','Crespo Sur (Crespo)','c'],['b3','Rosa','Benítez','Crespo Sur (Crespo)','c'],['b4','Carlos','Weber','Ramírez (Gral. Ramírez)','p'],
  ['a1','Elena','Kranewitter','Crespo Norte (Crespo)','c'],['c1','Pablo','Sosa','Crespo Sur (Crespo)','c'],['c1','Diego','Sosa','Crespo Sur (Crespo)','c'],
  ['c2','Silvia','Müller','Crespo Norte (Crespo)','c'],['d1','Tomás','Ibarra','Crespo Norte (Crespo)','c'],['d1','Nora','Ibarra','Crespo Norte (Crespo)','p','Es mi primera vez'],['d4','Héctor','Schell','Ramírez (Gral. Ramírez)','c']];
const oc = {};
gente.forEach(([tid, n, a, cg, e, nota], k) => { const uid = 'u' + k, f = '2026-11-06', t = T[tid];
  SEED[`pedidos/crespo__${f}__${tid}__${uid}`] = { cid: 'crespo', fecha: f, tid, punto: t.punto, desde: t.desde, hasta: t.hasta, uid, email: uid + '@x.com', nombre: n, apellido: a, congregacion: cg, celular: '343 4' + String(100000 + k * 1111).slice(0, 2) + '-' + String(1000 + k * 37), estado: e === 'c' ? 'confirmado' : 'pendiente', creado: '2026-11-01T10:00:00Z', ...(nota ? { nota } : {}) };
  (oc[tid] = oc[tid] || {})[uid] = e; });
Object.keys(oc).forEach(tid => { SEED[`cupos/crespo__2026-11-06__${tid}`] = { cid: 'crespo', fecha: '2026-11-06', tid, ocupados: oc[tid] }; });
SEED['campanas/crespo'].lugar = 'Centro';
// cada paso: lista de cuadros {f: archivo, tap: {x,y} en coordenadas CSS, ms}
const pasos = { 1: [], 2: [], 3: [], 4: [] };
(async () => {
  const b = await chromium.launch();
  const mk = async (users, hash, extra) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Argentina/Buenos_Aires' });
    await ctx.clock.install({ time: new Date('2026-11-05T12:00:00-03:00') });
    await ctx.route(/gstatic|googleapis|openstreetmap|unpkg/, r => r.abort());
    await ctx.addInitScript(`(${mockSrc})(${JSON.stringify(SEED)}, ${JSON.stringify(users)})`);
    if (extra) await ctx.addInitScript(extra);
    const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
    await p.goto('file://' + path.join(RAIZ, 'index.html') + (hash || '')); await p.waitForTimeout(700); return p;
  };
  let n = 0;
  const shot = async (p, paso, ms, sel) => { let tap = null; if (sel) { const bb = await (await p.$(sel)).boundingBox(); tap = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; } const f = `${OUT}/f${++n}.png`; await p.screenshot({ path: f }); pasos[paso].push({ f, tap, ms }); };
  const marta = { uid: 'u-nuevo', email: 'marta@x.com', displayName: 'Marta Gómez' };
  // Paso 1: campaña → toca un día → toca un horario con lugar
  let p = await mk([marta], '');
  await p.click('#userBtn'); await p.waitForTimeout(400);
  // Paso 1: inicio → lista de campañas → toca la campaña
  await p.evaluate(() => { const c = document.querySelector('.cc.camp[data-go="#/c/crespo"]'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 300); }); await p.waitForTimeout(200);
  await shot(p, 1, 1200);
  await shot(p, 1, 600, '.cc.camp[data-go="#/c/crespo"]');
  await p.click('.cc.camp[data-go="#/c/crespo"]'); await p.waitForTimeout(700); await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, 1, 1800);
  await p.evaluate(() => window.scrollTo(0, 230)); await p.waitForTimeout(150);
  await shot(p, 2, 1100);
  await shot(p, 2, 500, '[data-dia="2026-11-07"]');
  await p.click('[data-dia="2026-11-07"]'); await p.waitForTimeout(300); await p.evaluate(() => window.scrollTo(0, 230)); await p.waitForTimeout(150);
  await shot(p, 2, 1000);
  const libre = await p.evaluate(() => { const b = [...document.querySelectorAll('[data-pedir]')].find(x => !x.disabled); return b && b.dataset.pedir; });
  await shot(p, 2, 500, `[data-pedir="${libre}"]`);
  await p.click(`[data-pedir="${libre}"]`); await p.waitForTimeout(400);
  await shot(p, 2, 1600);
  // Paso 2: completa datos → Anotarme → ¡Listo!
  await p.evaluate(() => { document.getElementById('pNom').value = ''; document.getElementById('pApe').value = ''; });
  await shot(p, 3, 700);
  await p.fill('#pNom', 'Marta'); await p.fill('#pApe', 'Gómez'); await shot(p, 3, 600);
  await p.selectOption('#pCong', { index: 1 }); await shot(p, 3, 600);
  await p.fill('#pCel', '343 555-0000'); await p.waitForTimeout(50); await p.check('#pOk');
  await p.evaluate(() => document.getElementById('pGo').scrollIntoView({ block: 'center' })); await p.waitForTimeout(150);
  await shot(p, 3, 700);
  await shot(p, 3, 500, '#pGo');
  await p.click('#pGo'); await p.waitForTimeout(400);
  await shot(p, 3, 1800);
  // Paso 3: Mis turnos → Esperando confirmación → Confirmado
  await p.evaluate(() => document.querySelectorAll('.ov').forEach(x => x.remove()));
  await p.evaluate(() => { location.hash = '#/mis'; }); await p.waitForTimeout(400);
  await shot(p, 4, 1500);
  await p.evaluate(() => { const db = window.__ppamMock.db; const k = Object.keys(window.__store).find(x => x.startsWith('pedidos/') && x.endsWith('__u-nuevo')); db.doc(k).update({ estado: 'confirmado' }); });
  await p.waitForTimeout(400);
  await shot(p, 4, 1800);
  const fila = await p.$('.row'); if (fila) { await shot(p, 4, 500, '.row'); await p.click('.row'); await p.waitForTimeout(500); await shot(p, 4, 2000); }
  require('fs').writeFileSync(`${OUT}/pasos.json`, JSON.stringify(pasos));
  await b.close();
})();
