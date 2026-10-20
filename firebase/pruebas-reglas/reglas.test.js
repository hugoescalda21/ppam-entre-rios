/* =====================================================================
   Pruebas de las reglas de Firestore — PPAM Entre Ríos
   Corren contra el emulador (proyecto "demo-ppam": no toca la base real).
   Una vez: npm install      ·      Cada vez: npm test      (hace falta Java 21)
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
try { require('firebase/compat/app').default.firestore.setLogLevel('silent'); } catch (e) { /* nada */ }

const TEC = 'hugoescalda@gmail.com', ADM = 'admin@x.com', CO = 'coord@x.com', CO2 = 'coord2@x.com', A = 'ana@x.com', B = 'beto@x.com', C = 'caro@x.com', G = 'gente@x.com';
// Los publicadores son hermanos habilitados: entran con su link (sesión anónima), no con Google.
const HER = { [A]: { hid: 'h-ana', anon: 'anon-ana', cod: 'ANA00001' }, [B]: { hid: 'h-beto', anon: 'anon-beto', cod: 'BETO0001' }, [C]: { hid: 'h-caro', anon: 'anon-caro', cod: 'CARO0001' } };
const CID = 'parana-terminal', F = '2026-10-05';
const cupo = (tid) => `cupos/${CID}__${F}__${tid}`;
const ped = (tid, uid) => `pedidos/${CID}__${F}__${tid}__${uid}`;
const uidOf = (e) => HER[e] ? HER[e].hid : 'uid-' + e.split('@')[0];

let ok = 0, bad = 0;
async function check(label, p) {
  try { await p; ok++; console.log('  ✅', label); }
  catch (e) { bad++; console.log('  ❌', label, '—', (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 200)); }
}
const section = (t) => console.log('\n' + t);

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-ppam', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
  const anonDb = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const db = (email) => !email ? env.unauthenticatedContext().firestore() : HER[email] ? anonDb(HER[email].anon) : env.authenticatedContext(uidOf(email), { email, firebase: { sign_in_provider: 'google.com' } }).firestore();
  const TUR = { t1: { punto: 'p1', desde: '08:00', hasta: '10:00' }, t2: { punto: 'p2', desde: '10:00', hasta: '12:00' } };
  const datos = (email, tid, extra) => Object.assign({ cid: CID, fecha: F, tid, punto: TUR[tid].punto, desde: TUR[tid].desde, hasta: TUR[tid].hasta, uid: uidOf(email), ...(HER[email] ? {} : { email }), nombre: 'Ana', apellido: 'Paz', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', estado: 'pendiente', creado: '2026-10-01T10:00:00Z' }, extra || {});
  async function pedir(email, tid, extra) {
    const f = db(email), b = f.batch();
    b.set(f.doc(cupo(tid)), { cid: CID, fecha: F, tid, ocupados: { [uidOf(email)]: 'p' } }, { merge: true });
    b.set(f.doc(ped(tid, uidOf(email))), datos(email, tid, extra));
    return b.commit();
  }

  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await f.doc('config/admins').set({ emails: [ADM] });
    await f.doc('config/publico').set({ congregaciones: ['San Agustín (Paraná)'] });
    await f.doc('coordinadores/' + CID).set({ emails: [CO] });
    await f.doc('roles/' + CO).set({ campanas: [CID] });
    await f.doc('campanas/' + CID).set({ nombre: 'Terminal', ciudad: 'Paraná', desde: '2026-10-01', hasta: '2026-10-31', activa: true,
      puntos: { p1: { nombre: 'Andén 1', tipo: 'carrito', cupo: 2 }, p2: { nombre: 'Hall', tipo: 'stand', cupo: 3 } },
      turnos: { t1: { punto: 'p1', desde: '08:00', hasta: '10:00', dias: [1] }, t2: { punto: 'p2', desde: '10:00', hasta: '12:00', dias: [1] } } });
    await f.doc('campanas/otra').set({ nombre: 'Otra', activa: true, puntos: {}, turnos: {} });
    for (const e of [A, B, C]) {
      const h = HER[e];
      await f.doc('hermanos/' + h.hid).set({ nombre: e.split('@')[0], apellido: 'Prueba', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', cod: h.cod, uid: h.anon, creado: 'x', por: CO });
      await f.doc('links/' + h.cod).set({ hid: h.hid, nombre: e.split('@')[0], por: CO });
      await f.doc('sesiones/' + h.anon).set({ hid: h.hid, cod: h.cod, at: new Date() });
    }
  });

  section('0) Solo cuentas de Google');
  const otroIngreso = env.authenticatedContext(uidOf(ADM), { email: ADM, firebase: { sign_in_provider: 'password' } }).firestore();
  await check('con email y contraseña NO hereda permisos de administrador', assertFails(otroIngreso.doc('config/admins').get()));
  await check('con email y contraseña NO pide turnos', assertFails(otroIngreso.doc('campanas/x').set({ nombre: 'X' })));

  section('1) La web cerrada');
  await check('sin sesión NO se ven las campañas', assertFails(db(null).doc('campanas/' + CID).get()));
  await check('sin sesión NO se ven los cupos', assertFails(db(null).collection('cupos').where('cid', '==', CID).get()));
  await check('sin sesión NO se ve la lista de congregaciones', assertFails(db(null).doc('config/publico').get()));
  await check('con Google pero sin ser coordinador NO se ven las campañas', assertFails(db(G).doc('campanas/' + CID).get()));
  await check('una sesión anónima sin link NO ve nada', assertFails(anonDb('anon-x').doc('campanas/' + CID).get()));
  await check('un hermano habilitado ve las campañas', assertSucceeds(db(A).doc('campanas/' + CID).get()));
  await check('un hermano habilitado ve los cupos', assertSucceeds(db(A).collection('cupos').where('cid', '==', CID).get()));
  await check('un hermano habilitado ve la lista de congregaciones', assertSucceeds(db(A).doc('config/publico').get()));
  await check('el coordinador ve las campañas', assertSucceeds(db(CO).doc('campanas/' + CID).get()));
  await check('NO se ven los administradores', assertFails(db(A).doc('config/admins').get()));
  await check('NO se ven los coordinadores de una campaña', assertFails(db(A).doc('coordinadores/' + CID).get()));
  await check('el coordinador ve su rol', assertSucceeds(db(CO).doc('roles/' + CO).get()));
  await check('otro NO ve roles ajenos', assertFails(db(A).doc('roles/' + CO).get()));

  section('2) Campañas');
  await check('un publicador NO crea campañas', assertFails(db(A).doc('campanas/nueva').set({ nombre: 'X' })));
  await check('un coordinador NO crea campañas', assertFails(db(CO).doc('campanas/nueva').set({ nombre: 'X' })));
  await check('un administrador crea campañas', assertSucceeds(db(ADM).doc('campanas/nueva').set({ nombre: 'X', activa: true })));
  await check('el administrador técnico también', assertSucceeds(db(TEC).doc('campanas/nueva2').set({ nombre: 'Y' })));
  await check('el coordinador edita SU campaña', assertSucceeds(db(CO).doc('campanas/' + CID).update({ lugar: 'Terminal de ómnibus' })));
  await check('el coordinador NO edita otra campaña', assertFails(db(CO).doc('campanas/otra').update({ lugar: 'x' })));
  await check('el coordinador NO borra la campaña', assertFails(db(CO).doc('campanas/' + CID).delete()));
  await check('un coordinador NO se nombra en otra campaña', assertFails(db(CO).doc('coordinadores/otra').set({ emails: [CO] })));
  await check('el administrador nombra coordinadores', assertSucceeds(db(ADM).doc('coordinadores/otra').set({ emails: [CO2] })));

  section('3) Pedir un turno');
  await check('sin sesión NO se pide', assertFails(db(null).doc(cupo('t1')).set({ cid: CID, fecha: F, tid: 't1', ocupados: { x: 'p' } })));
  await check('Ana pide el turno de 8 (cupo 2)', assertSucceeds(pedir(A, 't1')));
  await check('Ana ve su pedido', assertSucceeds(db(A).doc(ped('t1', uidOf(A))).get()));
  await check('Ana consulta "mis turnos"', assertSucceeds(db(A).collection('pedidos').where('uid', '==', uidOf(A)).get()));
  await check('Beto NO ve el pedido de Ana (datos personales)', assertFails(db(B).doc(ped('t1', uidOf(A))).get()));
  await check('Beto NO lista pedidos de la campaña', assertFails(db(B).collection('pedidos').where('cid', '==', CID).get()));
  await check('Beto NO toca el lugar de Ana', assertFails(db(B).doc(cupo('t1')).update({ ['ocupados.' + uidOf(A)]: 'c' })));
  await check('Beto NO saca a Ana del turno', assertFails(db(B).doc(cupo('t1')).update({ ['ocupados.' + uidOf(A)]: require('firebase/compat/app').default.firestore.FieldValue.delete() })));
  await check('Beto NO se pone como confirmado', assertFails(db(B).doc(cupo('t1')).update({ ['ocupados.' + uidOf(B)]: 'c' })));
  await check('un pedido sin anotarse en el cupo NO vale', assertFails(db(B).doc(ped('t2', uidOf(B))).set(datos(B, 't2'))));
  await check('NO se pide con el email de otro', assertFails(pedir(CO, 't2', { email: A })));
  await check('NO se pide ya confirmado', assertFails(pedir(B, 't2', { estado: 'confirmado' })));
  await check('NO se aceptan campos de más', assertFails(pedir(B, 't2', { dni: '123' })));
  await check('NO sin celular', assertFails(pedir(B, 't2', { celular: '' })));
  const DEL = () => require('firebase/compat/app').default.firestore.FieldValue.delete();
  await check('NO se ocupa un lugar sin dejar el pedido (bloquear la campaña)', assertFails(db(B).doc(cupo('t2')).set({ cid: CID, fecha: F, tid: 't2', ocupados: { [uidOf(B)]: 'p' } }, { merge: true })));
  await check('NO un pedido con otro horario que el del turno', assertFails(pedir(B, 't2', { desde: '06:00' })));
  await check('NO un pedido con otro punto que el del turno', assertFails(pedir(B, 't2', { punto: 'p1' })));
  await check('NO un "creado" gigante', assertFails(pedir(B, 't2', { creado: 'x'.repeat(5000) })));
  await check('NO un pedido fuera de las fechas de la campaña', assertFails((async () => { const f = db(B), b = f.batch(), F2 = '2027-01-04', id = `${CID}__${F2}__t1`; b.set(f.doc('cupos/' + id), { cid: CID, fecha: F2, tid: 't1', ocupados: { [uidOf(B)]: 'p' } }, { merge: true }); b.set(f.doc('pedidos/' + id + '__' + uidOf(B)), datos(B, 't1', { fecha: F2 })); await b.commit(); })()));
  await check('Ana NO deja su pedido y se saca del cupo', assertFails(db(A).doc(cupo('t1')).update({ ['ocupados.' + uidOf(A)]: DEL() })));
  await check('Ana NO borra su pedido sin liberar el lugar', assertFails(db(A).doc(ped('t1', uidOf(A))).delete()));
  await check('Beto pide el último lugar del turno de 8', assertSucceeds(pedir(B, 't1')));
  await check('un tercero NO entra: el turno está completo', assertFails(pedir(C, 't1')));
  await check('con Google sin ser coordinador NO se pide', assertFails(pedir(G, 't2')));
  await check('un hermano NO pide con el id de otro hermano', assertFails((async () => { const f = db(B), b = f.batch(); b.set(f.doc(cupo('t2')), { cid: CID, fecha: F, tid: 't2', ocupados: { [uidOf(C)]: 'p' } }, { merge: true }); b.set(f.doc(ped('t2', uidOf(C))), datos(C, 't2')); await b.commit(); })()));
  await check('un hermano NO pide con email (no tiene cuenta de Google)', assertFails(pedir(B, 't2', { email: B })));

  section('4) Coordinador');
  await check('ve los pedidos de su campaña', assertSucceeds(db(CO).collection('pedidos').where('cid', '==', CID).get()));
  await check('confirma el pedido de Ana', assertSucceeds((async () => { const f = db(CO), b = f.batch(); b.set(f.doc(cupo('t1')), { cid: CID, fecha: F, tid: 't1', ocupados: { [uidOf(A)]: 'c' } }, { merge: true }); b.update(f.doc(ped('t1', uidOf(A))), { estado: 'confirmado', actualizado: 'x', por: CO }); await b.commit(); })()));
  await check('NO cambia los datos personales del pedido', assertFails(db(CO).doc(ped('t1', uidOf(A))).update({ celular: '000' })));
  await check('otro coordinador NO ve pedidos de esta campaña', assertFails(db(CO2).collection('pedidos').where('cid', '==', CID).get()));
  await check('Ana NO se confirma sola', assertFails(db(A).doc(ped('t1', uidOf(A))).update({ estado: 'confirmado' })));

  section('5) Cancelar y volver a pedir');
  await check('Beto cancela su turno', assertSucceeds((async () => { const f = db(B), b = f.batch(); b.update(f.doc(cupo('t1')), { ['ocupados.' + uidOf(B)]: require('firebase/compat/app').default.firestore.FieldValue.delete() }); b.delete(f.doc(ped('t1', uidOf(B)))); await b.commit(); })()));
  await check('ahora entra otro en ese lugar', assertSucceeds(pedir(C, 't1')));
  await check('el coordinador no confirma a ese otro', assertSucceeds((async () => { const f = db(CO), b = f.batch(); b.update(f.doc(cupo('t1')), { ['ocupados.' + uidOf(C)]: require('firebase/compat/app').default.firestore.FieldValue.delete() }); b.update(f.doc(ped('t1', uidOf(C))), { estado: 'rechazado', actualizado: 'x', por: CO }); await b.commit(); })()));
  await check('y puede volver a pedir otro día u horario (o el mismo)', assertSucceeds(pedir(C, 't1')));
  await check('un coordinador también se anota con su cuenta de Google', assertSucceeds(pedir(CO, 't2')));

  section('6) Fotos');
  const JPG = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
  const foto = (email, id, extra) => db(email).doc('fotos/' + id).set(Object.assign({ cid: CID, data: JPG, creado: 'x' }, extra || {}));
  await check('el coordinador sube una foto de su campaña', assertSucceeds(foto(CO, CID + '__f1')));
  await check('un hermano la ve', assertSucceeds(db(A).doc('fotos/' + CID + '__f1').get()));
  await check('sin sesión NO se ve', assertFails(db(null).doc('fotos/' + CID + '__f1').get()));
  await check('un publicador NO sube fotos', assertFails(foto(A, CID + '__f2')));
  await check('el coordinador NO sube fotos de otra campaña', assertFails(foto(CO, 'otra__f1', { cid: 'otra' })));
  await check('NO con un id que no es de la campaña', assertFails(foto(CO, 'otra__f3')));
  await check('solo imágenes JPEG', assertFails(foto(CO, CID + '__f4', { data: 'data:text/html;base64,PHNjcmlwdD4=' })));
  await check('NO más grande de lo permitido', assertFails(foto(CO, CID + '__f5', { data: 'data:image/jpeg;base64,' + 'A'.repeat(460000) })));
  await check('NO con campos de más', assertFails(foto(CO, CID + '__f6', { autor: 'x' })));
  await check('el administrador sube fotos en cualquier campaña', assertSucceeds(foto(ADM, 'otra__f1', { cid: 'otra' })));
  await check('un publicador NO borra fotos', assertFails(db(A).doc('fotos/' + CID + '__f1').delete()));
  await check('el coordinador borra fotos de su campaña', assertSucceeds(db(CO).doc('fotos/' + CID + '__f1').delete()));
  await check('el coordinador guarda la ubicación de un punto', assertSucceeds(db(CO).doc('campanas/' + CID).update({ 'puntos.p1.lat': -31.74, 'puntos.p1.lng': -60.52, 'puntos.p1.direccion': 'Av. Ramírez 2598', portada: 'portada-x' })));

  section('Nota para el coordinador');
  await check('Beto pide con una nota', assertSucceeds(pedir(B, 't2', { nota: 'Voy con mi esposa.' })));
  await check('Beto cambia su nota', assertSucceeds(db(B).doc(ped('t2', uidOf(B))).update({ nota: 'Es mi primera vez.' })));
  await check('Beto borra su nota', assertSucceeds(db(B).doc(ped('t2', uidOf(B))).update({ nota: require('firebase/compat/app').default.firestore.FieldValue.delete() })));
  await check('NO una nota de más de 200 letras', assertFails(db(B).doc(ped('t2', uidOf(B))).update({ nota: 'x'.repeat(201) })));
  await check('NO una nota vacía', assertFails(db(B).doc(ped('t2', uidOf(B))).update({ nota: '' })));
  await check('un cambio que no cambia nada NO pasa por la nota', assertFails(db(B).doc(ped('t2', uidOf(B))).update({ estado: 'pendiente' })));
  await check('con la nota NO cambia otros datos', assertFails(db(B).doc(ped('t2', uidOf(B))).update({ nota: 'ok', estado: 'confirmado' })));
  await check('otro NO cambia la nota de Beto', assertFails(db(A).doc(ped('t2', uidOf(B))).update({ nota: 'hola' })));
  await check('el coordinador NO cambia la nota', assertFails(db(CO).doc(ped('t2', uidOf(B))).update({ nota: 'hola' })));
  await check('NO se pide con una nota de más de 200 letras', assertFails(pedir(B, 't1', { nota: 'x'.repeat(201) })));

  section('El coordinador anota a un hermano sin la app');
  const MU = 'm-abc123xyz';
  const manual = (email, uid, extra) => Object.fromEntries(Object.entries(Object.assign({ cid: CID, fecha: F, tid: 't2', punto: 'p2', desde: '10:00', hasta: '12:00', uid, nombre: 'Rosa', apellido: 'Díaz', congregacion: 'San Agustín (Paraná)', celular: '343 444-1234', estado: 'confirmado', creado: '2026-10-01T10:00:00Z', manual: true, por: email }, extra || {})).filter(([, v]) => v !== undefined));
  async function anotar(email, uid, extra, marca) {
    const f = db(email), b = f.batch();
    b.set(f.doc(cupo('t2')), { cid: CID, fecha: F, tid: 't2', ocupados: { [uid]: marca || 'c' } }, { merge: true });
    b.set(f.doc(ped('t2', uid)), manual(email, uid, extra));
    return b.commit();
  }
  await check('un publicador NO anota a otro', assertFails(anotar(A, 'm-ana00001')));
  await check('el coordinador de otra campaña NO anota acá', assertFails(anotar(CO2, 'm-otro0001')));
  await check('NO sin "manual" ni con un uid cualquiera', assertFails(anotar(CO, 'uid-rosa')));
  await check('NO a nombre de otro coordinador ("por")', assertFails(anotar(CO, 'm-por00001', { por: 'otro@x.com' })));
  await check('NO como "pendiente"', assertFails(anotar(CO, 'm-pend0001', { estado: 'pendiente' })));
  await check('NO si el cupo no lo marca confirmado', assertFails(anotar(CO, 'm-cupo0001', {}, 'p')));
  await check('NO con campos de más', assertFails(anotar(CO, 'm-extra001', { email: 'rosa@x.com' })));
  await check('el coordinador anota a Rosa (confirmada)', assertSucceeds(anotar(CO, MU)));
  await check('también sin celular y con nota', assertSucceeds(anotar(CO, 'm-sincel01', { celular: undefined, nota: 'Avisarle por teléfono fijo.' })));
  await check('el coordinador la ve y la puede quitar', assertSucceeds(db(CO).doc(ped('t2', MU)).update({ estado: 'rechazado', actualizado: '2026-10-02T10:00:00Z', por: CO })));
  await check('un publicador NO ve ese pedido', assertFails(db(A).doc(ped('t2', MU)).get()));

  section('Historial (auditoría)');
  const TS = () => require('firebase/compat/app').default.firestore.FieldValue.serverTimestamp();
  const linea = (email, extra) => Object.assign({ cid: CID, tipo: 'borro_turno', texto: 'borró el turno 8–10 del Andén 1', por: HER[email] ? 'link' : email, uid: uidOf(email), at: TS() }, extra || {});
  await check('el coordinador anota una línea en su campaña', assertSucceeds(db(CO).doc('auditoria/a1').set(linea(CO, { antes: { punto: 'p1', desde: '08:00', hasta: '10:00', dias: [1] }, ref: 'turno:t9' }))));
  await check('NO con una hora inventada', assertFails(db(CO).doc('auditoria/a2').set(linea(CO, { at: '2020-01-01T00:00:00Z' }))));
  await check('NO firmada con el email de otro', assertFails(db(CO).doc('auditoria/a3').set(linea(CO, { por: 'otro@x.com' }))));
  await check('NO en una campaña que no coordina', assertFails(db(CO2).doc('auditoria/a4').set(linea(CO2))));
  await check('NO con campos de más', assertFails(db(CO).doc('auditoria/a5').set(linea(CO, { ip: '1.2.3.4' }))));
  const cancela = (email, tid, extra) => { const f = db(email), b = f.batch(); b.update(f.doc(cupo(tid)), { ['ocupados.' + uidOf(email)]: DEL() }); b.delete(f.doc(ped(tid, uidOf(email)))); b.set(f.doc('auditoria/c-' + email + tid), linea(email, Object.assign({ tipo: 'cancelo', texto: 'canceló su turno', ref: ped(tid, uidOf(email)).slice(8) }, extra || {}))); return b.commit(); };
  await check('NO anota "canceló" sin cancelar de verdad', assertFails(db(A).doc('auditoria/a6').set(linea(A, { tipo: 'cancelo', texto: 'canceló su turno', ref: ped('t1', uidOf(A)).slice(8) }))));
  await check('NO anota "canceló" con datos de más', assertFails(cancela(A, 't1', { antes: { x: 1 } })));
  await check('NO anota "canceló" del pedido de otro', assertFails(cancela(A, 't1', { ref: ped('t2', uidOf(B)).slice(8) })));
  await check('un publicador cancela y queda anotado en el historial', assertSucceeds(cancela(A, 't1')));
  await check('lo anotado se ve', assertSucceeds(db(CO).doc('auditoria/c-' + A + 't1').get()));
  await check('un publicador NO anota otra cosa', assertFails(db(A).doc('auditoria/a7').set(linea(A))));
  await check('el administrador anota cambios generales', assertSucceeds(db(ADM).doc('auditoria/a8').set(linea(ADM, { cid: '', tipo: 'config', texto: 'cambió los administradores' }))));
  await check('un coordinador NO anota cambios generales', assertFails(db(CO).doc('auditoria/a9').set(linea(CO, { cid: '', tipo: 'config', texto: 'x' }))));
  await check('el coordinador ve el historial de su campaña', assertSucceeds(db(CO).collection('auditoria').where('cid', '==', CID).get()));
  await check('otro coordinador NO lo ve', assertFails(db(CO2).collection('auditoria').where('cid', '==', CID).get()));
  await check('un publicador NO ve el historial', assertFails(db(A).doc('auditoria/c-' + A + 't1').get()));
  await check('el administrador ve todo el historial', assertSucceeds(db(ADM).collection('auditoria').get()));
  await check('nadie edita una línea', assertFails(db(ADM).doc('auditoria/a1').update({ texto: 'otra cosa' })));
  await check('el coordinador NO borra líneas', assertFails(db(CO).doc('auditoria/a1').delete()));
  await check('el administrador NO borra líneas recientes', assertFails(db(ADM).doc('auditoria/a1').delete()));

  section('Reportes y errores (soporte)');
  const SOP = 'sop@x.com';
  await env.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('config/soporte').set({ emails: [SOP] }); });
  const rep = (extra) => Object.assign({ tipo: 'Otro', texto: 'No carga', pantalla: '#/', disp: 'Android 11 · Chrome 128', ver: '11', estado: 'nuevo', creado: '2026-10-13T12:00:00Z' }, extra || {});
  await check('sin sesión se manda un reporte', assertSucceeds(db(null).doc('reportes/r1').set(rep({ celular: '343 555-0000' }))));
  await check('sin sesión NO se manda con email ajeno', assertFails(db(null).doc('reportes/r2').set(rep({ email: 'otro@x.com' }))));
  await check('un hermano, con su id y nombre', assertSucceeds(db(A).doc('reportes/r3').set(rep({ uid: uidOf(A), nombre: 'Ana Paz' }))));
  await check('un coordinador, con su uid y email', assertSucceeds(db(CO).doc('reportes/r3b').set(rep({ uid: uidOf(CO), email: CO, nombre: 'Carlos' }))));
  await check('NO con el uid de otro', assertFails(db(A).doc('reportes/r4').set(rep({ uid: uidOf(B) }))));
  await check('NO ya resuelto', assertFails(db(A).doc('reportes/r5').set(rep({ estado: 'resuelto' }))));
  await check('NO con campos de más', assertFails(db(A).doc('reportes/r6').set(rep({ admin: true }))));
  await check('NO un texto de más de 1000 letras', assertFails(db(A).doc('reportes/r7').set(rep({ texto: 'x'.repeat(1001) }))));
  await check('un publicador NO lee reportes', assertFails(db(A).doc('reportes/r3').get()));
  await check('un coordinador NO lee reportes', assertFails(db(CO).doc('reportes/r3').get()));
  await check('soporte lee los reportes', assertSucceeds(db(SOP).collection('reportes').get()));
  await check('soporte lo marca resuelto', assertSucceeds(db(SOP).doc('reportes/r3').update({ estado: 'resuelto', actualizado: '2026-10-13T13:00:00Z', por: SOP })));
  await check('soporte NO cambia el texto', assertFails(db(SOP).doc('reportes/r3').update({ texto: 'otro' })));
  await check('el administrador también lee', assertSucceeds(db(ADM).doc('reportes/r1').get()));
  await check('soporte NO ve los pedidos', assertFails(db(SOP).collection('pedidos').where('cid', '==', CID).get()));
  await check('soporte NO cambia campañas', assertFails(db(SOP).doc('campanas/' + CID).update({ lugar: 'x' })));
  await check('soporte NO cambia el equipo de soporte', assertFails(db(SOP).doc('config/soporte').set({ emails: [SOP, B] })));
  await check('el administrador elige el equipo de soporte', assertSucceeds(db(ADM).doc('config/soporte').set({ emails: [SOP] })));
  await check('cualquiera anota un error', assertSucceeds(db(null).doc('errores/e1').set({ tipo: 'js', msg: 'x is not defined', pantalla: '#/', disp: 'iPhone', ver: '11', creado: '2026-10-13T12:00:00Z' })));
  await check('NO un error con datos de más', assertFails(db(null).doc('errores/e2').set({ tipo: 'js', msg: 'x', email: 'a@x.com' })));
  await check('un publicador NO lee errores', assertFails(db(A).doc('errores/e1').get()));
  await check('soporte lee y borra errores', assertSucceeds(db(SOP).doc('errores/e1').delete()));
  await check('soporte borra reportes viejos', assertSucceeds(db(SOP).doc('reportes/r1').delete()));

  section('Hermanos habilitados: el link personal');
  const TSv = () => require('firebase/compat/app').default.firestore.FieldValue.serverTimestamp();
  const hermano = (extra) => Object.assign({ nombre: 'Marta', apellido: 'Gómez', congregacion: 'San Agustín (Paraná)', celular: '343 412-3412', cod: 'MARTA001', creado: '2026-10-14T10:00:00Z', por: CO, porNombre: 'Carlos' }, extra || {});
  const habilitar = (email, hid, extra, cod) => { const f = db(email), b = f.batch(), h = hermano(Object.assign({ por: email }, extra || {})); b.set(f.doc('hermanos/' + hid), h); b.set(f.doc('links/' + (cod || h.cod)), { hid, nombre: h.nombre, congregacion: h.congregacion, creado: 'x', por: email }); return b.commit(); };
  await check('un hermano NO habilita a otro', assertFails(habilitar(A, 'h-x1', { por: 'link' })));
  await check('con Google sin ser coordinador NO se habilita', assertFails(habilitar(G, 'h-x2')));
  await check('NO firmado por otro', assertFails(habilitar(CO, 'h-x3', { por: 'otro@x.com' })));
  await check('NO ya atado a un celular', assertFails(habilitar(CO, 'h-x4', { uid: 'anon-x' })));
  await check('NO con un código raro', assertFails(habilitar(CO, 'h-x5', { cod: 'abc' }, 'abc')));
  await check('NO un link que no es el código del hermano', assertFails(habilitar(CO, 'h-x6', {}, 'OTRO0001')));
  await check('NO sin celular', assertFails(habilitar(CO, 'h-x7', { celular: '' })));
  await check('el coordinador habilita a Marta (hermano + link)', assertSucceeds(habilitar(CO, 'h-marta')));
  await check('el coordinador ve la lista de hermanos', assertSucceeds(db(CO).collection('hermanos').get()));
  await check('el administrador también', assertSucceeds(db(ADM).collection('hermanos').get()));
  await check('un hermano NO ve la lista de hermanos', assertFails(db(A).collection('hermanos').get()));
  await check('un hermano NO ve a otro hermano', assertFails(db(A).doc('hermanos/h-marta').get()));
  const M1 = anonDb('anon-m1'), M2 = anonDb('anon-m2');
  await check('sin sesión NO se lee el link', assertFails(db(null).doc('links/MARTA001').get()));
  await check('con la sesión anónima se lee el link (para saludar)', assertSucceeds(M1.doc('links/MARTA001').get()));
  await check('NO se listan los links', assertFails(M1.collection('links').get()));
  await check('antes de entrar NO ve las campañas', assertFails(M1.doc('campanas/' + CID).get()));
  const entrar = (f, uid, hid, cod, extra) => { const b = f.batch(); b.set(f.doc('sesiones/' + uid), { hid, cod, at: TSv() }); b.update(f.doc('hermanos/' + hid), Object.assign({ uid, ultimo: TSv(), disp: 'Android · Chrome' }, extra || {})); b.update(f.doc('links/' + cod), { usado: true }); return b.commit(); };
  await check('NO entra con el código de otro hermano', assertFails(entrar(M1, 'anon-m1', 'h-marta', 'ANA00001')));
  await check('NO entra con un código que no existe', assertFails(entrar(M1, 'anon-m1', 'h-marta', 'NOEXISTE')));
  await check('NO se ata el celular de otro', assertFails(entrar(M1, 'anon-m2', 'h-marta', 'MARTA001')));
  await check('NO cambia su nombre al entrar', assertFails(entrar(M1, 'anon-m1', 'h-marta', 'MARTA001', { nombre: 'Otra' })));
  await check('Marta toca "Confirmar ingreso"', assertSucceeds(entrar(M1, 'anon-m1', 'h-marta', 'MARTA001')));
  await check('ahora ve las campañas', assertSucceeds(M1.doc('campanas/' + CID).get()));
  await check('y ve sus propios datos', assertSucceeds(M1.doc('hermanos/h-marta').get()));
  await check('NO cambia su propio nombre o su código', assertFails(M1.doc('hermanos/h-marta').update({ nombre: 'Marta Elena' })));
  await check('NO lee la sesión de otro celular', assertFails(M1.doc('sesiones/anon-ana').get()));
  await check('entra desde otro celular con el mismo link (avisa)', assertSucceeds(entrar(M2, 'anon-m2', 'h-marta', 'MARTA001', { aviso: true, antes: { disp: 'Android · Chrome' } })));
  await check('el celular anterior queda afuera', assertFails(M1.doc('campanas/' + CID).get()));
  await check('…pero puede ver que su acceso se abrió en otro lado', assertSucceeds(M1.doc('hermanos/h-marta').get()));
  await check('el nuevo celular sí ve las campañas', assertSucceeds(M2.doc('campanas/' + CID).get()));
  await check('el coordinador ve el aviso y lo da por visto', assertSucceeds(db(CO).doc('hermanos/h-marta').update({ aviso: false })));
  const nuevoLink = () => { const f = db(CO), b = f.batch(); b.update(f.doc('hermanos/h-marta'), { cod: 'MARTA002', uid: null }); b.set(f.doc('links/MARTA002'), { hid: 'h-marta', nombre: 'Marta', por: CO }); b.delete(f.doc('links/MARTA001')); return b.commit(); };
  await check('el coordinador NO ata el hermano a un celular', assertFails(db(CO).doc('hermanos/h-marta').update({ uid: 'anon-cualquiera' })));
  await check('el coordinador le manda un link nuevo', assertSucceeds(nuevoLink()));
  await check('con el link nuevo, el celular que estaba queda afuera', assertFails(M2.doc('campanas/' + CID).get()));
  await check('el link viejo ya no sirve', assertFails(entrar(M2, 'anon-m2', 'h-marta', 'MARTA001')));
  await check('con el link nuevo vuelve a entrar', assertSucceeds(entrar(M2, 'anon-m2', 'h-marta', 'MARTA002')));
  await check('y pide un turno con su id de hermano', assertSucceeds((async () => { const b = M2.batch(); b.set(M2.doc(cupo('t1')), { cid: CID, fecha: F, tid: 't1', ocupados: { 'h-marta': 'p' } }, { merge: true }); b.set(M2.doc(ped('t1', 'h-marta')), Object.assign(datos(A, 't1'), { uid: 'h-marta' })); await b.commit(); })()));
  await check('ve "mis turnos"', assertSucceeds(M2.collection('pedidos').where('uid', '==', 'h-marta').get()));
  await check('dar de baja', assertSucceeds(db(CO).doc('hermanos/h-marta').update({ baja: true, bajaPor: CO, bajaAt: 'x' })));
  await check('dado de baja NO ve nada', assertFails(M2.doc('campanas/' + CID).get()));
  await check('dado de baja NO vuelve a entrar', assertFails(entrar(M2, 'anon-m2', 'h-marta', 'MARTA002')));
  await check('dado de baja NO ve sus turnos', assertFails(M2.collection('pedidos').where('uid', '==', 'h-marta').get()));
  await check('el coordinador NO borra hermanos', assertFails(db(CO).doc('hermanos/h-marta').delete()));
  await check('quien usaba Google se habilita con su mismo id (sus turnos quedan)', assertSucceeds(habilitar(CO, uidOf(G), { cod: 'GENTE001' })));

  section('Quitados de la lista "Usaban Google"');
  const desc = (email, extra) => db(email).doc('descartados/uid-prueba').set(Object.assign({ nombre: 'Hugo Prueba', por: email, at: TSv() }, extra || {}));
  await check('un hermano NO quita a nadie de la lista', assertFails(desc(A, { por: 'link' })));
  await check('con Google sin ser coordinador NO', assertFails(desc(G)));
  await check('NO firmado por otro', assertFails(desc(CO, { por: 'otro@x.com' })));
  await check('NO con campos de más', assertFails(desc(CO, { celular: '1' })));
  await check('el coordinador lo quita de la lista', assertSucceeds(desc(CO)));
  await check('los coordinadores ven quiénes se quitaron', assertSucceeds(db(CO).collection('descartados').get()));
  await check('un hermano NO los ve', assertFails(db(A).collection('descartados').get()));
  await check('el coordinador lo vuelve a mostrar', assertSucceeds(db(CO).doc('descartados/uid-prueba').delete()));

  section('Compañeros de turno (nombre opcional)');
  const F2 = '2026-10-12', T1 = `${CID}__${F2}__t1`, T2 = `${CID}__${F2}__t2`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await f.doc('cupos/' + T1).set({ cid: CID, fecha: F2, tid: 't1', ocupados: { 'h-ana': 'c', 'h-beto': 'c', 'h-caro': 'p' } });
    await f.doc('cupos/' + T2).set({ cid: CID, fecha: F2, tid: 't2', ocupados: { 'h-ana': 'c' } });
  });
  const comp = (email, id, n, extra) => db(email).doc('companeros/' + id).set(Object.assign({ cid: CID, fecha: F2, n }, extra || {}), { merge: true });
  await check('un confirmado pone su nombre', assertSucceeds(comp(A, T1, { 'h-ana': 'Ana Prueba · San Agustín (Paraná)' })));
  await check('NO pone el nombre de otro', assertFails(comp(A, T1, { 'h-beto': 'Beto' })));
  await check('NO con campos de más (p. ej. el celular)', assertFails(comp(A, T1, { 'h-ana': 'Ana' }, { celular: '343' })));
  await check('NO un nombre larguísimo', assertFails(comp(A, T1, { 'h-ana': 'x'.repeat(141) })));
  await check('NO si cid/fecha no coinciden con el turno', assertFails(db(A).doc('companeros/' + T1).set({ cid: 'otra', fecha: F2, n: { 'h-ana': 'Ana' } }, { merge: true })));
  await check('un pendiente también puede dejarlo puesto', assertSucceeds(comp(C, T1, { 'h-caro': 'Caro Prueba' })));
  await check('NO si no está anotado en ese turno', assertFails(comp(B, T2, { 'h-beto': 'Beto Prueba' })));
  await check('con Google sin ser coordinador NO', assertFails(comp(G, T1, { [uidOf(G)]: 'Gente' })));
  await check('otro confirmado del mismo turno lo ve', assertSucceeds(db(B).doc('companeros/' + T1).get()));
  await check('un pendiente NO lo ve', assertFails(db(C).doc('companeros/' + T1).get()));
  await check('alguien de otro turno NO lo ve', assertFails(db(B).doc('companeros/' + T2).get()));
  await check('sin link NO lo ve', assertFails(anonDb('anon-x').doc('companeros/' + T1).get()));
  await check('con Google sin ser coordinador NO lo ve', assertFails(db(G).doc('companeros/' + T1).get()));
  await check('un hermano NO lista todos', assertFails(db(A).collection('companeros').where('cid', '==', CID).get()));
  await check('el coordinador lo ve', assertSucceeds(db(CO).doc('companeros/' + T1).get()));
  await check('el coordinador lista los de su campaña', assertSucceeds(db(CO).collection('companeros').where('cid', '==', CID).get()));
  await check('cada uno saca su nombre', assertSucceeds(db(A).doc('companeros/' + T1).update({ 'n.h-ana': DEL() })));
  await check('NO saca el de otro', assertFails(db(A).doc('companeros/' + T1).update({ 'n.h-caro': DEL() })));
  await check('el coordinador saca un nombre (al no confirmar)', assertSucceeds(db(CO).doc('companeros/' + T1).update({ 'n.h-caro': DEL() })));
  await check('un hermano NO borra el documento', assertFails(db(A).doc('companeros/' + T1).delete()));
  await check('el coordinador lo borra cuando el turno pasó', assertSucceeds(db(CO).doc('companeros/' + T1).delete()));

  section('Publicaciones de la provincia');
  const pubOk = { nombre: 'La Atalaya', tipo: 'Revista', idioma: 'Español', edicion: 'N.º 1 de 2026', foto: 'data:image/jpeg;base64,AAAA' };
  await check('un administrador carga una publicación', assertSucceeds(db(ADM).doc('publicaciones/p1').set(pubOk)));
  await check('un coordinador NO', assertFails(db(CO).doc('publicaciones/p2').set(pubOk)));
  await check('un hermano NO', assertFails(db(A).doc('publicaciones/p2').set(pubOk)));
  await check('NO con campos de más', assertFails(db(ADM).doc('publicaciones/p2').set(Object.assign({ precio: 1 }, pubOk))));
  await check('NO una foto que no es JPEG', assertFails(db(ADM).doc('publicaciones/p2').set(Object.assign({}, pubOk, { foto: 'data:image/png;base64,AAAA' }))));
  await check('NO sin nombre', assertFails(db(ADM).doc('publicaciones/p2').set(Object.assign({}, pubOk, { nombre: '' }))));
  await check('un hermano la ve', assertSucceeds(db(A).collection('publicaciones').get()));
  await check('sin link NO la ve', assertFails(anonDb('anon-x').collection('publicaciones').get()));
  await check('el administrador la borra', assertSucceeds(db(ADM).doc('publicaciones/p1').delete()));

  section('Lo entregado en cada turno');
  const F3 = '2026-10-19', E1 = `${CID}__${F3}__t1`, E2 = `${CID}__${F3}__t2`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await f.doc('cupos/' + E1).set({ cid: CID, fecha: F3, tid: 't1', ocupados: { 'h-ana': 'c', 'h-beto': 'c', 'h-caro': 'p' } });
    await f.doc('cupos/' + E2).set({ cid: CID, fecha: F3, tid: 't2', ocupados: { 'h-ana': 'c' } });
  });
  const ent = (email, id, extra) => { const [, fe, ti] = id.split('__'); return db(email).doc('entregas/' + id).set(Object.assign({ cid: CID, fecha: fe, tid: ti, k: 'k1', modo: 'qr', items: { p1: 5, p2: 3 }, por: uidOf(email), porNombre: 'Ana Prueba', at: TS() }, extra || {})); };
  await check('un confirmado carga lo entregado', assertSucceeds(ent(A, E1)));
  await check('su compañero confirmado lo corrige', assertSucceeds(ent(B, E1, { items: { p1: 6 }, porNombre: 'Beto Prueba' })));
  await check('un pendiente NO carga', assertFails(ent(C, E1, { porNombre: 'Caro' })));
  await check('NO firmado a nombre de otro', assertFails(ent(A, E1, { por: 'h-beto' })));
  await check('NO con campos de más (p. ej. datos de alguien)', assertFails(ent(A, E1, { celular: '343' })));
  await check('NO si el id no coincide con el turno', assertFails(db(A).doc('entregas/' + E1).set({ cid: CID, fecha: '2026-10-20', tid: 't1', k: 'k1', modo: 'qr', items: {}, por: 'h-ana', porNombre: 'Ana', at: TS() })));
  await check('NO de un turno en el que no está', assertFails(ent(B, E2, { porNombre: 'Beto' })));
  await check('NO con un modo inventado', assertFails(ent(A, E1, { modo: 'otro' })));
  await check('un confirmado la ve', assertSucceeds(db(B).doc('entregas/' + E1).get()));
  await check('un pendiente NO la ve', assertFails(db(C).doc('entregas/' + E1).get()));
  await check('un hermano NO lista todas', assertFails(db(A).collection('entregas').where('cid', '==', CID).get()));
  await check('con Google sin ser coordinador NO la ve', assertFails(db(G).doc('entregas/' + E1).get()));
  await check('el coordinador lista las de su campaña', assertSucceeds(db(CO).collection('entregas').where('cid', '==', CID).get()));
  await check('el coordinador la corrige', assertSucceeds(db(CO).doc('entregas/' + E1).set({ cid: CID, fecha: F3, tid: 't1', k: 'k2', modo: 'mano', items: { p1: 4 }, por: uidOf(CO), porNombre: 'Coord', at: TS() })));
  await check('un hermano NO la borra', assertFails(db(A).doc('entregas/' + E1).delete()));
  await check('el coordinador la borra', assertSucceeds(db(CO).doc('entregas/' + E1).delete()));

  section('Problemas de los carritos (mantenimiento)');
  const prob = (email, id, extra) => db(email).doc('problemas/' + id).set(Object.assign({ cid: CID, k: 'k1', tipo: 'Rueda', nota: 'La rueda está floja', noUsar: false, por: uidOf(email), porNombre: 'Ana Prueba', at: TS(), estado: 'nuevo' }, extra || {}));
  await check('un hermano informa un problema', assertSucceeds(prob(A, 'pr1', { foto: 'data:image/jpeg;base64,AAAA', turno: E1 })));
  await check('NO firmado por otro', assertFails(prob(A, 'pr2', { por: 'h-beto' })));
  await check('NO ya marcado como arreglado', assertFails(prob(A, 'pr2', { estado: 'ok' })));
  await check('NO con campos de más', assertFails(prob(A, 'pr2', { celular: '343' })));
  await check('NO para una campaña que no existe', assertFails(prob(A, 'pr2', { cid: 'no-existe' })));
  await check('sin link NO', assertFails(anonDb('anon-x').doc('problemas/pr2').set({ cid: CID, k: 'k1', tipo: 'Rueda', por: 'anon-x', porNombre: 'X', at: TS(), estado: 'nuevo' })));
  await check('con Google sin ser coordinador NO', assertFails(prob(G, 'pr2')));
  await check('el hermano NO lo lee (ni los de otros)', assertFails(db(A).doc('problemas/pr1').get()));
  await check('un hermano NO lista los problemas', assertFails(db(A).collection('problemas').where('cid', '==', CID).get()));
  await check('el coordinador los lista', assertSucceeds(db(CO).collection('problemas').where('cid', '==', CID).get()));
  await check('el hermano NO lo cambia', assertFails(db(A).doc('problemas/pr1').update({ estado: 'ok' })));
  await check('el coordinador lo pasa a "en arreglo"', assertSucceeds(db(CO).doc('problemas/pr1').update({ estado: 'arreglo', cambio: { por: CO, at: 'x' } })));
  await check('el coordinador NO cambia lo que escribió el hermano', assertFails(db(CO).doc('problemas/pr1').update({ nota: 'otra cosa' })));
  await check('el coordinador lo marca arreglado', assertSucceeds(db(CO).doc('problemas/pr1').update({ estado: 'ok', cambio: { por: CO, at: 'y' } })));
  await check('NO un estado inventado', assertFails(db(CO).doc('problemas/pr1').update({ estado: 'perdido' })));
  await check('el coordinador informa uno en una revisión', assertSucceeds(prob(CO, 'pr3', { porNombre: 'Coord (revisión)' })));
  await check('un hermano NO borra', assertFails(db(A).doc('problemas/pr3').delete()));
  await check('el coordinador borra', assertSucceeds(db(CO).doc('problemas/pr3').delete()));

  await env.cleanup();
  console.log(`\n${ok} OK, ${bad} fallaron`);
  process.exitCode = bad ? 1 : 0;
})().catch((e) => { console.error('Error al correr las pruebas:', e.message); process.exitCode = 1; });
