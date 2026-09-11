// Utilidades de interfaz compartidas por todas las vistas.

export const $  = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

/** Escapa texto para insertarlo en HTML. */
export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let MONEDA = 'RD$';
export function fijarMoneda(m) { MONEDA = m || 'RD$'; }

/** 1234.5 -> 'RD$ 1,234.50' */
export function dinero(n, conSimbolo = true) {
  const v = Number(n) || 0;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return conSimbolo ? `${MONEDA} ${s}` : s;
}

export function entero(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}

/** '2026-09-10' -> '10/09/2026' */
export function fechaCorta(f) {
  if (!f || !/^\d{4}-\d{2}-\d{2}/.test(f)) return f || '';
  const [y, m, d] = f.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// La fecha de negocio siempre es la de Republica Dominicana, sin importar
// la zona horaria que tenga configurada la PC donde corre el navegador.
const FMT_RD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function hoyISO() {
  return FMT_RD.format(new Date());
}

export function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------
export function aviso(texto, tipo = 'info', titulo = '') {
  const cont = $('#avisos');
  const div = document.createElement('div');
  div.className = `aviso ${tipo === 'error' ? 'error' : tipo === 'ok' ? 'ok' : tipo === 'aviso' ? 'aviso2' : ''}`;
  div.innerHTML = (titulo ? `<b>${esc(titulo)}</b>` : '') + esc(texto);
  cont.appendChild(div);
  const vida = tipo === 'error' ? 7000 : 3500;
  setTimeout(() => {
    div.style.transition = 'opacity .25s';
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 260);
  }, vida);
}

export const exito = (t, tit = '') => aviso(t, 'ok', tit);
export const error = (t, tit = 'Error') => aviso(t, 'error', tit);

/** Ejecuta una promesa mostrando el error si falla. */
export async function intentar(fn, mensajeExito = '') {
  try {
    const r = await fn();
    if (mensajeExito) exito(mensajeExito);
    return r;
  } catch (e) {
    error(e.message || 'Ocurrio un error inesperado.');
    return null;
  }
}

// ---------------------------------------------------------------
// Modales
// ---------------------------------------------------------------
export function modal({ titulo = '', cuerpo = '', botones = [], ancho = false, alCerrar = null }) {
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.innerHTML = `
    <div class="modal ${ancho ? 'ancho' : ''}" role="dialog" aria-modal="true">
      <header>
        <span class="crece">${esc(titulo)}</span>
        <button class="cerrar-modal" data-cerrar type="button" aria-label="Cerrar">&times;</button>
      </header>
      <div class="interior"></div>
      ${botones.length ? '<footer></footer>' : ''}
    </div>`;

  const interior = velo.querySelector('.interior');
  if (typeof cuerpo === 'string') interior.innerHTML = cuerpo;
  else interior.appendChild(cuerpo);

  const cerrar = () => {
    velo.remove();
    document.removeEventListener('keydown', alTecla);
    if (alCerrar) alCerrar();
  };
  const alTecla = (e) => { if (e.key === 'Escape') cerrar(); };

  const pie = velo.querySelector('footer');
  if (pie) {
    for (const b of botones) {
      const btn = document.createElement('button');
      btn.textContent = b.texto;
      btn.className = b.clase || 'sec';
      btn.type = 'button';
      btn.onclick = async () => {
        if (b.alHacerClick) {
          const r = await b.alHacerClick({ cerrar, interior, velo });
          if (r === false) return;
        }
        if (b.cierra !== false) cerrar();
      };
      pie.appendChild(btn);
    }
  }

  velo.querySelector('[data-cerrar]').onclick = cerrar;
  velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(); });
  document.addEventListener('keydown', alTecla);
  $('#modales').appendChild(velo);

  const primerCampo = interior.querySelector('input, select, textarea');
  if (primerCampo) setTimeout(() => primerCampo.focus(), 40);

  return { cerrar, interior, velo };
}

export function confirmar(texto, titulo = 'Confirmar', textoOk = 'Si, continuar', claseOk = 'malo') {
  return new Promise((resolve) => {
    let decidido = false;
    modal({
      titulo,
      cuerpo: `<p style="margin:0">${esc(texto)}</p>`,
      alCerrar: () => { if (!decidido) resolve(false); },
      botones: [
        { texto: 'Cancelar', clase: 'sec', alHacerClick: () => { decidido = true; resolve(false); } },
        { texto: textoOk, clase: claseOk, alHacerClick: () => { decidido = true; resolve(true); } },
      ],
    });
  });
}

/** Modal con un formulario simple generado a partir de una lista de campos. */
export function modalFormulario({ titulo, campos, valores = {}, textoOk = 'Guardar', alGuardar, ancho = false }) {
  const form = document.createElement('form');
  form.autocomplete = 'off';
  form.innerHTML = campos.map((c) => campoHTML(c, valores[c.nombre])).join('');

  const m = modal({
    titulo, cuerpo: form, ancho,
    botones: [
      { texto: 'Cancelar', clase: 'sec' },
      {
        texto: textoOk, clase: '',
        alHacerClick: async ({ cerrar }) => {
          const datos = {};
          for (const c of campos) {
            const campo = form.elements[c.nombre];
            if (!campo) continue;
            datos[c.nombre] = c.tipo === 'checkbox' ? campo.checked : campo.value;
          }
          try {
            await alGuardar(datos, { cerrar, form });
          } catch (e) {
            error(e.message);
            return false;
          }
        },
      },
    ],
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    m.velo.querySelector('footer button:last-child').click();
  };
  return m;
}

function campoHTML(c, valor) {
  const v = valor ?? c.valor ?? '';
  if (c.tipo === 'checkbox') {
    return `<label class="chk" style="margin-bottom:12px">
      <input type="checkbox" name="${esc(c.nombre)}" ${v ? 'checked' : ''}> ${esc(c.rotulo)}
    </label>`;
  }
  if (c.tipo === 'select') {
    return `<label class="campo"><span>${esc(c.rotulo)}</span>
      <select name="${esc(c.nombre)}">
        ${(c.opciones || []).map((o) =>
          `<option value="${esc(o.valor)}" ${String(o.valor) === String(v) ? 'selected' : ''}>${esc(o.texto)}</option>`).join('')}
      </select></label>`;
  }
  if (c.tipo === 'textarea') {
    return `<label class="campo"><span>${esc(c.rotulo)}</span>
      <textarea name="${esc(c.nombre)}" rows="${c.filas || 3}">${esc(v)}</textarea></label>`;
  }
  return `<label class="campo"><span>${esc(c.rotulo)}</span>
    <input type="${esc(c.tipo || 'text')}" name="${esc(c.nombre)}" value="${esc(v)}"
      ${c.paso ? `step="${esc(c.paso)}"` : ''} ${c.min !== undefined ? `min="${esc(c.min)}"` : ''}
      ${c.max !== undefined ? `max="${esc(c.max)}"` : ''} ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''}
      ${c.requerido ? 'required' : ''}></label>`;
}

// ---------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------
/**
 * cols: [{k, t, num, fmt, clase}]
 * filas: array de objetos
 * opts: {vacio, pie: fila resumen, alHacerClick(fila)}
 */
export function tabla(cols, filas, opts = {}) {
  if (!filas || !filas.length) {
    return `<div class="vacio">${esc(opts.vacio || 'Sin datos para mostrar.')}</div>`;
  }
  const th = cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.t)}</th>`).join('');
  const tb = filas.map((f, i) => {
    const tds = cols.map((c) => {
      const bruto = f[c.k];
      const val = c.fmt ? c.fmt(bruto, f, i) : esc(bruto ?? '');
      return `<td class="${c.num ? 'num' : ''} ${c.clase || ''}">${val}</td>`;
    }).join('');
    return `<tr class="${opts.alHacerClick ? 'clicable' : ''}" data-fila="${i}">${tds}</tr>`;
  }).join('');
  const pie = opts.pie
    ? `<tfoot><tr>${cols.map((c) => {
        const bruto = opts.pie[c.k];
        const val = bruto === undefined ? '' : (c.fmt ? c.fmt(bruto, opts.pie, -1) : esc(bruto));
        return `<td class="${c.num ? 'num' : ''}">${val}</td>`;
      }).join('')}</tr></tfoot>`
    : '';
  return `<div class="tabla-env"><table class="tabla"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody>${pie}</table></div>`;
}

/** Conecta el click de filas de una tabla renderizada con `tabla()`. */
export function conectarFilas(raiz, filas, fn) {
  $$('tr[data-fila]', raiz).forEach((tr) => {
    tr.onclick = () => fn(filas[Number(tr.dataset.fila)]);
  });
}

export const etiquetaEstado = (e) => `<span class="etiqueta ${esc(e)}">${esc(e)}</span>`;

export function cargando(texto = 'Cargando...') {
  return `<div class="cargando"><div><div class="giro" style="margin:0 auto 10px"></div>${esc(texto)}</div></div>`;
}

/** Selector de rango de fechas reutilizable. */
export function filtroFechas(desde, hasta, extra = '') {
  return `
    <label class="campo"><span>Desde</span><input type="date" id="f-desde" value="${esc(desde)}"></label>
    <label class="campo"><span>Hasta</span><input type="date" id="f-hasta" value="${esc(hasta)}"></label>
    ${extra}
    <button id="f-aplicar">Aplicar</button>`;
}

/** Descarga una tabla de datos como CSV. */
export function descargarCSV(nombre, cols, filas) {
  const esc2 = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [cols.map((c) => esc2(c.t)).join(',')];
  for (const f of filas) lineas.push(cols.map((c) => esc2(f[c.k])).join(','));
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
