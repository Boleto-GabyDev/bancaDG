'use strict';

const express = require('express');
const A = require('../lib/auth');
const { ah } = require('../lib/http');
const R = require('../domain/reports');

const router = express.Router();
router.use(A.requiereAuth);

/**
 * El cajero no entra a los reportes de gestion. Lo unico que ve de numeros
 * es lo suyo del dia: /resumen y GET /cierre ya vienen filtrados por su
 * usuario desde domain/reports.js, asi que no hace falta nada mas.
 */
const gestion = A.requiereRol('admin', 'banca');

router.get('/resumen',    ah(async (req, res) => res.json(await R.resumen(req.usuario, req.query))));
router.get('/dia',        gestion, ah(async (req, res) => res.json({ filas: await R.porDia(req.usuario, req.query) })));
router.get('/loteria',    gestion, ah(async (req, res) => res.json({ filas: await R.porLoteria(req.usuario, req.query) })));
router.get('/tipo',       gestion, ah(async (req, res) => res.json({ filas: await R.porTipo(req.usuario, req.query) })));
router.get('/cobro',      gestion, ah(async (req, res) => res.json({ filas: await R.porMetodoPago(req.usuario, req.query) })));
router.get('/vendedor',   gestion, ah(async (req, res) => res.json({ filas: await R.porVendedor(req.usuario, req.query) })));
router.get('/banca',      gestion, ah(async (req, res) => res.json({ filas: await R.porBanca(req.usuario, req.query) })));
router.get('/riesgo',     gestion, ah(async (req, res) => res.json({ filas: await R.riesgo(req.usuario, req.query) })));
router.get('/pendientes', gestion, ah(async (req, res) => res.json({ filas: await R.premiosPendientes(req.usuario, req.query) })));

/** Panel completo en una sola llamada (lo que usa el tablero). */
router.get('/panel', gestion, ah(async (req, res) => {
  const [resumen, dia, loteria, tipo, cobro, vendedor, banca] = await Promise.all([
    R.resumen(req.usuario, req.query),
    R.porDia(req.usuario, req.query),
    R.porLoteria(req.usuario, req.query),
    R.porTipo(req.usuario, req.query),
    R.porMetodoPago(req.usuario, req.query),
    R.porVendedor(req.usuario, req.query),
    req.usuario.rol === 'admin' ? R.porBanca(req.usuario, req.query) : [],
  ]);
  res.json({ resumen, dia: dia.slice(0, 14), loteria, tipo, cobro, vendedor, banca });
}));

/** Cuadre del dia. El cajero solo puede pedir el suyo (lo fuerza cierreCaja). */
router.get('/cierre', ah(async (req, res) => {
  const c = await R.cierreCaja(req.usuario, req.query);
  if (!c) return res.status(404).json({ error: 'Vendedor no encontrado o fuera de su alcance.' });
  res.json(c);
}));

/** Registrar el cierre es acto de caja: lo firma la banca, no el cajero. */
router.post('/cierre', gestion, ah(async (req, res) => {
  const c = await R.guardarCierre(req.usuario, req.body || {});
  if (!c) return res.status(404).json({ error: 'Vendedor no encontrado o fuera de su alcance.' });
  res.json({ ok: true, cierre: c });
}));

module.exports = router;
