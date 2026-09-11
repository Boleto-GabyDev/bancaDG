'use strict';

const express = require('express');
const { getSetting } = require('../db');
const A = require('../lib/auth');
const { ah, HttpError } = require('../lib/http');
const V = require('../domain/sales');
const R = require('../domain/reports');
const F = require('../lib/dates');

const router = express.Router();
router.use(A.requiereAuth);

/** Verifica que el usuario pueda ver ese ticket. */
function puedeVer(usuario, t) {
  if (usuario.rol === 'admin') return true;
  // El cajero solo abre lo que el mismo vendio; los premios los paga la banca.
  if (usuario.rol === 'vendedor') return Number(t.usuario_id) === usuario.id;
  return Number(t.banca_id) === usuario.banca_id;
}

// --- Facturar ----------------------------------------------------
router.post('/', ah(async (req, res) => {
  const t = await V.crearTicket(req.usuario, req.body || {}, A.ipDe(req));
  res.status(201).json({ ok: true, ticket: t });
}));

// --- Listado -----------------------------------------------------
router.get('/', ah(async (req, res) => {
  res.json({ tickets: await R.tickets(req.usuario, req.query) });
}));

// --- Consulta por codigo o id -----------------------------------
router.get('/:codigo', ah(async (req, res) => {
  const t = await V.obtenerTicket(req.params.codigo);
  if (!t) throw new HttpError(404, 'Ticket no encontrado.');
  if (!puedeVer(req.usuario, t)) throw new HttpError(403, 'El ticket pertenece a otra banca.');
  res.json({ ticket: t });
}));

// --- Anular ------------------------------------------------------
router.post('/:codigo/cancelar', ah(async (req, res) => {
  const t = await V.cancelarTicket(req.usuario, req.params.codigo, A.ipDe(req));
  res.json({ ok: true, ticket: t });
}));

// --- Pagar premio ------------------------------------------------
// Entregar dinero por ventanilla lo autoriza la banca, no el cajero.
router.post('/:codigo/pagar', A.requiereRol('admin', 'banca'), ah(async (req, res) => {
  const t = await V.pagarTicket(req.usuario, req.params.codigo, req.body || {}, A.ipDe(req));
  res.json({ ok: true, ticket: t });
}));

// --- Chequeo rapido de premio (sin pagar) ------------------------
router.get('/:codigo/chequear', ah(async (req, res) => {
  const t = await V.obtenerTicket(req.params.codigo);
  if (!t) throw new HttpError(404, 'Ticket no encontrado.');
  if (!puedeVer(req.usuario, t)) throw new HttpError(403, 'El ticket pertenece a otra banca.');

  const faltan = t.jugadas.filter((j) => j.estado === 'pendiente').length;
  const vence = F.sumarDias(t.fecha_sorteo, Number(await getSetting('dias_validez_premio', 30)));
  res.json({
    ticket: t,
    resumen: {
      estado: t.estado,
      premio: Number(t.premio_total) || 0,
      jugadas_pendientes: faltan,
      ganadoras: t.jugadas.filter((j) => j.estado === 'ganadora').length,
      cobrable: t.estado === 'ganador' && Number(t.premio_total) > 0 && F.hoy() <= vence,
      vencido: F.hoy() > vence,
      vence,
    },
  });
}));

module.exports = router;
