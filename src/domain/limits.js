'use strict';

/**
 * Topes (limites) de venta por numero.
 *
 * Un tope es el monto maximo que la banca acepta vender de un mismo numero,
 * por loteria, por tipo de jugada y por fecha de sorteo. Es el control de
 * riesgo basico: sin el, un solo numero muy jugado revienta la banca.
 *
 * Resolucion en cascada (el primero que exista gana):
 *   1. loteria + tipo + numero exacto
 *   2. global  + tipo + numero exacto
 *   3. loteria + tipo + '*'  (tope por defecto del tipo en esa loteria)
 *   4. global  + tipo + '*'
 *   5. sin tope (0)
 */

const { q } = require('../db');

async function limiteDe(loteriaId, tipo, numeros) {
  const fila = await q.uno(
    `SELECT monto_max FROM limites
      WHERE tipo = @tipo
        AND ( (loteria_id = @lid AND numero = @num)
           OR (loteria_id IS NULL AND numero = @num)
           OR (loteria_id = @lid AND numero IS NULL)
           OR (loteria_id IS NULL AND numero IS NULL) )
      ORDER BY
        CASE
          WHEN loteria_id IS NOT NULL AND numero IS NOT NULL THEN 1
          WHEN loteria_id IS NULL     AND numero IS NOT NULL THEN 2
          WHEN loteria_id IS NOT NULL AND numero IS NULL     THEN 3
          ELSE 4
        END
      LIMIT 1`,
    { tipo, lid: loteriaId, num: numeros }
  );
  return fila ? Number(fila.monto_max) || 0 : 0;
}

/** Monto ya vendido de ese numero en esa fecha (ignora tickets cancelados). */
async function vendidoDe(fecha, loteriaId, loteria2Id, tipo, numeros) {
  const total = await q.valor(
    `SELECT COALESCE(SUM(j.monto), 0) AS total
       FROM jugadas j
       JOIN tickets t ON t.id = j.ticket_id
      WHERE t.fecha_sorteo = @fecha::date
        AND t.estado <> 'cancelado'
        AND j.estado <> 'cancelada'
        AND j.loteria_id = @lid
        AND COALESCE(j.loteria2_id, 0) = @lid2
        AND j.tipo = @tipo
        AND j.numeros = @num`,
    { fecha, lid: loteriaId, lid2: loteria2Id || 0, tipo, num: numeros }
  );
  return Number(total) || 0;
}

/**
 * Verifica un lote de jugadas nuevas contra los topes, acumulando tambien
 * lo que el propio lote agrega (para que no se cuele en una sola venta).
 *
 * @param fecha  'YYYY-MM-DD'
 * @param items  [{loteria_id, loteria2_id, tipo, numeros, monto, loteria_nombre}]
 * @returns {{ok:boolean, errores:string[]}}
 */
async function verificarLote(fecha, items) {
  const acumulado = new Map();
  const errores = [];

  for (const it of items) {
    const clave = `${it.loteria_id}|${it.loteria2_id || 0}|${it.tipo}|${it.numeros}`;
    const tope = await limiteDe(it.loteria_id, it.tipo, it.numeros);
    if (tope <= 0) continue;

    if (!acumulado.has(clave)) {
      acumulado.set(clave, await vendidoDe(fecha, it.loteria_id, it.loteria2_id, it.tipo, it.numeros));
    }
    const previo = acumulado.get(clave);
    const nuevo = previo + Number(it.monto);
    if (nuevo > tope + 1e-9) {
      const disponible = Math.max(0, tope - previo);
      errores.push(
        `Tope alcanzado: ${it.numeros} (${it.tipo}) en ${it.loteria_nombre || 'loteria ' + it.loteria_id}. ` +
        `Maximo ${tope.toFixed(2)}, vendido ${previo.toFixed(2)}, disponible ${disponible.toFixed(2)}.`
      );
    }
    acumulado.set(clave, nuevo);
  }
  return { ok: errores.length === 0, errores };
}

/**
 * Exposicion: cuanto se vendio de cada numero y cuanto se pagaria si sale.
 * Sirve para el reporte de riesgo del dia.
 */
async function exposicion(fecha, loteriaId = null, tipo = 'quiniela') {
  return q.todos(
    `SELECT j.loteria_id, l.nombre AS loteria, j.tipo, j.numeros,
            SUM(j.monto) AS vendido, COUNT(*) AS jugadas
       FROM jugadas j
       JOIN tickets t  ON t.id = j.ticket_id
       JOIN loterias l ON l.id = j.loteria_id
      WHERE t.fecha_sorteo = @fecha::date
        AND t.estado <> 'cancelado'
        AND j.estado <> 'cancelada'
        AND j.tipo = @tipo
        AND (@lid::bigint IS NULL OR j.loteria_id = @lid::bigint)
      GROUP BY j.loteria_id, l.nombre, j.tipo, j.numeros
      ORDER BY vendido DESC`,
    { fecha, tipo, lid: loteriaId }
  );
}

module.exports = { limiteDe, vendidoDe, verificarLote, exposicion };
