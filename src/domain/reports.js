'use strict';

/**
 * Reportes: ventas, premios, comisiones, balance, riesgo y cierre de caja.
 *
 * Regla de negocio del balance:
 *   venta    = suma de tickets no cancelados
 *   premios  = suma de premios de tickets ganadores o pagados
 *   comision = venta x % de comision del vendedor
 *   balance  = venta - premios - comision   (lo que le queda a la banca)
 *
 * El cuadre de caja es distinto del balance: solo cuenta el dinero que
 * realmente paso por la gaveta del cajero. Lo cobrado por transferencia
 * suma a la venta pero no al efectivo a entregar.
 */

const { q } = require('../db');
const { money } = require('../lib/http');
const F = require('../lib/dates');

/** Construye el WHERE comun respetando el rol del usuario. */
function filtro(usuario, q2 = {}) {
  const where = [`t.estado <> 'cancelado'`];
  const params = {};

  where.push('t.fecha_sorteo BETWEEN @desde::date AND @hasta::date');
  params.desde = F.esFecha(q2.desde) ? q2.desde : F.hoy();
  params.hasta = F.esFecha(q2.hasta) ? q2.hasta : params.desde;
  if (params.hasta < params.desde) [params.desde, params.hasta] = [params.hasta, params.desde];

  if (usuario.rol === 'vendedor') {
    where.push('t.usuario_id = @uid');
    params.uid = usuario.id;
  } else if (usuario.rol === 'banca') {
    where.push('t.banca_id = @bid');
    params.bid = usuario.banca_id;
    if (q2.usuario_id) { where.push('t.usuario_id = @uid'); params.uid = Number(q2.usuario_id); }
  } else {
    if (q2.banca_id) { where.push('t.banca_id = @bid'); params.bid = Number(q2.banca_id); }
    if (q2.usuario_id) { where.push('t.usuario_id = @uid'); params.uid = Number(q2.usuario_id); }
  }

  // `base` es el mismo filtro sin la condicion de estado, para poder mirar
  // los tickets cancelados reutilizando exactamente los mismos parametros.
  return { sql: where.join(' AND '), base: where.slice(1).join(' AND '), params };
}

const SUM_PREMIO = `SUM(CASE WHEN t.estado IN ('ganador','pagado') THEN t.premio_total ELSE 0 END)`;
const SUM_PAGADO = `SUM(CASE WHEN t.estado = 'pagado' THEN t.premio_total ELSE 0 END)`;
const SUM_POR_PAGAR = `SUM(CASE WHEN t.estado = 'ganador' THEN t.premio_total ELSE 0 END)`;

const n = (v) => Number(v) || 0;

/** Totales generales del periodo. */
async function resumen(usuario, q2) {
  const { sql, base, params } = filtro(usuario, q2);

  const r = await q.uno(
    `SELECT COUNT(*) AS tickets,
            COALESCE(SUM(t.total), 0)     AS venta,
            COALESCE(${SUM_PREMIO}, 0)    AS premios,
            COALESCE(${SUM_PAGADO}, 0)    AS pagado,
            COALESCE(${SUM_POR_PAGAR}, 0) AS por_pagar,
            COALESCE(SUM(CASE WHEN t.metodo_pago = 'efectivo' THEN t.total ELSE 0 END), 0)      AS venta_efectivo,
            COALESCE(SUM(CASE WHEN t.metodo_pago = 'transferencia' THEN t.total ELSE 0 END), 0) AS venta_transferencia,
            COUNT(*) FILTER (WHERE t.estado IN ('ganador','pagado')) AS ganadores,
            COUNT(*) FILTER (WHERE t.estado = 'activo')              AS pendientes
       FROM tickets t WHERE ${sql}`,
    params
  );

  const comision = n(await q.valor(
    `SELECT COALESCE(SUM(t.total * u.comision_pct / 100.0), 0)
       FROM tickets t JOIN usuarios u ON u.id = t.usuario_id WHERE ${sql}`,
    params
  ));

  const cancelados = await q.uno(
    `SELECT COUNT(*) AS c, COALESCE(SUM(t.total), 0) AS monto
       FROM tickets t WHERE t.estado = 'cancelado' AND ${base}`,
    params
  );

  const jugadas = n(await q.valor(
    `SELECT COUNT(*) FROM jugadas j JOIN tickets t ON t.id = j.ticket_id WHERE ${sql}`,
    params
  ));

  return {
    desde: params.desde, hasta: params.hasta,
    tickets: n(r.tickets), jugadas,
    venta: money(r.venta), premios: money(r.premios),
    pagado: money(r.pagado), por_pagar: money(r.por_pagar),
    venta_efectivo: money(r.venta_efectivo),
    venta_transferencia: money(r.venta_transferencia),
    comision: money(comision),
    balance: money(n(r.venta) - n(r.premios) - comision),
    ganadores: n(r.ganadores), pendientes: n(r.pendientes),
    cancelados: n(cancelados.c), monto_cancelado: money(cancelados.monto),
  };
}

const conBalance = (filas) => filas.map((r) => ({
  ...r,
  venta: money(r.venta),
  premios: money(r.premios),
  balance: money(n(r.venta) - n(r.premios)),
}));

/** Venta y premios dia por dia. */
async function porDia(usuario, q2) {
  const { sql, params } = filtro(usuario, q2);
  return conBalance(await q.todos(
    `SELECT t.fecha_sorteo AS fecha, COUNT(*) AS tickets,
            COALESCE(SUM(t.total),0) AS venta,
            COALESCE(${SUM_PREMIO},0) AS premios
       FROM tickets t WHERE ${sql}
      GROUP BY t.fecha_sorteo ORDER BY t.fecha_sorteo DESC`,
    params
  ));
}

/** Venta y premios por loteria (a nivel de jugada). */
async function porLoteria(usuario, q2) {
  const { sql, params } = filtro(usuario, q2);
  return conBalance(await q.todos(
    `SELECT l.id, l.nombre AS loteria, l.color, COUNT(*) AS jugadas,
            COALESCE(SUM(j.monto),0) AS venta,
            COALESCE(SUM(CASE WHEN j.estado = 'ganadora' THEN j.premio ELSE 0 END),0) AS premios
       FROM jugadas j
       JOIN tickets t  ON t.id = j.ticket_id
       JOIN loterias l ON l.id = j.loteria_id
      WHERE ${sql} AND j.estado <> 'cancelada'
      GROUP BY l.id, l.nombre, l.color ORDER BY venta DESC`,
    params
  ));
}

/** Venta y premios por tipo de jugada. */
async function porTipo(usuario, q2) {
  const { sql, params } = filtro(usuario, q2);
  return conBalance(await q.todos(
    `SELECT j.tipo, COUNT(*) AS jugadas,
            COALESCE(SUM(j.monto),0) AS venta,
            COALESCE(SUM(CASE WHEN j.estado = 'ganadora' THEN j.premio ELSE 0 END),0) AS premios
       FROM jugadas j JOIN tickets t ON t.id = j.ticket_id
      WHERE ${sql} AND j.estado <> 'cancelada'
      GROUP BY j.tipo ORDER BY venta DESC`,
    params
  ));
}

/** Venta por forma de cobro: cuanto entro en efectivo y cuanto por transferencia. */
async function porMetodoPago(usuario, q2) {
  const { sql, params } = filtro(usuario, q2);
  return (await q.todos(
    `SELECT t.metodo_pago AS metodo, COUNT(*) AS tickets,
            COALESCE(SUM(t.total),0) AS venta
       FROM tickets t WHERE ${sql}
      GROUP BY t.metodo_pago ORDER BY venta DESC`,
    params
  )).map((r) => ({ ...r, tickets: n(r.tickets), venta: money(r.venta) }));
}

/** Venta, premios y comision por vendedor. */
async function porVendedor(usuario, q2) {
  const { sql, params } = filtro(usuario, q2);
  const filas = await q.todos(
    `SELECT u.id, u.usuario, u.nombre, u.comision_pct, b.nombre AS banca,
            COUNT(*) AS tickets,
            COALESCE(SUM(t.total),0) AS venta,
            COALESCE(${SUM_PREMIO},0) AS premios
       FROM tickets t
       JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN bancas b ON b.id = t.banca_id
      WHERE ${sql}
      GROUP BY u.id, u.usuario, u.nombre, u.comision_pct, b.nombre
      ORDER BY venta DESC`,
    params
  );
  return filas.map((r) => {
    const comision = money(n(r.venta) * n(r.comision_pct) / 100);
    return {
      ...r, tickets: n(r.tickets), venta: money(r.venta), premios: money(r.premios), comision,
      balance: money(n(r.venta) - n(r.premios) - comision),
    };
  });
}

/** Venta, premios y balance por banca (solo admin ve varias). */
async function porBanca(usuario, q2) {
  const { sql, params } = filtro(usuario, q2);
  return conBalance(await q.todos(
    `SELECT b.id, b.codigo, b.nombre AS banca, COUNT(*) AS tickets,
            COALESCE(SUM(t.total),0) AS venta,
            COALESCE(${SUM_PREMIO},0) AS premios
       FROM tickets t JOIN bancas b ON b.id = t.banca_id
      WHERE ${sql}
      GROUP BY b.id, b.codigo, b.nombre ORDER BY venta DESC`,
    params
  ));
}

/** Numeros mas jugados y exposicion (cuanto se pagaria si salen). */
async function riesgo(usuario, q2) {
  const fecha = F.esFecha(q2.fecha) ? q2.fecha : F.hoy();
  const tipo = ['quiniela', 'pale', 'tripleta', 'superpale'].includes(q2.tipo) ? q2.tipo : 'quiniela';
  const loteriaId = q2.loteria_id ? Number(q2.loteria_id) : null;

  const p = { fecha, tipo, lid: loteriaId };
  let alcance = '';
  if (usuario.rol === 'banca') { alcance = ' AND t.banca_id = @bid'; p.bid = usuario.banca_id; }
  else if (usuario.rol === 'vendedor') { alcance = ' AND t.usuario_id = @uid'; p.uid = usuario.id; }

  const filas = await q.todos(
    `SELECT j.numeros, l.nombre AS loteria, l.id AS loteria_id,
            SUM(j.monto) AS vendido, COUNT(*) AS jugadas
       FROM jugadas j
       JOIN tickets t  ON t.id = j.ticket_id
       JOIN loterias l ON l.id = j.loteria_id
      WHERE t.fecha_sorteo = @fecha::date AND t.estado <> 'cancelado'
        AND j.estado <> 'cancelada' AND j.tipo = @tipo
        AND (@lid::bigint IS NULL OR j.loteria_id = @lid::bigint) ${alcance}
      GROUP BY j.numeros, l.id, l.nombre
      ORDER BY vendido DESC LIMIT 100`,
    p
  );

  const { tablasDeTodas } = require('./prizes');
  const { limiteDe } = require('./limits');
  const tablaDe = await tablasDeTodas();

  const salida = [];
  for (const r of filas) {
    const lid = Number(r.loteria_id);
    const tabla = tablaDe(lid);
    const mult = tipo === 'quiniela' ? (tabla.quiniela['1'] || 0)
      : tipo === 'pale' ? (tabla.pale.directo || 0)
      : tipo === 'tripleta' ? (tabla.tripleta.directo || 0)
      : (tabla.superpale.directo || 0);
    const tope = await limiteDe(lid, tipo, r.numeros);
    salida.push({
      ...r, loteria_id: lid, jugadas: n(r.jugadas),
      vendido: money(r.vendido), multiplicador: mult,
      exposicion: money(n(r.vendido) * mult), tope,
      disponible: tope > 0 ? money(Math.max(0, tope - n(r.vendido))) : null,
    });
  }
  return salida;
}

/** Tickets del periodo (listado con filtros). */
async function tickets(usuario, q2) {
  const { sql, base, params } = filtro(usuario, q2);
  const extra = [];
  if (q2.estado && q2.estado !== 'todos') { extra.push('t.estado = @estado'); params.estado = q2.estado; }
  if (q2.codigo) { extra.push('UPPER(t.codigo) LIKE @codigo'); params.codigo = `%${String(q2.codigo).toUpperCase()}%`; }
  if (q2.metodo_pago) { extra.push('t.metodo_pago = @metodo'); params.metodo = q2.metodo_pago; }
  params.limite = Math.min(Number(q2.limite) || 200, 1000);

  // 'todos' y 'cancelado' necesitan ver tambien los tickets anulados.
  const donde = (q2.estado === 'cancelado' || q2.estado === 'todos') ? base : sql;

  return (await q.todos(
    `SELECT t.id, t.codigo, t.fecha_sorteo, t.creado_en, t.total, t.estado, t.premio_total,
            t.cliente, t.metodo_pago, t.referencia_pago,
            u.nombre AS vendedor, b.nombre AS banca,
            (SELECT COUNT(*) FROM jugadas j WHERE j.ticket_id = t.id) AS jugadas
       FROM tickets t
       JOIN usuarios u ON u.id = t.usuario_id
       JOIN bancas b   ON b.id = t.banca_id
      WHERE ${donde} ${extra.length ? 'AND ' + extra.join(' AND ') : ''}
      ORDER BY t.id DESC LIMIT @limite`,
    params
  )).map((r) => ({ ...r, id: Number(r.id), jugadas: n(r.jugadas), total: money(r.total), premio_total: money(r.premio_total) }));
}

/** Premios ganados aun sin cobrar. */
async function premiosPendientes(usuario, q2) {
  const { sql, params } = filtro(usuario, q2);
  return (await q.todos(
    `SELECT t.id, t.codigo, t.fecha_sorteo, t.total, t.premio_total, t.cliente,
            u.nombre AS vendedor, b.nombre AS banca
       FROM tickets t
       JOIN usuarios u ON u.id = t.usuario_id
       JOIN bancas b   ON b.id = t.banca_id
      WHERE ${sql} AND t.estado = 'ganador'
      ORDER BY t.premio_total DESC LIMIT 500`,
    params
  )).map((r) => ({ ...r, id: Number(r.id), total: money(r.total), premio_total: money(r.premio_total) }));
}

/**
 * Cierre de caja de un vendedor para una fecha.
 *
 * Separa el dinero fisico del resto: lo cobrado por transferencia sube la
 * venta pero no entra a la gaveta, y un premio pagado por transferencia
 * tampoco la vacia.
 */
async function cierreCaja(usuario, { fecha, usuario_id }) {
  const f = F.esFecha(fecha) ? fecha : F.hoy();
  const uid = usuario.rol === 'vendedor' ? usuario.id : Number(usuario_id || usuario.id);

  const u = await q.uno(
    `SELECT u.*, b.nombre AS banca_nombre FROM usuarios u
       LEFT JOIN bancas b ON b.id = u.banca_id WHERE u.id = ?`,
    [uid]
  );
  if (!u) return null;
  if (usuario.rol === 'banca' && Number(u.banca_id) !== usuario.banca_id) return null;

  const r = await q.uno(
    `SELECT COUNT(*) AS tickets,
            COALESCE(SUM(t.total),0) AS venta,
            COALESCE(SUM(CASE WHEN t.metodo_pago = 'efectivo' THEN t.total ELSE 0 END),0)      AS venta_efectivo,
            COALESCE(SUM(CASE WHEN t.metodo_pago = 'transferencia' THEN t.total ELSE 0 END),0) AS venta_transferencia,
            COALESCE(${SUM_PREMIO},0) AS premios,
            COALESCE(${SUM_PAGADO},0) AS pagado,
            COALESCE(SUM(CASE WHEN t.estado = 'pagado' AND COALESCE(t.metodo_pago_premio,'efectivo') = 'efectivo'
                              THEN t.premio_total ELSE 0 END),0) AS pagado_efectivo
       FROM tickets t
      WHERE t.usuario_id = ? AND t.fecha_sorteo = ?::date AND t.estado <> 'cancelado'`,
    [uid, f]
  );

  const venta = n(r.venta);
  const comision = money(venta * n(u.comision_pct) / 100);
  const guardado = await q.uno('SELECT * FROM cierres WHERE usuario_id = ? AND fecha = ?::date', [uid, f]);

  return {
    fecha: f,
    usuario: {
      id: Number(u.id), usuario: u.usuario, nombre: u.nombre,
      comision_pct: n(u.comision_pct), banca: u.banca_nombre,
    },
    tickets: n(r.tickets),
    venta: money(venta),
    venta_efectivo: money(r.venta_efectivo),
    venta_transferencia: money(r.venta_transferencia),
    premios: money(r.premios),
    pagado: money(r.pagado),
    pagado_efectivo: money(r.pagado_efectivo),
    comision,
    balance: money(venta - n(r.premios) - comision),
    // Solo el dinero fisico: lo que el cajero debe entregar de la gaveta.
    entregar: money(n(r.venta_efectivo) - n(r.pagado_efectivo) - comision),
    cerrado: !!guardado,
    cierre: guardado || null,
  };
}

async function guardarCierre(usuario, { fecha, usuario_id, notas }) {
  const c = await cierreCaja(usuario, { fecha, usuario_id });
  if (!c) return null;
  await q.correr(
    `INSERT INTO cierres (banca_id, usuario_id, fecha, venta, premios, comision, balance, tickets, notas, cerrado_por)
     VALUES ((SELECT banca_id FROM usuarios WHERE id = @uid), @uid, @fecha::date,
             @venta, @premios, @comision, @balance, @tickets, @notas, @por)
     ON CONFLICT (usuario_id, fecha) DO UPDATE SET
       venta=excluded.venta, premios=excluded.premios, comision=excluded.comision,
       balance=excluded.balance, tickets=excluded.tickets, notas=excluded.notas,
       cerrado_en=now(), cerrado_por=excluded.cerrado_por`,
    {
      uid: c.usuario.id, fecha: c.fecha, venta: c.venta, premios: c.premios,
      comision: c.comision, balance: c.balance, tickets: c.tickets,
      notas: String(notas || '').slice(0, 300), por: usuario.id,
    }
  );
  return cierreCaja(usuario, { fecha: c.fecha, usuario_id: c.usuario.id });
}

module.exports = {
  resumen, porDia, porLoteria, porTipo, porMetodoPago, porVendedor, porBanca,
  riesgo, tickets, premiosPendientes, cierreCaja, guardarCierre,
};
