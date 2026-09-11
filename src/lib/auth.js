'use strict';

const crypto = require('crypto');
const { q } = require('../db');
const { SESSION_COOKIE, SESSION_HORAS, PRODUCCION } = require('../config');

// ---------------------------------------------------------------
// Contrasenas: scrypt (incluido en Node, sin dependencias nativas)
// ---------------------------------------------------------------
function hashPassword(plain, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return { hash, salt };
}

function verificarPassword(plain, hash, salt) {
  if (!hash || !salt) return false;
  let calc;
  try {
    calc = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Genera una clave aleatoria legible para altas y reinicios. */
function claveAleatoria(largo = 12) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < largo; i++) s += abc[crypto.randomInt(0, abc.length)];
  return s;
}

// ---------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------
async function crearSesion(usuarioId, ip = '', agente = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + SESSION_HORAS * 3600 * 1000);
  await q.correr(
    `INSERT INTO sesiones (token, usuario_id, expira_en, ip, agente) VALUES (?, ?, ?, ?, ?)`,
    [token, usuarioId, expira, ip, String(agente).slice(0, 200)]
  );
  return token;
}

/**
 * Usuario de una sesion vigente. La caducidad la decide Postgres con now(),
 * no el reloj de la aplicacion: en serverless cada instancia puede tener una
 * hora ligeramente distinta.
 */
async function usuarioDeSesion(token) {
  if (!token) return null;
  return q.uno(
    `SELECT u.id, u.usuario, u.nombre, u.rol, u.banca_id, u.comision_pct, u.activo,
            b.nombre AS banca_nombre, b.codigo AS banca_codigo,
            s.expira_en, s.token
       FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
       LEFT JOIN bancas b ON b.id = u.banca_id
      WHERE s.token = ?
        AND s.expira_en > now()
        AND u.activo`,
    [token]
  );
}

async function cerrarSesion(token) {
  if (token) await q.correr('DELETE FROM sesiones WHERE token = ?', [token]);
}

async function limpiarSesiones() {
  const r = await q.correr('DELETE FROM sesiones WHERE expira_en <= now()');
  return r.filas;
}

// ---------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------
function leerToken(req) {
  const cookie = req.headers.cookie || '';
  for (const parte of cookie.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
  }
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function cargarUsuario(req, _res, next) {
  try {
    req.token = leerToken(req);
    req.usuario = await usuarioDeSesion(req.token);
    next();
  } catch (e) {
    next(e);
  }
}

function requiereAuth(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'Sesion no valida. Inicie sesion de nuevo.' });
  next();
}

function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Sesion no valida.' });
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tiene permiso para esta operacion.' });
    }
    next();
  };
}

/** Opciones de la cookie de sesion. En produccion solo viaja por HTTPS. */
function opcionesCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: PRODUCCION,
    path: '/',
    maxAge: SESSION_HORAS * 3600 * 1000,
  };
}

/** IP del cliente, util para auditoria. */
function ipDe(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

module.exports = {
  hashPassword, verificarPassword, claveAleatoria,
  crearSesion, usuarioDeSesion, cerrarSesion, limpiarSesiones,
  leerToken, cargarUsuario, requiereAuth, requiereRol, ipDe, opcionesCookie,
};
