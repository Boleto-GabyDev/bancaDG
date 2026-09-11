'use strict';

const express = require('express');
const { q } = require('../db');
const A = require('../lib/auth');
const { ah } = require('../lib/http');
const V = require('../domain/sales');
const { LISTA_TIPOS } = require('../domain/plays');
const { limiteDe, vendidoDe } = require('../domain/limits');
const F = require('../lib/dates');

const router = express.Router();
router.use(A.requiereAuth);

/** Loterias con estado de apertura, premios y tipos permitidos. */
router.get('/loterias', ah(async (req, res) => {
  const fecha = F.esFecha(req.query.fecha) ? req.query.fecha : F.hoy();
  res.json({
    fecha,
    dia: F.NOMBRE_DIA[F.diaSemana(fecha)],
    loterias: await V.loteriasConEstado(fecha, req.query.todas !== '1'),
    tipos: LISTA_TIPOS.map((t) => ({ clave: t.clave, nombre: t.nombre, cantidad: t.cantidad })),
  });
}));

/** Disponible de un numero: cuanto queda antes de topar. */
router.get('/disponible', ah(async (req, res) => {
  const fecha = F.esFecha(req.query.fecha) ? req.query.fecha : F.hoy();
  const loteriaId = Number(req.query.loteria_id);
  const tipo = String(req.query.tipo || 'quiniela');
  const numeros = String(req.query.numeros || '');
  const loteria2 = Number(req.query.loteria2_id || 0);

  const tope = await limiteDe(loteriaId, tipo, numeros);
  const vendido = await vendidoDe(fecha, loteriaId, loteria2, tipo, numeros);
  res.json({
    tope, vendido,
    disponible: tope > 0 ? Math.max(0, tope - vendido) : null,
    sin_tope: tope <= 0,
  });
}));

/** Bancas visibles para el usuario (para filtros de reportes). */
router.get('/bancas', ah(async (req, res) => {
  const bancas = req.usuario.rol === 'admin'
    ? await q.todos('SELECT id, codigo, nombre, activo FROM bancas ORDER BY codigo')
    : await q.todos('SELECT id, codigo, nombre, activo FROM bancas WHERE id = ?', [req.usuario.banca_id]);
  res.json({ bancas: bancas.map((b) => ({ ...b, id: Number(b.id) })) });
}));

/** Vendedores visibles para el usuario. */
router.get('/vendedores', ah(async (req, res) => {
  let filas;
  if (req.usuario.rol === 'admin') {
    filas = await q.todos(
      `SELECT u.id, u.usuario, u.nombre, u.rol, u.comision_pct, u.activo, b.nombre AS banca
         FROM usuarios u LEFT JOIN bancas b ON b.id = u.banca_id
        WHERE u.activo ORDER BY u.nombre`
    );
  } else if (req.usuario.rol === 'banca') {
    filas = await q.todos(
      `SELECT u.id, u.usuario, u.nombre, u.rol, u.comision_pct, u.activo, b.nombre AS banca
         FROM usuarios u LEFT JOIN bancas b ON b.id = u.banca_id
        WHERE u.banca_id = ? AND u.activo ORDER BY u.nombre`,
      [req.usuario.banca_id]
    );
  } else {
    filas = await q.todos(
      `SELECT id, usuario, nombre, rol, comision_pct, activo, '' AS banca
         FROM usuarios WHERE id = ?`,
      [req.usuario.id]
    );
  }
  res.json({ vendedores: filas.map((v) => ({ ...v, id: Number(v.id), comision_pct: Number(v.comision_pct) || 0 })) });
}));

module.exports = router;
