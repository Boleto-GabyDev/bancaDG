'use strict';

/**
 * Venta: apertura de sorteos, armado del ticket, cancelacion y cobro.
 */

const crypto = require('crypto');
const { q, tx, getSetting, auditar } = require('../db');
const { HttpError, money } = require('../lib/http');
const F = require('../lib/dates');
const { TIPOS, normalizarJugada } = require('./plays');
const { tablasDeTodas } = require('./prizes');
const { verificarLote } = require('./limits');

const METODOS_PAGO = ['efectivo', 'transferencia'];

// ---------------------------------------------------------------
// Apertura / cierre de sorteos
// ---------------------------------------------------------------

/**
 * ¿Se pueden recibir jugadas de esta loteria para esa fecha?
 * Funcion pura: `yaHayResultado` lo resuelve quien llama, de una sola
 * consulta para todas las loterias.
 *
 * @returns {{abierto:boolean, motivo:string, cierre:string, faltan:number|null}}
 */
function estadoSorteo(loteria, fecha, yaHayResultado = false, ahora = new Date()) {
  const horaCierre = String(loteria.hora_cierre).slice(0, 5);
  const cierreMin = F.aMinutos(horaCierre) - (Number(loteria.minutos_previos) || 0);
  const cierre = F.aHHMM(cierreMin);

  if (!loteria.activo) return { abierto: false, motivo: 'Loteria desactivada', cierre, faltan: null };

  const dias = String(loteria.dias).split(',').map((d) => Number(d.trim()));
  if (!dias.includes(F.diaSemana(fecha))) {
    return { abierto: false, motivo: `No juega los ${F.NOMBRE_DIA[F.diaSemana(fecha)]}`, cierre, faltan: null };
  }

  const hoy = F.hoy(ahora);
  if (fecha < hoy) return { abierto: false, motivo: 'Fecha pasada', cierre, faltan: null };
  if (yaHayResultado) return { abierto: false, motivo: 'Sorteo ya publicado', cierre, faltan: null };
  if (fecha > hoy) return { abierto: true, motivo: 'Venta anticipada', cierre, faltan: null };

  const actual = F.minutosDelDia(ahora);
  const faltan = cierreMin - actual;
  if (faltan <= 0) return { abierto: false, motivo: `Cerrada a las ${cierre}`, cierre, faltan: 0 };
  return { abierto: true, motivo: '', cierre, faltan };
}

/** Ids de loterias que ya tienen resultado publicado en esa fecha. */
async function loteriasConResultado(fecha) {
  const filas = await q.todos('SELECT loteria_id FROM resultados WHERE fecha = ?::date', [fecha]);
  return new Set(filas.map((f) => Number(f.loteria_id)));
}

/** Loterias con su estado de apertura para una fecha. */
async function loteriasConEstado(fecha, soloActivas = true) {
  const filas = await q.todos(
    `SELECT * FROM loterias ${soloActivas ? 'WHERE activo' : ''} ORDER BY orden, nombre`
  );
  const publicadas = await loteriasConResultado(fecha);
  const tablaDe = await tablasDeTodas();

  return filas.map((l) => ({
    id: Number(l.id),
    codigo: l.codigo,
    nombre: l.nombre,
    color: l.color,
    pais: l.pais,
    hora_cierre: String(l.hora_cierre).slice(0, 5),
    minutos_previos: l.minutos_previos,
    dias: l.dias,
    orden: l.orden,
    activo: !!l.activo,
    tipos: {
      quiniela: !!l.q_quiniela, pale: !!l.q_pale,
      tripleta: !!l.q_tripleta, superpale: !!l.q_superpale,
    },
    estado: estadoSorteo(l, fecha, publicadas.has(Number(l.id))),
    premios: tablaDe(Number(l.id)),
  }));
}

// ---------------------------------------------------------------
// Creacion del ticket
// ---------------------------------------------------------------

function nuevoPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

/**
 * Crea (factura) un ticket con sus jugadas.
 *
 * @param usuario  usuario de la sesion
 * @param datos    {fecha, cliente, metodo_pago, referencia_pago,
 *                  jugadas:[{numeros, tipo, monto, loterias:[id], loteria2_id}]}
 *
 * Cada renglon puede aplicarse a varias loterias a la vez (lo normal en una
 * banca: "45 por 20 pesos en Nacional y Leidsa"), lo que genera una jugada
 * por loteria.
 */
async function crearTicket(usuario, datos, ip = '') {
  const fecha = datos.fecha && F.esFecha(datos.fecha) ? datos.fecha : F.hoy();
  const cliente = String(datos.cliente || '').trim().slice(0, 60);
  const renglones = Array.isArray(datos.jugadas) ? datos.jugadas : [];

  if (!renglones.length) throw new HttpError(400, 'El ticket no tiene jugadas.');

  const metodoPago = METODOS_PAGO.includes(datos.metodo_pago) ? datos.metodo_pago : 'efectivo';
  const referencia = String(datos.referencia_pago || '').trim().slice(0, 60);
  if (metodoPago === 'transferencia' && !referencia) {
    throw new HttpError(400, 'Una venta por transferencia necesita el numero de referencia.');
  }

  const montoMin = Number(await getSetting('monto_minimo', 5));
  const montoMax = Number(await getSetting('monto_maximo', 5000));
  const maxJugadas = Number(await getSetting('max_jugadas_ticket', 40));
  const permitirCerrada =
    (await getSetting('permitir_venta_cerrada', false)) === true && usuario.rol === 'admin';

  const filasLot = await q.todos('SELECT * FROM loterias');
  const loterias = new Map(filasLot.map((l) => [Number(l.id), l]));
  const publicadas = await loteriasConResultado(fecha);

  // --- Expandir renglones a jugadas concretas ---------------------
  const jugadas = [];
  for (const r of renglones) {
    const tipoPedido = r.tipo && TIPOS[r.tipo] ? r.tipo : null;
    const norm = normalizarJugada(r.numeros ?? r.entrada, tipoPedido);
    if (!norm.ok) throw new HttpError(400, norm.error);

    const monto = money(r.monto);
    if (!(monto > 0)) throw new HttpError(400, `Monto invalido en la jugada ${norm.numeros}.`);
    if (monto < montoMin) throw new HttpError(400, `El monto minimo por jugada es ${montoMin}.`);
    if (monto > montoMax) throw new HttpError(400, `El monto maximo por jugada es ${montoMax}.`);

    const ids = Array.isArray(r.loterias) && r.loterias.length
      ? r.loterias.map(Number)
      : (r.loteria_id ? [Number(r.loteria_id)] : []);
    if (!ids.length) throw new HttpError(400, `La jugada ${norm.numeros} no tiene loteria seleccionada.`);

    for (const lid of ids) {
      const lot = loterias.get(lid);
      if (!lot) throw new HttpError(400, `Loteria ${lid} no existe.`);

      let lot2 = null;
      if (norm.tipo === 'superpale') {
        const l2id = Number(r.loteria2_id || 0);
        lot2 = loterias.get(l2id);
        if (!lot2) throw new HttpError(400, 'El super pale requiere una segunda loteria.');
        if (Number(lot2.id) === Number(lot.id)) {
          throw new HttpError(400, 'El super pale requiere dos loterias distintas.');
        }
        if (!lot2.q_superpale) throw new HttpError(400, `${lot2.nombre} no acepta super pale.`);
      }

      if (!lot[TIPOS[norm.tipo].campoLoteria]) {
        throw new HttpError(400, `${lot.nombre} no acepta ${TIPOS[norm.tipo].nombre}.`);
      }

      for (const l of [lot, lot2].filter(Boolean)) {
        const est = estadoSorteo(l, fecha, publicadas.has(Number(l.id)));
        if (!est.abierto && !permitirCerrada) {
          throw new HttpError(409, `${l.nombre}: ${est.motivo || 'sorteo cerrado'}.`);
        }
      }

      jugadas.push({
        loteria_id: Number(lot.id),
        loteria2_id: lot2 ? Number(lot2.id) : null,
        loteria_nombre: lot.nombre,
        tipo: norm.tipo,
        numeros: norm.numeros,
        monto,
      });
    }
  }

  if (jugadas.length > maxJugadas) {
    throw new HttpError(400, `El ticket excede el maximo de ${maxJugadas} jugadas.`);
  }

  const total = money(jugadas.reduce((s, j) => s + j.monto, 0));

  // --- Topes por numero ------------------------------------------
  const chequeo = await verificarLote(fecha, jugadas);
  if (!chequeo.ok) throw new HttpError(409, chequeo.errores.join(' | '));

  // --- Persistir --------------------------------------------------
  const banca = await q.uno('SELECT * FROM bancas WHERE id = ?', [usuario.banca_id]);
  if (!banca) throw new HttpError(400, 'El usuario no tiene banca asignada.');
  if (!banca.activo) throw new HttpError(409, 'La banca esta desactivada.');

  const creado = await tx(async (t) => {
    const pin = nuevoPin();
    const fila = await t.uno(
      `INSERT INTO tickets (codigo, pin, banca_id, usuario_id, fecha_sorteo, total, cliente,
                            estado, metodo_pago, referencia_pago)
       VALUES ('', @pin, @banca, @usuario, @fecha::date, @total, @cliente,
               'activo', @metodo, @referencia)
       RETURNING id`,
      {
        pin, banca: banca.id, usuario: usuario.id, fecha, total, cliente,
        metodo: metodoPago, referencia,
      }
    );

    const id = Number(fila.id);
    const codigo = `${banca.codigo}-${String(id).padStart(7, '0')}`;
    await t.correr('UPDATE tickets SET codigo = ? WHERE id = ?', [codigo, id]);

    // Un solo INSERT con todas las jugadas: contra una base en red, insertar
    // de a una convertiria un ticket de 20 jugadas en 20 viajes.
    const tuplas = jugadas.map((_, k) =>
      k === 0 ? '(?::bigint, ?::bigint, ?::bigint, ?::text, ?::text, ?::numeric)' : '(?, ?, ?, ?, ?, ?)'
    ).join(',');
    await t.correr(
      `INSERT INTO jugadas (ticket_id, loteria_id, loteria2_id, tipo, numeros, monto)
       VALUES ${tuplas}`,
      jugadas.flatMap((j) => [id, j.loteria_id, j.loteria2_id, j.tipo, j.numeros, j.monto])
    );

    return { id, codigo, pin };
  });

  await auditar({
    usuario_id: usuario.id, usuario: usuario.usuario, accion: 'venta',
    entidad: 'ticket', entidad_id: creado.codigo,
    detalle: `${jugadas.length} jugada(s), total ${total}, ${metodoPago}${referencia ? ' ref ' + referencia : ''}`,
    ip,
  });

  return obtenerTicket(creado.id);
}

// ---------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------
async function obtenerTicket(idOcodigo) {
  const esNum = /^\d+$/.test(String(idOcodigo));
  const t = await q.uno(
    `SELECT t.*, b.nombre AS banca_nombre, b.codigo AS banca_codigo, b.direccion AS banca_direccion,
            b.telefono AS banca_telefono, b.rnc AS banca_rnc,
            u.nombre AS vendedor, u.usuario AS vendedor_usuario,
            EXTRACT(EPOCH FROM (now() - t.creado_en)) / 60 AS minutos_desde_venta
       FROM tickets t
       JOIN bancas b   ON b.id = t.banca_id
       JOIN usuarios u ON u.id = t.usuario_id
      WHERE ${esNum ? 't.id = ?' : 'UPPER(t.codigo) = UPPER(?)'}`,
    [idOcodigo]
  );
  if (!t) return null;

  t.id = Number(t.id);
  t.jugadas = await q.todos(
    `SELECT j.*, l.nombre AS loteria, l.codigo AS loteria_codigo, l.color AS loteria_color,
            l2.nombre AS loteria2, l2.codigo AS loteria2_codigo
       FROM jugadas j
       JOIN loterias l ON l.id = j.loteria_id
       LEFT JOIN loterias l2 ON l2.id = j.loteria2_id
      WHERE j.ticket_id = ?
      ORDER BY j.id`,
    [t.id]
  );

  t.resultados = await q.todos(
    `SELECT r.loteria_id, l.nombre AS loteria, r.primera, r.segunda, r.tercera
       FROM resultados r
       JOIN loterias l ON l.id = r.loteria_id
      WHERE r.fecha = @fecha::date
        AND r.loteria_id IN (
          SELECT loteria_id FROM jugadas WHERE ticket_id = @id
          UNION
          SELECT loteria2_id FROM jugadas WHERE ticket_id = @id AND loteria2_id IS NOT NULL)`,
    { id: t.id, fecha: t.fecha_sorteo }
  );

  return t;
}

// ---------------------------------------------------------------
// Cancelacion
// ---------------------------------------------------------------
async function cancelarTicket(usuario, idOcodigo, ip = '') {
  const t = await obtenerTicket(idOcodigo);
  if (!t) throw new HttpError(404, 'Ticket no encontrado.');
  if (t.estado === 'cancelado') throw new HttpError(409, 'El ticket ya estaba cancelado.');
  if (t.estado === 'pagado') throw new HttpError(409, 'No se puede cancelar un ticket ya pagado.');

  if (usuario.rol === 'vendedor' && Number(t.usuario_id) !== usuario.id) {
    throw new HttpError(403, 'Solo puede cancelar sus propios tickets.');
  }
  if (usuario.rol === 'banca' && Number(t.banca_id) !== usuario.banca_id) {
    throw new HttpError(403, 'El ticket pertenece a otra banca.');
  }

  // Ventana de cancelacion (el admin puede saltarla)
  const minutos = Number(await getSetting('minutos_cancelacion', 10));
  if (usuario.rol !== 'admin') {
    const transcurridos = Number(t.minutos_desde_venta) || 0;
    if (transcurridos > minutos) {
      throw new HttpError(409,
        `La ventana de cancelacion es de ${minutos} minutos (ya pasaron ${Math.floor(transcurridos)}).`);
    }
    // Tampoco se cancela si algun sorteo del ticket ya cerro.
    const publicadas = await loteriasConResultado(t.fecha_sorteo);
    for (const j of t.jugadas) {
      const lot = await q.uno('SELECT * FROM loterias WHERE id = ?', [j.loteria_id]);
      const est = estadoSorteo(lot, t.fecha_sorteo, publicadas.has(Number(j.loteria_id)));
      if (!est.abierto) throw new HttpError(409, `No se puede cancelar: ${lot.nombre} ya cerro.`);
    }
  }

  await tx(async (tr) => {
    await tr.correr(
      `UPDATE tickets SET estado = 'cancelado', cancelado_en = now(), cancelado_por = ?, premio_total = 0
        WHERE id = ?`,
      [usuario.id, t.id]
    );
    await tr.correr(`UPDATE jugadas SET estado = 'cancelada', premio = 0 WHERE ticket_id = ?`, [t.id]);
  });

  await auditar({
    usuario_id: usuario.id, usuario: usuario.usuario, accion: 'cancelacion',
    entidad: 'ticket', entidad_id: t.codigo, detalle: `total ${t.total}`, ip,
  });

  return obtenerTicket(t.id);
}

// ---------------------------------------------------------------
// Pago de premios
// ---------------------------------------------------------------
async function pagarTicket(usuario, idOcodigo, opciones = {}, ip = '') {
  const t = await obtenerTicket(idOcodigo);
  if (!t) throw new HttpError(404, 'Ticket no encontrado.');
  if (t.estado === 'cancelado') throw new HttpError(409, 'El ticket esta cancelado.');
  if (t.estado === 'pagado') throw new HttpError(409, `Ticket ya pagado el ${t.pagado_en}.`);
  if (t.estado !== 'ganador' || !(Number(t.premio_total) > 0)) {
    throw new HttpError(409, 'El ticket no tiene premio por pagar.');
  }
  if (usuario.rol === 'vendedor') {
    throw new HttpError(403, 'El pago de premios lo autoriza la banca.');
  }
  if (usuario.rol !== 'admin' && Number(t.banca_id) !== usuario.banca_id) {
    throw new HttpError(403, 'El ticket pertenece a otra banca.');
  }

  const metodo = METODOS_PAGO.includes(opciones.metodo_pago) ? opciones.metodo_pago : 'efectivo';
  const referencia = String(opciones.referencia_pago || '').trim().slice(0, 60);
  if (metodo === 'transferencia' && !referencia) {
    throw new HttpError(400, 'Un premio pagado por transferencia necesita el numero de referencia.');
  }

  const diasValidez = Number(await getSetting('dias_validez_premio', 30));
  const limite = F.sumarDias(t.fecha_sorteo, diasValidez);
  if (F.hoy() > limite) {
    throw new HttpError(409, `Ticket vencido. El plazo de cobro era hasta ${F.fechaHumana(limite)}.`);
  }

  // La condicion sobre `estado` evita que dos cajeros paguen el mismo ticket
  // a la vez: solo una de las dos actualizaciones encuentra la fila.
  const r = await q.correr(
    `UPDATE tickets
        SET estado = 'pagado', pagado_en = now(), pagado_por = ?,
            metodo_pago_premio = ?, referencia_pago_premio = ?
      WHERE id = ? AND estado = 'ganador'`,
    [usuario.id, metodo, referencia, t.id]
  );
  if (!r.filas) throw new HttpError(409, 'El ticket cambio de estado. Vuelva a consultarlo.');

  await auditar({
    usuario_id: usuario.id, usuario: usuario.usuario, accion: 'pago_premio',
    entidad: 'ticket', entidad_id: t.codigo,
    detalle: `premio ${t.premio_total} por ${metodo}${referencia ? ' ref ' + referencia : ''}`, ip,
  });

  return obtenerTicket(t.id);
}

module.exports = {
  METODOS_PAGO, estadoSorteo, loteriasConResultado, loteriasConEstado,
  crearTicket, obtenerTicket, cancelarTicket, pagarTicket,
};
