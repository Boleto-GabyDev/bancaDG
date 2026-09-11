'use strict';

/**
 * Capa de acceso a datos sobre PostgreSQL (Supabase).
 *
 * La aplicacion nacio sobre SQLite sincrono. Para no reescribir 116 consultas
 * a mano (y arriesgar erratas) este modulo hace tres cosas:
 *
 *  1. Traduce los marcadores  ?  y  @nombre  a los  $1..$n  de Postgres,
 *     de modo que el SQL existente sigue siendo valido.
 *
 *  2. Normaliza los tipos que devuelve el driver para que la capa de negocio
 *     reciba lo mismo que recibia de SQLite:
 *        numeric   -> number   (por defecto pg devuelve string)
 *        bigint    -> number   (COUNT(*) devuelve string)
 *        date      -> 'YYYY-MM-DD'
 *        timestamp -> 'YYYY-MM-DD HH:MM:SS' en hora de Republica Dominicana
 *
 *  3. Expone transacciones que toman UNA sola conexion del pool, requisito
 *     del pooler de Supabase en modo transaccion.
 */

const { Pool, types } = require('pg');
const { traducir, valores } = require('./sql');
const { DATABASE_URL, DATABASE_PASSWORD, TZ } = require('../config');

// ---------------------------------------------------------------
// Normalizacion de tipos
// ---------------------------------------------------------------
const OID = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 };

types.setTypeParser(OID.INT8, (v) => (v === null ? null : Number(v)));
types.setTypeParser(OID.NUMERIC, (v) => (v === null ? null : Number(v)));
// Las fechas viajan como texto plano: el negocio trabaja con 'YYYY-MM-DD'.
types.setTypeParser(OID.DATE, (v) => v);

const fmtRD = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** timestamptz -> 'YYYY-MM-DD HH:MM:SS' en hora dominicana. */
function aHoraRD(valor) {
  if (valor === null || valor === undefined) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  const p = {};
  for (const { type, value } of fmtRD.formatToParts(d)) p[type] = value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

types.setTypeParser(OID.TIMESTAMPTZ, aHoraRD);
types.setTypeParser(OID.TIMESTAMP, (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : v));

// ---------------------------------------------------------------
// Pool de conexiones
// ---------------------------------------------------------------
/**
 * Error de instalacion, no de programacion: falta algo por configurar.
 * Se marca para que la capa HTTP lo muestre tal cual en vez de esconderlo
 * tras un "error interno"; es justo lo que necesita ver quien instala.
 */
function errorConfig(mensaje) {
  const e = new Error(mensaje);
  e.status = 503;
  e.configuracion = true;
  return e;
}

/**
 * La cadena se descompone a mano en vez de pasarsela entera al driver.
 * Asi la clave nunca depende de estar bien codificada dentro de una URL
 * (las de Supabase suelen traer simbolos), y los errores de configuracion
 * se detectan aqui con un mensaje claro en vez de fallar al conectar.
 */
function configDeConexion(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw errorConfig(`DATABASE_URL no es una cadena de conexion valida: "${url.slice(0, 30)}..."`);
  }

  const clave = DATABASE_PASSWORD || decodeURIComponent(u.password || '');

  if (/^\[.*\]$/.test(clave) || /YOUR[-_ ]?PASSWORD/i.test(clave)) {
    throw errorConfig(
      'La clave de DATABASE_URL sigue siendo el texto de ejemplo de Supabase.\n' +
      'Reemplace [YOUR-PASSWORD] por la clave real de la base\n' +
      '(Supabase -> Project Settings -> Database -> Database password).'
    );
  }
  if (!clave) throw errorConfig('DATABASE_URL no trae clave. Use DATABASE_PASSWORD si prefiere ponerla aparte.');

  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);

  if (!local && /^db\..*\.supabase\.co$/.test(u.hostname)) {
    console.warn(
      '\n  AVISO: esta usando la conexion directa de Supabase.\n' +
      '  Ese host solo resuelve por IPv6 y Vercel no tiene salida IPv6.\n' +
      '  Use el Transaction pooler:  postgres.<proyecto>@aws-0-<region>.pooler.supabase.com:6543\n'
    );
  }

  return {
    host: u.hostname,
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username || 'postgres'),
    password: clave,
    database: (u.pathname || '/postgres').slice(1) || 'postgres',
    // Supabase exige TLS. El certificado es de una CA publica, pero el pooler
    // se presenta con un nombre distinto al del proyecto, asi que no se valida
    // el hostname (la conexion sigue cifrada).
    ssl: local ? false : { rejectUnauthorized: false },
    // En serverless cada instancia debe abrir pocas conexiones: el pooler de
    // Supabase es quien multiplexa de verdad.
    max: Number(process.env.PG_MAX_CLIENTES || (process.env.VERCEL ? 1 : 10)),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000,
    application_name: 'banca-dg',
  };
}

/**
 * El pool se abre en la primera consulta, no al importar el modulo.
 *
 * Importa en serverless: si esto reventara al importarse, la funcion entera
 * no llegaria a existir y el navegador solo veria un error opaco de la
 * plataforma. Asi la aplicacion levanta igual y contesta explicando que le
 * falta por configurar.
 */
let pool = null;

function obtenerPool() {
  if (pool) return pool;
  if (!DATABASE_URL) {
    throw errorConfig(
      'Falta la conexion a la base de datos (DATABASE_URL).\n' +
      'En local: cree el archivo .env con la cadena de Supabase.\n' +
      'En Vercel: cargue DATABASE_URL y DATABASE_PASSWORD en Settings -> ' +
      'Environment Variables y vuelva a desplegar.'
    );
  }
  pool = new Pool(configDeConexion(DATABASE_URL));
  pool.on('error', (e) => console.error('[pg] error en conexion inactiva:', e.message));
  return pool;
}

// ---------------------------------------------------------------
// API de consultas
// ---------------------------------------------------------------
function ejecutor(cliente) {
  const correr = async (sql, params) => {
    const { texto, nombres } = traducir(sql);
    try {
      return await (cliente || obtenerPool()).query(texto, valores(nombres, params));
    } catch (e) {
      // A un fallo de configuracion no le agrega la consulta: no fallo el SQL,
      // falta la conexion, y el SQL solo ensucia el mensaje que ve el usuario.
      if (e.configuracion) throw e;
      e.message = `${e.message}\n  SQL: ${texto.replace(/\s+/g, ' ').slice(0, 240)}`;
      throw e;
    }
  };

  return {
    /** Primera fila, o null. */
    uno: async (sql, params) => (await correr(sql, params)).rows[0] ?? null,
    /** Todas las filas. */
    todos: async (sql, params) => (await correr(sql, params)).rows,
    /** INSERT/UPDATE/DELETE: devuelve { filas, rows }. */
    correr: async (sql, params) => {
      const r = await correr(sql, params);
      return { filas: r.rowCount, rows: r.rows };
    },
    /** Un solo valor escalar de la primera fila. */
    valor: async (sql, params) => {
      const fila = (await correr(sql, params)).rows[0];
      return fila ? Object.values(fila)[0] : null;
    },
  };
}

const q = ejecutor(null);

/**
 * Transaccion. El callback recibe un ejecutor atado a UNA conexion; todo lo
 * que se haga con el viaja en la misma transaccion.
 *
 *   await tx(async (t) => {
 *     await t.correr('INSERT ...');
 *     await t.correr('UPDATE ...');
 *   });
 */
async function tx(fn) {
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(ejecutor(cliente));
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    try { await cliente.query('ROLLBACK'); } catch { /* la conexion ya murio */ }
    throw e;
  } finally {
    cliente.release();
  }
}

/** Comprueba que la base responde y tiene el esquema aplicado. */
async function comprobar() {
  const r = await q.uno(
    `SELECT current_database() AS base,
            (SELECT COUNT(*) FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name IN ('bancas','usuarios','loterias','tickets','jugadas',
                                   'resultados','premios','limites','settings','sesiones',
                                   'cierres','auditoria')) AS tablas`
  );
  return { base: r.base, tablas: Number(r.tablas), completo: Number(r.tablas) === 12 };
}

async function cerrar() {
  if (!pool) return;
  try { await pool.end(); } catch { /* ya cerrado */ }
}

// ---------------------------------------------------------------
// Settings (clave/valor). Se cachean en memoria porque se leen en cada
// venta y cambian muy poco; el cache se invalida al escribir.
// ---------------------------------------------------------------
let cacheSettings = null;
let cacheVence = 0;
const VIDA_CACHE_MS = 30_000;

async function cargarSettings(forzar = false) {
  if (!forzar && cacheSettings && Date.now() < cacheVence) return cacheSettings;
  const filas = await q.todos('SELECT key, value FROM settings');
  const out = {};
  for (const f of filas) out[f.key] = f.value;   // jsonb ya viene deserializado
  cacheSettings = out;
  cacheVence = Date.now() + VIDA_CACHE_MS;
  return out;
}

async function getSetting(key, porDefecto = null) {
  const todos = await cargarSettings();
  return key in todos ? todos[key] : porDefecto;
}

async function setSetting(key, value) {
  await q.correr(
    `INSERT INTO settings (key, value, actualizado) VALUES (?, ?, now())
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, actualizado = excluded.actualizado`,
    [key, JSON.stringify(value)]
  );
  cacheSettings = null;
  return value;
}

const allSettings = () => cargarSettings(true);

// ---------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------
async function auditar({ usuario_id = null, usuario = '', accion, entidad = '', entidad_id = '', detalle = '', ip = '' }) {
  try {
    await q.correr(
      `INSERT INTO auditoria (usuario_id, usuario, accion, entidad, entidad_id, detalle, ip)
       VALUES (@usuario_id, @usuario, @accion, @entidad, @entidad_id, @detalle, @ip)`,
      {
        usuario_id, usuario, accion, entidad,
        entidad_id: String(entidad_id ?? ''),
        detalle: typeof detalle === 'string' ? detalle : JSON.stringify(detalle),
        ip,
      }
    );
  } catch (e) {
    // La bitacora nunca debe tumbar una venta.
    console.error('[auditoria] no se pudo registrar:', e.message);
  }
}

module.exports = {
  pool, q, tx, comprobar, cerrar, aHoraRD,
  getSetting, setSetting, allSettings, cargarSettings, auditar,
};
