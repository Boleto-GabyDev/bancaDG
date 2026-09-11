'use strict';

/**
 * Motor de premios.
 *
 * Reglas implementadas (todas con multiplicador configurable):
 *
 *  QUINIELA  numero en 1ra -> x60 | 2da -> x20 | 3ra -> x10
 *            Si el numero sale repetido en dos posiciones se pagan ambas
 *            (opcion "pagar_repetidos", activa por defecto).
 *
 *  PALE      los 2 numeros entre 1ra y 2da            -> x1000  (directo)
 *            los 2 numeros usando la 3ra              -> x100   (tercera)
 *            Admite pale doble (mismo numero dos veces) si el numero
 *            sale repetido en el sorteo.
 *
 *  TRIPLETA  los 3 numeros en 1ra, 2da y 3ra          -> x12000 (directo)
 *            solo 2 de los 3                          -> "doble" (x0 = apagado)
 *
 *  SUPERPALE un numero en la 1ra de cada una de las 2 loterias -> x2000
 *
 * `evaluarJugada` es una funcion pura: no toca la base. Quien la llama le
 * pasa la tabla de multiplicadores y las opciones ya resueltas, de modo que
 * evaluar miles de jugadas no dispara miles de consultas.
 */

const { q } = require('../db');

const DEFECTOS = {
  quiniela:  { 1: 60, 2: 20, 3: 10 },
  pale:      { directo: 1000, tercera: 100 },
  tripleta:  { directo: 12000, doble: 0 },
  superpale: { directo: 2000 },
};

const POSICIONES = {
  quiniela:  ['1', '2', '3'],
  pale:      ['directo', 'tercera'],
  tripleta:  ['directo', 'doble'],
  superpale: ['directo'],
};

const ETIQUETA_POS = {
  quiniela:  { 1: '1ra', 2: '2da', 3: '3ra' },
  pale:      { directo: 'Pale', tercera: 'Pale c/3ra' },
  tripleta:  { directo: 'Tripleta', doble: 'Tripleta (2 de 3)' },
  superpale: { directo: 'Super Pale' },
};

/**
 * Tabla de multiplicadores efectiva para una loteria.
 * Prioridad: fila de la loteria > fila global (loteria_id NULL) > valor por defecto.
 */
async function tablaPremios(loteriaId = null) {
  const tabla = JSON.parse(JSON.stringify(DEFECTOS));
  // Globales primero y especificas despues, para que las especificas pisen.
  const filas = await q.todos(
    `SELECT loteria_id, tipo, posicion, multiplicador
       FROM premios
      WHERE loteria_id IS NULL OR loteria_id = ?
      ORDER BY (loteria_id IS NOT NULL)`,
    [loteriaId ?? -1]
  );
  for (const f of filas) {
    if (!tabla[f.tipo]) tabla[f.tipo] = {};
    tabla[f.tipo][f.posicion] = Number(f.multiplicador);
  }
  return tabla;
}

/**
 * Carga de una sola vez las tablas de todas las loterias.
 * Evita el problema N+1 al evaluar un sorteo completo.
 */
async function tablasDeTodas() {
  const filas = await q.todos('SELECT loteria_id, tipo, posicion, multiplicador FROM premios');
  const global = JSON.parse(JSON.stringify(DEFECTOS));
  for (const f of filas) {
    if (f.loteria_id !== null) continue;
    if (!global[f.tipo]) global[f.tipo] = {};
    global[f.tipo][f.posicion] = Number(f.multiplicador);
  }

  const porLoteria = new Map();
  for (const f of filas) {
    if (f.loteria_id === null) continue;
    if (!porLoteria.has(f.loteria_id)) {
      porLoteria.set(f.loteria_id, JSON.parse(JSON.stringify(global)));
    }
    const t = porLoteria.get(f.loteria_id);
    if (!t[f.tipo]) t[f.tipo] = {};
    t[f.tipo][f.posicion] = Number(f.multiplicador);
  }

  return (loteriaId) => porLoteria.get(loteriaId) || global;
}

/** ¿El multiconjunto `need` cabe dentro de `pool`? */
function contiene(pool, need) {
  const restante = [...pool];
  for (const n of need) {
    const i = restante.indexOf(n);
    if (i === -1) return false;
    restante.splice(i, 1);
  }
  return true;
}

/** Cuantos elementos de `need` estan presentes en `pool` (sin reutilizar). */
function coincidencias(pool, need) {
  const restante = [...pool];
  let c = 0;
  for (const n of need) {
    const i = restante.indexOf(n);
    if (i !== -1) { restante.splice(i, 1); c++; }
  }
  return c;
}

/**
 * Evalua una jugada contra los resultados. Funcion pura.
 *
 * @param jugada     {tipo, numeros, monto, loteria_id, loteria2_id}
 * @param resultado  resultado de la loteria principal {primera,segunda,tercera} o null
 * @param tabla      tabla de multiplicadores
 * @param resultado2 resultado de la segunda loteria (solo super pale)
 * @param opciones   {pagarRepetidos}
 * @returns {{gana:boolean, premio:number, factor:number, detalle:string}}
 */
function evaluarJugada(jugada, resultado, tabla, resultado2 = null, opciones = {}) {
  const { pagarRepetidos = true } = opciones;
  const nums = String(jugada.numeros).split('-');
  const monto = Number(jugada.monto) || 0;
  const nada = { gana: false, premio: 0, factor: 0, detalle: '' };

  if (jugada.tipo === 'superpale') {
    if (!resultado || !resultado2) return nada;
    const pool = [resultado.primera, resultado2.primera];
    if (!contiene(pool, nums)) return nada;
    const f = Number(tabla.superpale.directo) || 0;
    if (f <= 0) return nada;
    return { gana: true, factor: f, premio: monto * f, detalle: `Super Pale x${f}` };
  }

  if (!resultado) return nada;
  const { primera, segunda, tercera } = resultado;

  if (jugada.tipo === 'quiniela') {
    const n = nums[0];
    const hits = [];
    if (n === primera) hits.push('1');
    if (n === segunda) hits.push('2');
    if (n === tercera) hits.push('3');
    if (!hits.length) return nada;

    const usados = pagarRepetidos ? hits : [hits[0]];
    let factor = 0;
    const partes = [];
    for (const p of usados) {
      const f = Number(tabla.quiniela[p]) || 0;
      if (f <= 0) continue;
      factor += f;
      partes.push(`${ETIQUETA_POS.quiniela[p]} x${f}`);
    }
    if (factor <= 0) return nada;
    return { gana: true, factor, premio: monto * factor, detalle: partes.join(' + ') };
  }

  if (jugada.tipo === 'pale') {
    if (contiene([primera, segunda], nums)) {
      const f = Number(tabla.pale.directo) || 0;
      if (f > 0) return { gana: true, factor: f, premio: monto * f, detalle: `Pale x${f}` };
    }
    if (contiene([primera, segunda, tercera], nums)) {
      const f = Number(tabla.pale.tercera) || 0;
      if (f > 0) return { gana: true, factor: f, premio: monto * f, detalle: `Pale c/3ra x${f}` };
    }
    return nada;
  }

  if (jugada.tipo === 'tripleta') {
    const pool = [primera, segunda, tercera];
    if (contiene(pool, nums)) {
      const f = Number(tabla.tripleta.directo) || 0;
      if (f > 0) return { gana: true, factor: f, premio: monto * f, detalle: `Tripleta x${f}` };
      return nada;
    }
    if (coincidencias(pool, nums) === 2) {
      const f = Number(tabla.tripleta.doble) || 0;
      if (f > 0) return { gana: true, factor: f, premio: monto * f, detalle: `Tripleta 2/3 x${f}` };
    }
    return nada;
  }

  return nada;
}

module.exports = {
  DEFECTOS, POSICIONES, ETIQUETA_POS,
  tablaPremios, tablasDeTodas, contiene, coincidencias, evaluarJugada,
};
