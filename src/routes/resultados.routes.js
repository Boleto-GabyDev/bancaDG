'use strict';

const express = require('express');
const A = require('../lib/auth');
const { ah } = require('../lib/http');
const D = require('../domain/draws');
const F = require('../lib/dates');

const router = express.Router();
router.use(A.requiereAuth);

/** Resultados de una fecha (todas las loterias activas). */
router.get('/', ah(async (req, res) => {
  const fecha = F.esFecha(req.query.fecha) ? req.query.fecha : F.hoy();
  res.json({
    fecha,
    dia: F.NOMBRE_DIA[F.diaSemana(fecha)],
    resultados: await D.resultadosDe(fecha),
  });
}));

/** Registrar o corregir un resultado. Dispara la evaluacion automatica. */
router.post('/', A.requiereRol('admin', 'banca'), ah(async (req, res) => {
  const r = await D.guardarResultado(req.usuario, req.body || {}, A.ipDe(req));
  res.json({ ok: true, ...r });
}));

/** Carga de varios resultados de una vez. */
router.post('/lote', A.requiereRol('admin', 'banca'), ah(async (req, res) => {
  const lista = Array.isArray(req.body.resultados) ? req.body.resultados : [];
  const fecha = req.body.fecha;
  const salida = [];
  for (const item of lista) {
    try {
      salida.push({ ok: true, ...await D.guardarResultado(req.usuario, { ...item, fecha }, A.ipDe(req)) });
    } catch (e) {
      salida.push({ ok: false, loteria_id: item.loteria_id, error: e.message });
    }
  }
  res.json({ ok: salida.every((s) => s.ok), resultados: salida });
}));

/** Eliminar un resultado (solo admin, y si no hay tickets pagados). */
router.delete('/', A.requiereRol('admin'), ah(async (req, res) => {
  const loteriaId = Number(req.query.loteria_id || req.body?.loteria_id);
  const fecha = req.query.fecha || req.body?.fecha;
  const resumen = await D.eliminarResultado(req.usuario, loteriaId, fecha, A.ipDe(req));
  res.json({ ok: true, resumen });
}));

/** Reevaluar toda una fecha (tras cambiar premios o corregir datos). */
router.post('/reevaluar', A.requiereRol('admin'), ah(async (req, res) => {
  const fecha = F.esFecha(req.body.fecha) ? req.body.fecha : F.hoy();
  res.json({ ok: true, fecha, resumen: await D.evaluarFecha(fecha) });
}));

module.exports = router;
