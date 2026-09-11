'use strict';

/**
 * Traduccion de marcadores de parametros al formato de PostgreSQL.
 *
 * La aplicacion venia de SQLite, donde se escribia  `? `  o  `@nombre`.
 * Postgres usa  $1..$n  en orden de aparicion. Esta funcion hace la
 * conversion respetando los literales de texto, de modo que un '?' o un '@'
 * dentro de una cadena entre comillas no se toca.
 */

const cache = new Map();

/**
 * @param {string} sql
 * @returns {{texto: string, nombres: Array<number|string>}}
 *   `nombres[i]` dice de donde sale el valor de $(i+1):
 *   un numero si el marcador era posicional, o la clave si era '@nombre'.
 */
function traducir(sql) {
  const guardado = cache.get(sql);
  if (guardado) return guardado;

  const nombres = [];
  let posicional = 0;
  let dentroDeTexto = false;
  let comilla = '';
  let salida = '';

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];

    if (!dentroDeTexto && (c === "'" || c === '"')) {
      dentroDeTexto = true;
      comilla = c;
      salida += c;
      continue;
    }

    if (dentroDeTexto) {
      salida += c;
      if (c === comilla) {
        if (sql[i + 1] === comilla) { salida += sql[++i]; continue; }  // '' escapada
        dentroDeTexto = false;
      }
      continue;
    }

    if (c === '?') {
      nombres.push(posicional++);
      salida += `$${nombres.length}`;
      continue;
    }

    // '@nombre', pero no el operador '@@' ni '@>' de Postgres.
    if (c === '@' && /[A-Za-z_]/.test(sql[i + 1] || '')) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const clave = sql.slice(i + 1, j);
      let idx = nombres.indexOf(clave);
      if (idx === -1) { nombres.push(clave); idx = nombres.length - 1; }
      salida += `$${idx + 1}`;
      i = j - 1;
      continue;
    }

    salida += c;
  }

  const r = { texto: salida, nombres };
  cache.set(sql, r);
  return r;
}

/**
 * Ordena los valores segun el orden en que aparecen los $n.
 * @param {Array<number|string>} nombres
 * @param {Array|Object} params
 */
function valores(nombres, params) {
  if (!nombres.length) return [];
  const esObjeto = params !== null && typeof params === 'object' && !Array.isArray(params);

  return nombres.map((n) => {
    if (typeof n === 'number') {
      const lista = Array.isArray(params) ? params : [params];
      const v = lista[n];
      return v === undefined ? null : v;
    }
    if (!esObjeto || !(n in params)) {
      throw new Error(`Falta el parametro "${n}" en la consulta.`);
    }
    const v = params[n];
    return v === undefined ? null : v;
  });
}

module.exports = { traducir, valores };
