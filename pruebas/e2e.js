'use strict';

/**
 * Prueba de extremo a extremo contra un servidor ya levantado.
 *
 *   node pruebas/e2e.js                    (usa http://localhost:3000)
 *   BASE=https://mi-app.vercel.app node pruebas/e2e.js
 *
 * Crea dos loterias de prueba (TEST1/TEST2), vende, publica resultados,
 * verifica los premios peso por peso, cobra, y al final deja todo desactivado.
 * Requiere las credenciales de un administrador en ADMIN_USUARIO/ADMIN_CLAVE.
 */

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '') + '/api';
const ADMIN_USUARIO = process.env.ADMIN_USUARIO || 'admin';
const ADMIN_CLAVE = process.env.ADMIN_CLAVE;

if (!ADMIN_CLAVE) {
  console.error('\n  Falta ADMIN_CLAVE.');
  console.error('  Ejemplo:  ADMIN_CLAVE=xxxxx node pruebas/e2e.js\n');
  process.exit(2);
}

let token = '';
let fallos = 0, pasos = 0;

async function llamar(metodo, ruta, datos) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: datos ? JSON.stringify(datos) : undefined,
  });
  const t = await r.text();
  let c; try { c = JSON.parse(t); } catch { c = { error: t.slice(0, 200) }; }
  if (!r.ok) { const e = new Error(c.error || r.status); e.status = r.status; throw e; }
  return c;
}
const get = (r) => llamar('GET', r);
const post = (r, d) => llamar('POST', r, d);
const put = (r, d) => llamar('PUT', r, d);
const del = (r) => llamar('DELETE', r);

function ok(nombre, condicion, extra = '') {
  pasos++;
  if (condicion) console.log(`  OK   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre} ${extra}`); }
}

async function debeFallar(nombre, fn, fragmento) {
  pasos++;
  try {
    await fn();
    fallos++;
    console.log(`  FALLA ${nombre} (no lanzo error)`);
  } catch (e) {
    if (!fragmento || e.message.toLowerCase().includes(fragmento.toLowerCase())) {
      console.log(`  OK   ${nombre}  -> "${e.message.split('\n')[0].slice(0, 68)}"`);
    } else {
      fallos++;
      console.log(`  FALLA ${nombre}: mensaje inesperado "${e.message.split('\n')[0]}"`);
    }
  }
}

(async () => {
  console.log(`\n  Servidor: ${BASE}\n`);

  console.log('=== 1. CONEXION Y AUTENTICACION ===');
  const salud = await fetch(BASE + '/salud').then((r) => r.json());
  ok('el servidor responde', salud.ok === true, JSON.stringify(salud));
  ok('el esquema esta completo', salud.esquema_completo === true);

  await debeFallar('rechaza clave incorrecta',
    () => post('/auth/login', { usuario: ADMIN_USUARIO, clave: 'claveMalaXYZ' }), 'incorrect');

  const login = await post('/auth/login', { usuario: ADMIN_USUARIO, clave: ADMIN_CLAVE });
  token = login.token;
  ok('login del administrador', login.usuario.rol === 'admin');

  const yo = await get('/auth/yo');
  const hoy = yo.config.hoy;
  console.log(`  fecha de negocio: ${hoy}`);

  console.log('\n=== 2. LOTERIAS DE PRUEBA ===');
  const existentes = (await get('/admin/loterias')).loterias;
  const ids = {};
  for (const cod of ['TEST1', 'TEST2']) {
    const prev = existentes.find((l) => l.codigo === cod);
    const datos = {
      nombre: `Sorteo Prueba ${cod.slice(-1)}`, hora_cierre: '23:59', dias: '1,2,3,4,5,6,7',
      activo: true, q_quiniela: true, q_pale: true, q_tripleta: true, q_superpale: true, orden: 90,
    };
    if (prev) { ids[cod] = prev.id; await put(`/admin/loterias/${prev.id}`, datos); }
    else ids[cod] = (await post('/admin/loterias', { codigo: cod, ...datos })).id;
  }
  ok('loterias de prueba listas', !!ids.TEST1 && !!ids.TEST2);

  for (const cod of ['TEST1', 'TEST2']) {
    try { await del(`/resultados?loteria_id=${ids[cod]}&fecha=${hoy}`); } catch { /* no habia */ }
  }

  const cat = await get(`/catalogo/loterias?fecha=${hoy}`);
  const t1 = cat.loterias.find((l) => l.id === ids.TEST1);
  ok('TEST1 abierta para vender', t1 && t1.estado.abierto, JSON.stringify(t1 && t1.estado));
  ok('TEST1 admite super pale', t1 && t1.tipos.superpale === true);

  console.log('\n=== 3. VALIDACIONES DE VENTA ===');
  const venta = (jugadas, extra = {}) => post('/tickets', { fecha: hoy, jugadas, ...extra });

  await debeFallar('rechaza numero invalido',
    () => venta([{ numeros: '4', monto: 10, loterias: [ids.TEST1] }]), 'invalido');
  await debeFallar('rechaza monto bajo el minimo',
    () => venta([{ numeros: '45', monto: 1, loterias: [ids.TEST1] }]), 'minimo');
  await debeFallar('rechaza ticket sin loteria',
    () => venta([{ numeros: '45', monto: 10, loterias: [] }]), 'loteria');
  await debeFallar('rechaza tripleta con numeros repetidos',
    () => venta([{ numeros: '010102', monto: 10, loterias: [ids.TEST1] }]), 'repetidos');
  await debeFallar('rechaza super pale de una sola loteria',
    () => venta([{ numeros: '0708', tipo: 'superpale', monto: 10, loterias: [ids.TEST1] }]), 'segunda loteria');
  await debeFallar('rechaza transferencia sin referencia',
    () => venta([{ numeros: '45', monto: 10, loterias: [ids.TEST1] }], { metodo_pago: 'transferencia' }),
    'referencia');

  console.log('\n=== 4. TOPES POR NUMERO ===');
  await post('/admin/limites', { loteria_id: ids.TEST1, tipo: 'quiniela', numero: '99', monto_max: 30 });
  const tk1 = await venta([{ numeros: '99', monto: 25, loterias: [ids.TEST1] }]);
  ok('vende 25 de un numero topado en 30', tk1.ticket.total === 25, `total=${tk1.ticket.total}`);
  await debeFallar('bloquea al pasar del tope',
    () => venta([{ numeros: '99', monto: 10, loterias: [ids.TEST1] }]), 'tope');

  const disp = await get(`/catalogo/disponible?fecha=${hoy}&loteria_id=${ids.TEST1}&tipo=quiniela&numeros=99`);
  ok('el disponible refleja el tope',
    disp.tope === 30 && disp.vendido === 25 && disp.disponible === 5, JSON.stringify(disp));

  await post(`/tickets/${tk1.ticket.codigo}/cancelar`);
  ok('la anulacion deja el ticket cancelado',
    (await get(`/tickets/${tk1.ticket.codigo}`)).ticket.estado === 'cancelado');
  const disp2 = await get(`/catalogo/disponible?fecha=${hoy}&loteria_id=${ids.TEST1}&tipo=quiniela&numeros=99`);
  ok('anular libera el tope', disp2.vendido === 0, JSON.stringify(disp2));

  console.log('\n=== 5. FACTURACION ===');
  const vendido = await venta([
    { numeros: '45', monto: 20, loterias: [ids.TEST1, ids.TEST2] },
    { numeros: '1245', monto: 10, loterias: [ids.TEST1] },
    { numeros: '010203', monto: 5, loterias: [ids.TEST1] },
    { numeros: '0845', tipo: 'superpale', monto: 5, loterias: [ids.TEST1], loteria2_id: ids.TEST2 },
  ], { cliente: 'Cliente de prueba', metodo_pago: 'efectivo' });

  const tk = vendido.ticket;
  console.log(`  ticket ${tk.codigo}  pin ${tk.pin}`);
  ok('expande la quiniela a las 2 loterias', tk.jugadas.length === 5, `jugadas=${tk.jugadas.length}`);
  ok('total correcto (20x2 + 10 + 5 + 5 = 60)', tk.total === 60, `total=${tk.total}`);
  ok('ordena los numeros del pale', tk.jugadas.find((j) => j.tipo === 'pale').numeros === '12-45');
  ok('estado inicial activo', tk.estado === 'activo');
  ok('registra el cobro en efectivo', tk.metodo_pago === 'efectivo', tk.metodo_pago);

  const porTransferencia = await venta(
    [{ numeros: '77', monto: 50, loterias: [ids.TEST1] }],
    { metodo_pago: 'transferencia', referencia_pago: 'BPD-998877' }
  );
  ok('acepta transferencia con referencia',
    porTransferencia.ticket.metodo_pago === 'transferencia' &&
    porTransferencia.ticket.referencia_pago === 'BPD-998877');

  console.log('\n=== 6. RESULTADOS Y EVALUACION ===');
  const r1 = await post('/resultados', { loteria_id: ids.TEST1, fecha: hoy, primera: '45', segunda: '12', tercera: '99' });
  ok('guarda el resultado de TEST1', r1.resultado.primera === '45');
  ok('el ticket sigue activo si falta un sorteo',
    (await get(`/tickets/${tk.codigo}`)).ticket.estado === 'activo');

  await post('/resultados', { loteria_id: ids.TEST2, fecha: hoy, primera: '08', segunda: '45', tercera: '33' });

  const fin = (await get(`/tickets/${tk.codigo}`)).ticket;
  const j = (tipo, lot) => fin.jugadas.find((x) => x.tipo === tipo && (!lot || Number(x.loteria_id) === lot));

  ok('quiniela 45 en 1ra de TEST1 paga x60 = 1200', j('quiniela', ids.TEST1).premio === 1200, `=${j('quiniela', ids.TEST1).premio}`);
  ok('quiniela 45 en 2da de TEST2 paga x20 = 400', j('quiniela', ids.TEST2).premio === 400, `=${j('quiniela', ids.TEST2).premio}`);
  ok('pale 12-45 en 1ra-2da paga x1000 = 10000', j('pale').premio === 10000, `=${j('pale').premio}`);
  ok('tripleta perdedora', j('tripleta').premio === 0 && j('tripleta').estado === 'perdedora');
  ok('super pale 08-45 paga x2000 = 10000', j('superpale').premio === 10000, `=${j('superpale').premio}`);
  ok('premio total 21600', fin.premio_total === 21600, `=${fin.premio_total}`);
  ok('el ticket queda ganador', fin.estado === 'ganador', fin.estado);

  console.log('\n=== 7. CORRECCION DE RESULTADO ===');
  await post('/resultados', { loteria_id: ids.TEST1, fecha: hoy, primera: '77', segunda: '88', tercera: '99' });
  ok('al corregir, el premio baja a 400',
    (await get(`/tickets/${tk.codigo}`)).ticket.premio_total === 400);
  await post('/resultados', { loteria_id: ids.TEST1, fecha: hoy, primera: '45', segunda: '12', tercera: '99' });
  ok('al restaurar, el premio vuelve a 21600',
    (await get(`/tickets/${tk.codigo}`)).ticket.premio_total === 21600);

  console.log('\n=== 8. PAGO DEL PREMIO ===');
  const chequeo = await get(`/tickets/${tk.codigo}/chequear`);
  ok('el chequeo dice que es cobrable', chequeo.resumen.cobrable === true);

  await debeFallar('exige referencia si el premio va por transferencia',
    () => post(`/tickets/${tk.codigo}/pagar`, { metodo_pago: 'transferencia' }), 'referencia');

  const pago = await post(`/tickets/${tk.codigo}/pagar`, { metodo_pago: 'efectivo' });
  ok('paga el premio', pago.ticket.estado === 'pagado' && pago.ticket.premio_total === 21600);
  ok('registra como se entrego', pago.ticket.metodo_pago_premio === 'efectivo');
  await debeFallar('no permite pagar dos veces', () => post(`/tickets/${tk.codigo}/pagar`, {}), 'ya pagado');
  await debeFallar('no permite anular un ticket pagado', () => post(`/tickets/${tk.codigo}/cancelar`), 'pagado');

  console.log('\n=== 9. REPORTES Y CUADRE DE CAJA ===');
  const resumen = await get(`/reportes/resumen?desde=${hoy}&hasta=${hoy}`);
  ok('el resumen incluye la venta', resumen.venta >= 110, `venta=${resumen.venta}`);
  ok('el resumen incluye los premios', resumen.premios >= 21600, `premios=${resumen.premios}`);
  ok('balance = venta - premios - comision',
    Math.abs(resumen.balance - (resumen.venta - resumen.premios - resumen.comision)) < 0.01);
  ok('separa efectivo de transferencia',
    resumen.venta_transferencia >= 50 && resumen.venta_efectivo >= 60,
    `efectivo=${resumen.venta_efectivo} transf=${resumen.venta_transferencia}`);
  ok('la venta total cuadra con la suma de las dos formas de cobro',
    Math.abs(resumen.venta - (resumen.venta_efectivo + resumen.venta_transferencia)) < 0.01);

  const panel = await get(`/reportes/panel?desde=${hoy}&hasta=${hoy}`);
  ok('el panel trae todas sus secciones',
    !!panel.resumen && Array.isArray(panel.dia) && Array.isArray(panel.loteria) &&
    Array.isArray(panel.tipo) && Array.isArray(panel.cobro));

  const riesgo = await get(`/reportes/riesgo?fecha=${hoy}&tipo=quiniela`);
  ok('el riesgo calcula la exposicion', riesgo.filas.length > 0 && riesgo.filas[0].exposicion > 0);

  const cierre = await get(`/reportes/cierre?fecha=${hoy}`);
  ok('el cierre separa la gaveta del resto',
    typeof cierre.entregar === 'number' && typeof cierre.venta_transferencia === 'number');
  ok('lo cobrado por transferencia no entra a la gaveta',
    Math.abs(cierre.entregar - (cierre.venta_efectivo - cierre.pagado_efectivo - cierre.comision)) < 0.01,
    `entregar=${cierre.entregar}`);

  const auditoria = await get(`/admin/auditoria?desde=${hoy}&hasta=${hoy}`);
  ok('la auditoria registro los movimientos de hoy', auditoria.auditoria.length > 0,
    `n=${auditoria.auditoria.length}`);
  ok('la auditoria incluye el pago del premio',
    auditoria.auditoria.some((a) => a.accion === 'pago_premio'));

  console.log('\n=== 10. LIMPIEZA ===');
  const tope = (await get('/admin/limites')).limites
    .find((l) => l.numero === '99' && l.loteria_id === ids.TEST1);
  if (tope) await del(`/admin/limites/${tope.id}`);
  for (const cod of ['TEST1', 'TEST2']) await put(`/admin/loterias/${ids[cod]}`, { activo: false });
  ok('loterias de prueba desactivadas', true);

  console.log('\n============================================');
  console.log(`  ${pasos - fallos} de ${pasos} comprobaciones correctas`);
  console.log(`  ${fallos === 0 ? 'TODO BIEN' : fallos + ' FALLO(S)'}`);
  console.log('============================================\n');
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error('\n  ERROR NO CONTROLADO:', e.message);
  console.error(e.stack?.split('\n').slice(1, 4).join('\n'));
  process.exit(2);
});
