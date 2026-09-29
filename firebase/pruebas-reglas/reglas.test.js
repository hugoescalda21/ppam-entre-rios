/* =====================================================================
   Pruebas de las reglas de Firestore — PPAM Entre Ríos
   Corren contra el emulador (proyecto "demo-ppam": no toca la base real).
   Una vez: npm install      ·      Cada vez: npm test      (hace falta Java 21)
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
try { require('firebase/compat/app').default.firestore.setLogLevel('silent'); } catch (e) { /* nada */ }

const TEC = 'hugoescalda@gmail.com', ADM = 'admin@x.com', CO = 'coord@x.com', CO2 = 'coord2@x.com', A = 'ana@x.com', B = 'beto@x.com';
const CID = 'parana-terminal', F = '2026-10-05';
const cupo = (tid) => `cupos/${CID}__${F}__${tid}`;
const ped = (tid, uid) => `pedidos/${CID}__${F}__${tid}__${uid}`;
const uidOf = (e) => 'uid-' + e.split('@')[0];

let ok = 0, bad = 0;
async function check(label, p) {
  try { await p; ok++; console.log('  ✅', label); }
  catch (e) { bad++; console.log('  ❌', label, '—', (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 200)); }
}
const section = (t) => console.log('\n' + t);

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-ppam', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
  const db = (email) => email ? env.authenticatedContext(uidOf(email), { email }).firestore() : env.unauthenticatedContext().firestore();
  const datos = (email, tid, extra) => Object.assign({ cid: CID, fecha: F, tid, punto: 'p1', desde: '08:00', hasta: '10:00', uid: uidOf(email), email, nombre: 'Ana', apellido: 'Paz', congregacion: 'San Agustín (Paraná)', celular: '343 555-0000', estado: 'pendiente', creado: '2026-10-01T10:00:00Z' }, extra || {});
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
  });

  section('1) Lo público');
  await check('sin sesión se ven las campañas', assertSucceeds(db(null).doc('campanas/' + CID).get()));
  await check('sin sesión se ven los cupos', assertSucceeds(db(null).collection('cupos').where('cid', '==', CID).get()));
  await check('sin sesión se ve la lista de congregaciones', assertSucceeds(db(null).doc('config/publico').get()));
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
  await check('NO se pide con el email de otro', assertFails(pedir(B, 't2', { email: A })));
  await check('NO se pide ya confirmado', assertFails(pedir(B, 't2', { estado: 'confirmado' })));
  await check('NO se aceptan campos de más', assertFails(pedir(B, 't2', { dni: '123' })));
  await check('NO sin celular', assertFails(pedir(B, 't2', { celular: '' })));
  await check('Beto pide el último lugar del turno de 8', assertSucceeds(pedir(B, 't1')));
  await check('un tercero NO entra: el turno está completo', assertFails(pedir(CO2, 't1')));

  section('4) Coordinador');
  await check('ve los pedidos de su campaña', assertSucceeds(db(CO).collection('pedidos').where('cid', '==', CID).get()));
  await check('confirma el pedido de Ana', assertSucceeds((async () => { const f = db(CO), b = f.batch(); b.set(f.doc(cupo('t1')), { cid: CID, fecha: F, tid: 't1', ocupados: { [uidOf(A)]: 'c' } }, { merge: true }); b.update(f.doc(ped('t1', uidOf(A))), { estado: 'confirmado', actualizado: 'x', por: CO }); await b.commit(); })()));
  await check('NO cambia los datos personales del pedido', assertFails(db(CO).doc(ped('t1', uidOf(A))).update({ celular: '000' })));
  await check('otro coordinador NO ve pedidos de esta campaña', assertFails(db(CO2).collection('pedidos').where('cid', '==', CID).get()));
  await check('Ana NO se confirma sola', assertFails(db(A).doc(ped('t1', uidOf(A))).update({ estado: 'confirmado' })));

  section('5) Cancelar y volver a pedir');
  await check('Beto cancela su turno', assertSucceeds((async () => { const f = db(B), b = f.batch(); b.update(f.doc(cupo('t1')), { ['ocupados.' + uidOf(B)]: require('firebase/compat/app').default.firestore.FieldValue.delete() }); b.delete(f.doc(ped('t1', uidOf(B)))); await b.commit(); })()));
  await check('ahora entra otro en ese lugar', assertSucceeds(pedir(CO2, 't1')));
  await check('el coordinador no confirma a ese otro', assertSucceeds((async () => { const f = db(CO), b = f.batch(); b.update(f.doc(cupo('t1')), { ['ocupados.' + uidOf(CO2)]: require('firebase/compat/app').default.firestore.FieldValue.delete() }); b.update(f.doc(ped('t1', uidOf(CO2))), { estado: 'rechazado', actualizado: 'x', por: CO }); await b.commit(); })()));
  await check('y puede volver a pedir otro día u horario (o el mismo)', assertSucceeds(pedir(CO2, 't1')));

  await env.cleanup();
  console.log(`\n${ok} OK, ${bad} fallaron`);
  process.exitCode = bad ? 1 : 0;
})().catch((e) => { console.error('Error al correr las pruebas:', e.message); process.exitCode = 1; });
