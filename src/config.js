'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Carga .env si existe (en Vercel las variables ya vienen del entorno).
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE) && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(ENV_FILE); } catch (e) {
    console.error('[config] no se pudo leer .env:', e.message);
  }
}

const enVercel = !!process.env.VERCEL;

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || '0.0.0.0',

  /** Cadena de conexion de Supabase / PostgreSQL. */
  DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',

  /**
   * Clave de la base, opcional y aparte.
   * Si se define, gana sobre la que venga dentro de DATABASE_URL. Sirve para
   * claves con simbolos (@ # ? / %) que habria que codificar dentro de una URL.
   */
  DATABASE_PASSWORD: process.env.DATABASE_PASSWORD || process.env.PGPASSWORD || '',

  TZ: 'America/Santo_Domingo',
  SESSION_COOKIE: 'banca_sid',
  SESSION_HORAS: Number(process.env.BANCA_SESION_HORAS || 12),
  MONEDA: 'RD$',

  /** En produccion la cookie de sesion solo viaja por HTTPS. */
  PRODUCCION: process.env.NODE_ENV === 'production' || enVercel,
  EN_VERCEL: enVercel,
};
