'use strict';

/**
 * Manejo de fecha/hora en la zona horaria de Republica Dominicana
 * (America/Santo_Domingo, UTC-4 todo el anio, sin horario de verano).
 *
 * Todo el sistema opera sobre la "fecha de negocio" local, no UTC,
 * para que el cierre de sorteos y los reportes cuadren con la realidad.
 */

const { TZ } = require('../config');

const fmtFecha = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const fmtHora = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** 'YYYY-MM-DD' de hoy en RD */
function hoy(d = new Date()) {
  return fmtFecha.format(d);
}

/** 'HH:MM:SS' actual en RD */
function horaActual(d = new Date()) {
  return fmtHora.format(d);
}

/** 'YYYY-MM-DD HH:MM:SS' local RD */
function ahora(d = new Date()) {
  return `${hoy(d)} ${horaActual(d)}`;
}

/** Minutos transcurridos del dia (0-1439) en RD */
function minutosDelDia(d = new Date()) {
  const [h, m] = horaActual(d).split(':').map(Number);
  return h * 60 + m;
}

/** Convierte 'HH:MM' a minutos */
function aMinutos(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Convierte minutos a 'HH:MM' */
function aHHMM(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Dia de la semana 1=Lunes .. 7=Domingo para una fecha 'YYYY-MM-DD' */
function diaSemana(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom
  return js === 0 ? 7 : js;
}

const NOMBRE_DIA = ['', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];

/** Suma dias a 'YYYY-MM-DD' */
function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Valida 'YYYY-MM-DD' */
function esFecha(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** Formato humano dd/mm/yyyy */
function fechaHumana(fecha) {
  if (!esFecha(fecha)) return fecha || '';
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

/** Primer dia del mes de 'YYYY-MM-DD' */
function inicioMes(fecha) {
  return `${fecha.slice(0, 7)}-01`;
}

/** ISO UTC para expiracion de sesiones */
function isoUTC(d = new Date()) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

module.exports = {
  hoy, horaActual, ahora, minutosDelDia, aMinutos, aHHMM,
  diaSemana, NOMBRE_DIA, sumarDias, esFecha, fechaHumana, inicioMes, isoUTC,
};
