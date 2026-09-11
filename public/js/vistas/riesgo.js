// Riesgo del dia: cuanto se vendio de cada numero y cuanto se pagaria si sale.

import { api } from '../api.js';
import { $, esc, dinero, entero, hoyISO, tabla, error, descargarCSV } from '../ui.js';

let vista, fecha, tipo = 'quiniela', loteriaId = '', filas = [];

export async function montar(raiz) {
  vista = raiz;
  fecha = hoyISO();

  const lot = await api.get('/catalogo/loterias', { fecha, todas: '1' }).catch(() => ({ loterias: [] }));

  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Riesgo y topes</h1></div>

    <div class="tarjeta"><div class="interior">
      <div class="fila">
        <label class="campo" style="max-width:160px"><span>Fecha</span>
          <input type="date" id="g-fecha" value="${esc(fecha)}"></label>
        <label class="campo" style="max-width:180px"><span>Tipo</span>
          <select id="g-tipo">
            <option value="quiniela">Quiniela</option>
            <option value="pale">Pale</option>
            <option value="tripleta">Tripleta</option>
            <option value="superpale">Super Pale</option>
          </select></label>
        <label class="campo" style="max-width:220px"><span>Loteria</span>
          <select id="g-loteria"><option value="">Todas</option>
            ${lot.loterias.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}
          </select></label>
        <button id="g-aplicar">Ver</button>
        <div class="crece"></div>
        <button class="sec" id="g-csv">Exportar</button>
      </div>
      <p class="chico tenue" style="margin:8px 0 0">
        La exposicion es lo que habria que pagar si ese numero sale en primera.
        El disponible es lo que aun se puede vender antes de topar.
      </p>
    </div></div>

    <div id="g-kpis" class="rejilla c4" style="margin-bottom:14px"></div>

    <div class="tarjeta">
      <header>Numeros mas jugados</header>
      <div class="interior sin-padding" id="g-tabla"></div>
    </div>`;

  $('#g-aplicar').onclick = cargar;
  ['g-fecha', 'g-tipo', 'g-loteria'].forEach((id) => { $(`#${id}`).onchange = cargar; });
  $('#g-csv').onclick = () => descargarCSV(`riesgo_${fecha}_${tipo}`, COLS, filas);

  await cargar();
}

const COLS = [
  { k: 'numeros', t: 'Numero', fmt: (v) => `<span class="pill-num">${esc(v)}</span>` },
  { k: 'loteria', t: 'Loteria' },
  { k: 'jugadas', t: 'Jugadas', num: true, fmt: entero },
  { k: 'vendido', t: 'Vendido', num: true, fmt: (v) => dinero(v, false) },
  { k: 'multiplicador', t: 'Paga', num: true, fmt: (v) => `x${entero(v)}` },
  { k: 'exposicion', t: 'Exposicion', num: true, fmt: (v) => `<b class="texto-malo">${dinero(v, false)}</b>` },
  { k: 'tope', t: 'Tope', num: true, fmt: (v) => v > 0 ? dinero(v, false) : '<span class="tenue">sin tope</span>' },
  { k: 'disponible', t: 'Disponible', num: true, fmt: (v, f) => {
      if (v === null) return '<span class="tenue">-</span>';
      const pct = f.tope > 0 ? Math.min(100, (f.vendido / f.tope) * 100) : 0;
      const clase = pct >= 90 ? 'alto' : pct >= 70 ? 'medio' : '';
      return `${dinero(v, false)}
        <div class="barra-prog" style="margin-top:3px"><i class="${clase}" style="width:${pct.toFixed(0)}%"></i></div>`;
    } },
];

async function cargar() {
  fecha = $('#g-fecha').value;
  tipo = $('#g-tipo').value;
  loteriaId = $('#g-loteria').value;

  const cont = $('#g-tabla');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await api.get('/reportes/riesgo', { fecha, tipo, loteria_id: loteriaId });
    filas = r.filas;

    const vendido = filas.reduce((s, f) => s + f.vendido, 0);
    const maxExp = filas.reduce((m, f) => Math.max(m, f.exposicion), 0);
    const peor = filas.find((f) => f.exposicion === maxExp);
    const topados = filas.filter((f) => f.disponible !== null && f.disponible <= 0).length;

    $('#g-kpis').innerHTML = `
      <div class="kpi"><div class="rotulo">Vendido (${esc(tipo)})</div>
        <div class="valor">${dinero(vendido)}</div><div class="nota">${filas.length} numero(s) distintos</div></div>
      <div class="kpi malo"><div class="rotulo">Mayor exposicion</div>
        <div class="valor">${dinero(maxExp)}</div>
        <div class="nota">${peor ? `numero ${esc(peor.numeros)} en ${esc(peor.loteria)}` : '-'}</div></div>
      <div class="kpi aviso"><div class="rotulo">Numeros topados</div>
        <div class="valor">${entero(topados)}</div><div class="nota">ya no admiten mas venta</div></div>
      <div class="kpi ${maxExp > vendido ? 'malo' : 'ok'}"><div class="rotulo">Saldo en el peor caso</div>
        <div class="valor">${dinero(vendido - maxExp)}</div>
        <div class="nota">venta menos el numero mas expuesto</div></div>`;

    cont.innerHTML = tabla(COLS, filas, { vacio: 'Sin jugadas de ese tipo en la fecha.' });
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}
