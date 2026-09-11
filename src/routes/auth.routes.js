'use strict';

const express = require('express');
const { q, auditar, getSetting } = require('../db');
const A = require('../lib/auth');
const { ah, HttpError, texto } = require('../lib/http');
const { SESSION_COOKIE } = require('../config');
const F = require('../lib/dates');

const router = express.Router();

// Control de fuerza bruta: 8 intentos fallidos por usuario+IP en 5 minutos.
// Vive en memoria: en serverless cada instancia lleva su propia cuenta, asi
// que es una molestia para el atacante, no una barrera infranqueable. La
// barrera de verdad son las claves largas y el hash con scrypt.
const intentos = new Map();
const VENTANA_MS = 5 * 60 * 1000;
const MAX_INTENTOS = 8;

function recientes(clave) {
  const ahora = Date.now();
  const lista = (intentos.get(clave) || []).filter((t) => ahora - t < VENTANA_MS);
  if (lista.length) intentos.set(clave, lista); else intentos.delete(clave);
  return lista;
}

function registrarIntento(clave) {
  const lista = recientes(clave);
  lista.push(Date.now());
  intentos.set(clave, lista);
}

const bloqueado = (clave) => recientes(clave).length >= MAX_INTENTOS;

// Evita que el Map crezca sin limite si el proceso vive mucho.
setInterval(() => {
  for (const clave of intentos.keys()) recientes(clave);
}, VENTANA_MS).unref?.();

router.post('/login', ah(async (req, res) => {
  const usuario = texto(req.body.usuario, { campo: 'Usuario', max: 40 });
  const clave = String(req.body.clave ?? '');
  const ip = A.ipDe(req);
  const llave = `${usuario.toLowerCase()}|${ip}`;

  if (bloqueado(llave)) {
    throw new HttpError(429, 'Demasiados intentos fallidos. Espere 5 minutos.');
  }

  const u = await q.uno('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
  if (!u || !u.activo || !A.verificarPassword(clave, u.password_hash, u.password_salt)) {
    registrarIntento(llave);
    await auditar({ usuario, accion: 'login_fallido', ip });
    throw new HttpError(401, 'Usuario o clave incorrectos.');
  }

  intentos.delete(llave);
  const token = await A.crearSesion(u.id, ip, req.headers['user-agent'] || '');
  await q.correr('UPDATE usuarios SET ultimo_acceso = now() WHERE id = ?', [u.id]);
  await auditar({ usuario_id: u.id, usuario: u.usuario, accion: 'login', ip });

  res.cookie(SESSION_COOKIE, token, A.opcionesCookie());

  const datos = await A.usuarioDeSesion(token);
  res.json({ ok: true, usuario: perfil(datos), token });
}));

router.post('/logout', ah(async (req, res) => {
  if (req.usuario) {
    await auditar({ usuario_id: req.usuario.id, usuario: req.usuario.usuario, accion: 'logout', ip: A.ipDe(req) });
  }
  await A.cerrarSesion(req.token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
}));

router.get('/yo', ah(async (req, res) => {
  if (!req.usuario) return res.status(401).json({ error: 'Sin sesion' });
  res.json({ usuario: perfil(req.usuario), config: await configPublica() });
}));

router.post('/cambiar-clave', A.requiereAuth, ah(async (req, res) => {
  const actual = String(req.body.actual ?? '');
  const nueva = texto(req.body.nueva, { campo: 'La nueva clave', min: 8, max: 64 });

  if (nueva === actual) throw new HttpError(400, 'La clave nueva debe ser distinta de la actual.');

  const u = await q.uno('SELECT * FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (!A.verificarPassword(actual, u.password_hash, u.password_salt)) {
    throw new HttpError(400, 'La clave actual no es correcta.');
  }

  const { hash, salt } = A.hashPassword(nueva);
  await q.correr('UPDATE usuarios SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, u.id]);
  // Cerrar las demas sesiones de ese usuario; la actual se mantiene.
  await q.correr('DELETE FROM sesiones WHERE usuario_id = ? AND token <> ?', [u.id, req.token]);

  await auditar({ usuario_id: u.id, usuario: u.usuario, accion: 'cambio_clave', ip: A.ipDe(req) });
  res.json({ ok: true });
}));

function perfil(u) {
  return {
    id: Number(u.id), usuario: u.usuario, nombre: u.nombre, rol: u.rol,
    banca_id: u.banca_id === null ? null : Number(u.banca_id),
    banca: u.banca_nombre, banca_codigo: u.banca_codigo,
    comision_pct: Number(u.comision_pct) || 0,
  };
}

async function configPublica() {
  return {
    empresa_nombre: await getSetting('empresa_nombre', 'Banca DG'),
    empresa_lema: await getSetting('empresa_lema', ''),
    moneda: await getSetting('moneda', 'RD$'),
    monto_minimo: await getSetting('monto_minimo', 5),
    monto_maximo: await getSetting('monto_maximo', 5000),
    max_jugadas_ticket: await getSetting('max_jugadas_ticket', 40),
    minutos_cancelacion: await getSetting('minutos_cancelacion', 10),
    dias_validez_premio: await getSetting('dias_validez_premio', 30),
    hoy: F.hoy(),
  };
}

module.exports = { router, perfil, configPublica };
