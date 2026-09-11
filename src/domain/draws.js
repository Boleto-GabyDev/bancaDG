'use strict';

/**
 * Resultados de sorteos y evaluacion automatica de tickets.
 *
 * Al guardar (o corregir) un resultado se reevaluan todas las jugadas de esa
 * loteria y fecha, incluidos los super pale que la usen como segunda loteria.
 * La reevaluacion es idempotente: se puede corregir un resultado mal digitado
 * y el sistema recalcula premios y estados sin duplicar nada.
 *
 * Nota de rendimiento: contra SQLite local se podia consultar y actualizar
 * fila por fila. Contra Postgres en red eso serian miles de viajes de ida y
 * vuelta, asi que aqui se carga todo de una vez, se evalua en memoria y se
 * escribe en lotes dentro de una sola transaccion.
 */

const { q, tx, getSetting, auditar } = require('../db');
const { HttpError, money } = require('../lib/http');
const F = require('../lib/dates');
const { normNumero } = require('./plays');
const { tablasDeTodas, evaluarJugada } = require('./prizes');

/** Cuantas filas caben por sentencia sin pasar el limite de parametros. */
const LOTE = 500;

// ---------------------------------------------------------------
async function obtenerResultado(loteriaId, fecha) {
  return q.uno('SELECT * FROM resultados WHERE loteria_id = ? AND fecha = ?::date', [loteriaId, fecha]);
}

/**
 * Recalcula los tickets indicados contra los resultados disponibles.
 * Un ticket queda:
 *   activo     -> todavia falta el resultado de alguna de sus loterias
 *   ganador    -> ya se conocen todos y tiene premio
 *   perdedor   -> ya se conocen todos y no tiene premio
 *   pagado / cancelado -> no se tocan
 */
async function recalcularTickets(ticketIds) {
  if (!ticketIds.length) return { tickets: 0, ganadores: 0, premios: 0 };

  const pagarRepetidos = (await getSetting('pagar_repetidos', true)) !== false;
  const tablaDe = await tablasDeTodas();

  let ganadores = 0, premiosTotal = 0, tocados = 0;

  // Se procesa por tandas para que un dia con muchisimos tickets no cargue
  // toda la tabla en memoria de golpe.
  for (let i = 0; i < ticketIds.length; i += LOTE) {
    const tanda = ticketIds.slice(i, i + LOTE);
    const marcas = tanda.map(() => '?').join(',');

    const tickets = await q.todos(
      `SELECT id, fecha_sorteo, estado FROM tickets
        WHERE id IN (${marcas}) AND estado <> 'cancelado'`,
      tanda
    );
    if (!tickets.length) continue;

    const idsVivos = tickets.map((t) => Number(t.id));
    const marcas2 = idsVivos.map(() => '?').join(',');

    const jugadas = await q.todos(
      `SELECT id, ticket_id, loteria_id, loteria2_id, tipo, numeros, monto, estado, premio, detalle
         FROM jugadas WHERE ticket_id IN (${marcas2}) ORDER BY id`,
      idsVivos
    );

    // Resultados de todas las fechas y loterias implicadas, de una sola vez.
    const fechas = [...new Set(tickets.map((t) => t.fecha_sorteo))];
    const marcasF = fechas.map(() => '?').join(',');
    const resultados = await q.todos(
      `SELECT loteria_id, fecha, primera, segunda, tercera
         FROM resultados WHERE fecha IN (${marcasF})`,
      fechas
    );
    const res = new Map();
    for (const r of resultados) res.set(`${Number(r.loteria_id)}|${r.fecha}`, r);

    const porTicket = new Map(tickets.map((t) => [Number(t.id), { ...t, jugadas: [] }]));
    for (const j of jugadas) {
      const t = porTicket.get(Number(j.ticket_id));
      if (t) t.jugadas.push(j);
    }

    const cambiosJugada = [];
    const cambiosTicket = [];

    for (const t of porTicket.values()) {
      let total = 0;
      let pendientes = 0;

      for (const j of t.jugadas) {
        const r1 = res.get(`${Number(j.loteria_id)}|${t.fecha_sorteo}`) || null;
        const r2 = j.loteria2_id ? res.get(`${Number(j.loteria2_id)}|${t.fecha_sorteo}`) || null : null;
        const falta = !r1 || (j.loteria2_id && !r2);

        if (falta) {
          pendientes++;
          if (j.estado !== 'pendiente' || Number(j.premio) !== 0) {
            cambiosJugada.push({ id: Number(j.id), estado: 'pendiente', premio: 0, detalle: '' });
          }
          continue;
        }

        const ev = evaluarJugada(j, r1, tablaDe(Number(j.loteria_id)), r2, { pagarRepetidos });
        const estado = ev.gana ? 'ganadora' : 'perdedora';
        const premio = money(ev.premio);
        if (j.estado !== estado || Number(j.premio) !== premio || j.detalle !== ev.detalle) {
          cambiosJugada.push({ id: Number(j.id), estado, premio, detalle: ev.detalle });
        }
        total += premio;
      }

      total = money(total);
      let estadoTicket;
      if (t.estado === 'pagado') estadoTicket = 'pagado';
      else if (pendientes > 0) estadoTicket = 'activo';
      else estadoTicket = total > 0 ? 'ganador' : 'perdedor';

      cambiosTicket.push({ id: Number(t.id), estado: estadoTicket, premio: total });
      tocados++;
      if (estadoTicket === 'ganador') { ganadores++; premiosTotal += total; }
    }

    await tx(async (tr) => {
      await escribirJugadas(tr, cambiosJugada);
      await escribirTickets(tr, cambiosTicket);
    });
  }

  return { tickets: tocados, ganadores, premios: money(premiosTotal) };
}

/** UPDATE masivo de jugadas con una sola sentencia por tanda. */
async function escribirJugadas(tr, cambios) {
  for (let i = 0; i < cambios.length; i += LOTE) {
    const tanda = cambios.slice(i, i + LOTE);
    const tuplas = tanda.map((_, k) =>
      k === 0 ? '(?::bigint, ?::text, ?::numeric, ?::text)' : '(?, ?, ?, ?)'
    ).join(',');
    const params = tanda.flatMap((c) => [c.id, c.estado, c.premio, c.detalle]);
    await tr.correr(
      `UPDATE jugadas j
          SET estado = v.estado, premio = v.premio, detalle = v.detalle
         FROM (VALUES ${tuplas}) AS v(id, estado, premio, detalle)
        WHERE j.id = v.id`,
      params
    );
  }
}

/** UPDATE masivo de tickets. No pisa los ya pagados ni los cancelados. */
async function escribirTickets(tr, cambios) {
  for (let i = 0; i < cambios.length; i += LOTE) {
    const tanda = cambios.slice(i, i + LOTE);
    const tuplas = tanda.map((_, k) =>
      k === 0 ? '(?::bigint, ?::text, ?::numeric)' : '(?, ?, ?)'
    ).join(',');
    const params = tanda.flatMap((c) => [c.id, c.estado, c.premio]);
    await tr.correr(
      `UPDATE tickets t
          SET estado = v.estado, premio_total = v.premio, evaluado_en = now()
         FROM (VALUES ${tuplas}) AS v(id, estado, premio)
        WHERE t.id = v.id AND t.estado <> 'cancelado'`,
      params
    );
  }
}

/** Reevalua todo lo que dependa de (loteria, fecha). */
async function evaluarSorteo(loteriaId, fecha) {
  const filas = await q.todos(
    `SELECT DISTINCT t.id
       FROM tickets t
       JOIN jugadas j ON j.ticket_id = t.id
      WHERE t.fecha_sorteo = ?::date
        AND t.estado <> 'cancelado'
        AND (j.loteria_id = ? OR j.loteria2_id = ?)`,
    [fecha, loteriaId, loteriaId]
  );
  return recalcularTickets(filas.map((r) => Number(r.id)));
}

/** Reevalua todos los tickets de una fecha (util tras cambiar multiplicadores). */
async function evaluarFecha(fecha) {
  const filas = await q.todos(
    `SELECT id FROM tickets WHERE fecha_sorteo = ?::date AND estado <> 'cancelado'`,
    [fecha]
  );
  return recalcularTickets(filas.map((r) => Number(r.id)));
}

// ---------------------------------------------------------------
async function guardarResultado(usuario, datos, ip = '') {
  const loteriaId = Number(datos.loteria_id);
  const fecha = datos.fecha;
  if (!F.esFecha(fecha)) throw new HttpError(400, 'Fecha invalida.');
  if (fecha > F.hoy()) throw new HttpError(400, 'No se pueden cargar resultados de fechas futuras.');

  const lot = await q.uno('SELECT * FROM loterias WHERE id = ?', [loteriaId]);
  if (!lot) throw new HttpError(404, 'Loteria no encontrada.');

  const dias = String(lot.dias).split(',').map(Number);
  if (!dias.includes(F.diaSemana(fecha))) {
    throw new HttpError(400, `${lot.nombre} no juega los ${F.NOMBRE_DIA[F.diaSemana(fecha)]}.`);
  }

  const nums = ['primera', 'segunda', 'tercera'].map((k) => {
    const n = normNumero(datos[k]);
    if (n === null) throw new HttpError(400, `El numero de la ${k} posicion es invalido (use 00-99).`);
    return n;
  });

  const previo = await obtenerResultado(loteriaId, fecha);

  await q.correr(
    `INSERT INTO resultados (loteria_id, fecha, primera, segunda, tercera, creado_por)
     VALUES (?, ?::date, ?, ?, ?, ?)
     ON CONFLICT (loteria_id, fecha) DO UPDATE SET
       primera = excluded.primera, segunda = excluded.segunda, tercera = excluded.tercera,
       creado_en = now(), creado_por = excluded.creado_por`,
    [loteriaId, fecha, nums[0], nums[1], nums[2], usuario.id]
  );

  const resumen = await evaluarSorteo(loteriaId, fecha);

  await auditar({
    usuario_id: usuario.id, usuario: usuario.usuario,
    accion: previo ? 'resultado_corregido' : 'resultado_registrado',
    entidad: 'resultado', entidad_id: `${lot.codigo}/${fecha}`,
    detalle: `${nums.join('-')}${previo ? ` (antes ${previo.primera}-${previo.segunda}-${previo.tercera})` : ''}` +
             ` | tickets ${resumen.tickets}, ganadores ${resumen.ganadores}, premios ${resumen.premios}`,
    ip,
  });

  return { resultado: await obtenerResultado(loteriaId, fecha), loteria: lot.nombre, resumen };
}

async function eliminarResultado(usuario, loteriaId, fecha, ip = '') {
  const r = await obtenerResultado(loteriaId, fecha);
  if (!r) throw new HttpError(404, 'No hay resultado para esa loteria y fecha.');

  const pagados = await q.valor(
    `SELECT COUNT(*) FROM tickets t
      WHERE t.fecha_sorteo = ?::date AND t.estado = 'pagado'
        AND EXISTS (SELECT 1 FROM jugadas j
                     WHERE j.ticket_id = t.id AND (j.loteria_id = ? OR j.loteria2_id = ?))`,
    [fecha, loteriaId, loteriaId]
  );
  if (Number(pagados) > 0) {
    throw new HttpError(409, `No se puede borrar: hay ${pagados} ticket(s) ya pagados con este sorteo.`);
  }

  await q.correr('DELETE FROM resultados WHERE loteria_id = ? AND fecha = ?::date', [loteriaId, fecha]);
  const resumen = await evaluarSorteo(loteriaId, fecha);

  await auditar({
    usuario_id: usuario.id, usuario: usuario.usuario, accion: 'resultado_eliminado',
    entidad: 'resultado', entidad_id: `${loteriaId}/${fecha}`,
    detalle: `${r.primera}-${r.segunda}-${r.tercera}`, ip,
  });
  return resumen;
}

/** Resultados de una fecha con el nombre de cada loteria. */
async function resultadosDe(fecha) {
  const filas = await q.todos(
    `SELECT l.id AS loteria_id, l.codigo, l.nombre, l.color, l.hora_cierre, l.dias, l.orden,
            r.primera, r.segunda, r.tercera, r.creado_en
       FROM loterias l
       LEFT JOIN resultados r ON r.loteria_id = l.id AND r.fecha = ?::date
      WHERE l.activo
      ORDER BY l.orden, l.nombre`,
    [fecha]
  );
  return filas.map((r) => ({
    ...r,
    loteria_id: Number(r.loteria_id),
    hora_cierre: String(r.hora_cierre).slice(0, 5),
    juega: String(r.dias).split(',').map(Number).includes(F.diaSemana(fecha)),
    cargado: r.primera != null,
  }));
}

module.exports = {
  obtenerResultado, resultadosDe, guardarResultado, eliminarResultado,
  evaluarSorteo, evaluarFecha, recalcularTickets,
};
