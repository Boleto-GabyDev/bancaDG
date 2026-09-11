'use strict';

/**
 * Tipos de jugada de una banca dominicana y normalizacion de numeros.
 *
 *  quiniela  : 1 numero  (00-99)   -> premia si sale en 1ra, 2da o 3ra
 *  pale      : 2 numeros           -> premia si ambos salen (1ra-2da, o con la 3ra)
 *  tripleta  : 3 numeros           -> premia si los 3 salen en 1ra, 2da y 3ra
 *  superpale : 2 numeros en 2 loterias distintas -> uno en la 1ra de cada una
 *
 * En pale/tripleta/superpale el orden NO influye en el premio, por eso los
 * numeros se guardan ordenados de forma canonica: asi los topes por numero
 * ("45-12" y "12-45") se acumulan en la misma posicion.
 */

const TIPOS = {
  quiniela:  { clave: 'quiniela',  nombre: 'Quiniela',   cantidad: 1, campoLoteria: 'q_quiniela'  },
  pale:      { clave: 'pale',      nombre: 'Pale',       cantidad: 2, campoLoteria: 'q_pale'      },
  tripleta:  { clave: 'tripleta',  nombre: 'Tripleta',   cantidad: 3, campoLoteria: 'q_tripleta'  },
  superpale: { clave: 'superpale', nombre: 'Super Pale', cantidad: 2, campoLoteria: 'q_superpale' },
};

const LISTA_TIPOS = Object.values(TIPOS);

/** Normaliza un numero suelto a 2 digitos ('5' -> '05'). Devuelve null si invalido. */
function normNumero(n) {
  const s = String(n ?? '').trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const v = Number(s);
  if (v < 0 || v > 99) return null;
  return String(v).padStart(2, '0');
}

/**
 * Convierte la entrada del cajero en una lista de numeros de 2 digitos.
 * Acepta: '45', '4512', '45-12', '45 12', '45,12', '451207'
 */
function partirEntrada(entrada) {
  const s = String(entrada ?? '').trim();
  if (!s) return null;
  if (/[^0-9\s,.\-]/.test(s)) return null;

  const conSeparador = /[\s,.\-]/.test(s);
  let partes;
  if (conSeparador) {
    partes = s.split(/[\s,.\-]+/).filter(Boolean);
  } else {
    if (s.length % 2 !== 0 || s.length < 2 || s.length > 6) return null;
    partes = s.match(/.{2}/g);
  }
  const nums = partes.map(normNumero);
  if (nums.some((n) => n === null)) return null;
  if (nums.length < 1 || nums.length > 3) return null;
  return nums;
}

/** Deduce el tipo por la cantidad de numeros (superpale hay que pedirlo explicito). */
function tipoPorCantidad(cantidad) {
  if (cantidad === 1) return 'quiniela';
  if (cantidad === 2) return 'pale';
  if (cantidad === 3) return 'tripleta';
  return null;
}

/** Orden canonico (ascendente) para que los topes se acumulen bien. */
function canonico(nums) {
  return [...nums].sort().join('-');
}

/**
 * Valida y normaliza una jugada.
 * @returns {{ok:true, tipo, numeros, lista}|{ok:false, error:string}}
 */
function normalizarJugada(entrada, tipoForzado = null) {
  const lista = partirEntrada(entrada);
  if (!lista) return { ok: false, error: `Numero invalido: "${entrada}"` };

  const tipo = tipoForzado || tipoPorCantidad(lista.length);
  if (!tipo || !TIPOS[tipo]) return { ok: false, error: 'Tipo de jugada desconocido' };

  const esperado = TIPOS[tipo].cantidad;
  if (lista.length !== esperado) {
    return { ok: false, error: `${TIPOS[tipo].nombre} requiere ${esperado} numero(s), recibio ${lista.length}` };
  }
  if (tipo === 'tripleta' && new Set(lista).size !== 3) {
    return { ok: false, error: 'La tripleta no admite numeros repetidos' };
  }
  if (tipo === 'superpale' && lista[0] === lista[1]) {
    return { ok: false, error: 'El super pale no admite el mismo numero dos veces' };
  }
  return { ok: true, tipo, numeros: canonico(lista), lista: [...lista].sort() };
}

/** Texto para mostrar/imprimir: '45-12' */
function mostrar(numeros) {
  return String(numeros).split('-').join('-');
}

module.exports = { TIPOS, LISTA_TIPOS, normNumero, partirEntrada, tipoPorCantidad, canonico, normalizarJugada, mostrar };
