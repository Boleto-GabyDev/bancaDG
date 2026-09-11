'use strict';

/** Envoltorio para handlers async: cualquier error va al manejador central. */
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Error con codigo HTTP. */
class HttpError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

const bad = (msg) => { throw new HttpError(400, msg); };
const noEncontrado = (msg = 'No encontrado') => { throw new HttpError(404, msg); };
const prohibido = (msg = 'No autorizado') => { throw new HttpError(403, msg); };

// ---------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------
function texto(v, { campo = 'campo', min = 0, max = 255, requerido = true } = {}) {
  const s = String(v ?? '').trim();
  if (!s && requerido) bad(`${campo} es obligatorio`);
  if (s.length < min) bad(`${campo} debe tener al menos ${min} caracteres`);
  if (s.length > max) bad(`${campo} no puede exceder ${max} caracteres`);
  return s;
}

function numero(v, { campo = 'campo', min = -Infinity, max = Infinity, entero = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) bad(`${campo} debe ser numerico`);
  if (entero && !Number.isInteger(n)) bad(`${campo} debe ser un entero`);
  if (n < min) bad(`${campo} no puede ser menor que ${min}`);
  if (n > max) bad(`${campo} no puede ser mayor que ${max}`);
  return n;
}

function booleano(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

function unoDe(v, opciones, campo = 'campo') {
  const s = String(v ?? '');
  if (!opciones.includes(s)) bad(`${campo} debe ser uno de: ${opciones.join(', ')}`);
  return s;
}

/** Redondeo a 2 decimales para dinero. */
function money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Alcance de datos segun el rol:
 *   admin    -> todo
 *   banca    -> solo su banca
 *   vendedor -> solo sus propios tickets
 * Devuelve fragmento SQL y parametros para anexar a un WHERE.
 */
function alcance(usuario, { aliasTicket = 't' } = {}) {
  if (usuario.rol === 'admin') return { sql: '', params: [] };
  if (usuario.rol === 'banca') return { sql: ` AND ${aliasTicket}.banca_id = ?`, params: [usuario.banca_id] };
  return { sql: ` AND ${aliasTicket}.usuario_id = ?`, params: [usuario.id] };
}

module.exports = { ah, HttpError, bad, noEncontrado, prohibido, texto, numero, booleano, unoDe, money, alcance };
