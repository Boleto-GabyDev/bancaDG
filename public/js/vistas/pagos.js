// Premios ganados que todavia no se han cobrado.

import { api } from '../api.js';
import { $, esc, dinero, entero, fechaCorta, hoyISO, tabla, conectarFilas, error, descargarCSV } from '../ui.js';
import { abrirTicket } from './_detalle-ticket.js';

let vista, desde, hasta, filas = [];

export async function montar(raiz) {
  vista = raiz;
  hasta = hoyISO();
  const [y, m, d] = hasta.split('-').map(Number);
  desde = new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10);

  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Premios por pagar</h1></div>

    <div class="tarjeta"><div class="interior">
      <div class="fila">
        <label class="campo" style="max-width:160px"><span>Desde</span>
          <input type="date" id="q-desde" value="${esc(desde)}"></label>
        <label class="campo" style="max-width:160px"><span>Hasta</span>
          <input type="date" id="q-hasta" value="${esc(hasta)}"></label>
        <button id="q-ver">Ver</button>
        <div class="crece"></div>
        <button class="sec" id="q-csv">Exportar</button>
      </div>
      <p class="chico tenue" style="margin:8px 0 0">Haga clic en una fila para revisar y pagar el ticket.</p>
    </div></div>

    <div id="q-kpis" class="rejilla c3" style="margin-bottom:14px"></div>

    <div class="tarjeta">
      <header>Tickets ganadores sin cobrar</header>
      <div class="interior sin-padding" id="q-tabla"></div>
    </div>`;

  $('#q-ver').onclick = cargar;
  ['q-desde', 'q-hasta'].forEach((id) => { $(`#${id}`).onchange = cargar; });
  $('#q-csv').onclick = () => descargarCSV(`premios_por_pagar_${desde}_${hasta}`, COLS, filas);

  await cargar();
}

const COLS = [
  { k: 'codigo', t: 'Ticket', fmt: (v) => `<b class="mono">${esc(v)}</b>` },
  { k: 'fecha_sorteo', t: 'Sorteo', fmt: (v) => fechaCorta(v) },
  { k: 'vendedor', t: 'Cajero' },
  { k: 'banca', t: 'Banca' },
  { k: 'cliente', t: 'Cliente' },
  { k: 'total', t: 'Apostado', num: true, fmt: (v) => dinero(v, false) },
  { k: 'premio_total', t: 'Premio', num: true, fmt: (v) => `<b class="texto-ok">${dinero(v, false)}</b>` },
];

async function cargar() {
  desde = $('#q-desde').value;
  hasta = $('#q-hasta').value;
  const cont = $('#q-tabla');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await api.get('/reportes/pendientes', { desde, hasta });
    filas = r.filas;
    const total = filas.reduce((s, f) => s + f.premio_total, 0);
    const mayor = filas.reduce((m, f) => Math.max(m, f.premio_total), 0);

    $('#q-kpis').innerHTML = `
      <div class="kpi aviso"><div class="rotulo">Total por pagar</div>
        <div class="valor">${dinero(total)}</div><div class="nota">${entero(filas.length)} ticket(s)</div></div>
      <div class="kpi"><div class="rotulo">Premio mayor</div>
        <div class="valor">${dinero(mayor)}</div><div class="nota">un solo ticket</div></div>
      <div class="kpi"><div class="rotulo">Promedio</div>
        <div class="valor">${dinero(filas.length ? total / filas.length : 0)}</div>
        <div class="nota">por ticket ganador</div></div>`;

    cont.innerHTML = tabla(COLS, filas, {
      vacio: 'No hay premios pendientes en el periodo.',
      alHacerClick: true,
      pie: filas.length ? { codigo: 'TOTAL', premio_total: total, total: filas.reduce((s, f) => s + f.total, 0) } : null,
    });
    conectarFilas(cont, filas, async (f) => {
      try {
        const r2 = await api.get(`/tickets/${encodeURIComponent(f.codigo)}`);
        abrirTicket(r2.ticket, () => cargar());
      } catch (e) { error(e.message); }
    });
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}
