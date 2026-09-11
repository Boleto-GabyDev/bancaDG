// Consulta y administracion de tickets vendidos.

import { api } from '../api.js';
import { $, esc, dinero, fechaCorta, hoyISO, tabla, conectarFilas, etiquetaEstado, error, descargarCSV } from '../ui.js';
import { buscarYAbrir, abrirTicket } from './_detalle-ticket.js';
import { estado } from '../app.js';

let vista, filtros, filas = [];

export async function montar(raiz) {
  vista = raiz;
  filtros = { desde: hoyISO(), hasta: hoyISO(), estado: 'todos', codigo: '' };

  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Tickets</h1></div>

    <div class="tarjeta">
      <div class="interior">
        <div class="fila">
          <label class="campo" style="max-width:220px"><span>Buscar por codigo</span>
            <input id="t-codigo" placeholder="001-0000123" autocomplete="off"></label>
          <button id="t-buscar">Abrir ticket</button>
          <div class="crece"></div>
          <label class="campo" style="max-width:160px"><span>Desde</span>
            <input type="date" id="t-desde" value="${esc(filtros.desde)}"></label>
          <label class="campo" style="max-width:160px"><span>Hasta</span>
            <input type="date" id="t-hasta" value="${esc(filtros.hasta)}"></label>
          <label class="campo" style="max-width:170px"><span>Estado</span>
            <select id="t-estado">
              <option value="todos">Todos</option>
              <option value="activo">Activos</option>
              <option value="ganador">Ganadores</option>
              <option value="pagado">Pagados</option>
              <option value="perdedor">Perdedores</option>
              <option value="cancelado">Anulados</option>
            </select></label>
          <button class="sec" id="t-aplicar">Filtrar</button>
          <button class="sec" id="t-csv">Exportar</button>
        </div>
      </div>
    </div>

    <div class="tarjeta">
      <header><span id="t-conteo">Resultados</span></header>
      <div class="interior sin-padding" id="t-lista"></div>
    </div>`;

  $('#t-buscar').onclick = () => buscarYAbrir($('#t-codigo').value, () => cargar());
  $('#t-codigo').onkeydown = (e) => { if (e.key === 'Enter') $('#t-buscar').click(); };
  $('#t-aplicar').onclick = cargar;
  $('#t-csv').onclick = () => descargarCSV(`tickets_${filtros.desde}_${filtros.hasta}`, COLS_CSV, filas);
  ['t-desde', 't-hasta', 't-estado'].forEach((id) => { $(`#${id}`).onchange = cargar; });

  await cargar();
}

const COLS_CSV = [
  { k: 'codigo', t: 'Codigo' }, { k: 'fecha_sorteo', t: 'Sorteo' }, { k: 'creado_en', t: 'Emitido' },
  { k: 'vendedor', t: 'Cajero' }, { k: 'banca', t: 'Banca' }, { k: 'jugadas', t: 'Jugadas' },
  { k: 'total', t: 'Total' }, { k: 'estado', t: 'Estado' }, { k: 'premio_total', t: 'Premio' },
];

async function cargar() {
  filtros.desde = $('#t-desde').value;
  filtros.hasta = $('#t-hasta').value;
  filtros.estado = $('#t-estado').value;

  const cont = $('#t-lista');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await api.get('/tickets', { ...filtros, limite: 500 });
    filas = r.tickets;

    const cols = [
      { k: 'codigo', t: 'Codigo', fmt: (v) => `<b class="mono">${esc(v)}</b>` },
      { k: 'fecha_sorteo', t: 'Sorteo', fmt: (v) => fechaCorta(v) },
      { k: 'creado_en', t: 'Emitido', fmt: (v) => `<span class="chico tenue">${esc(String(v).slice(5, 16))}</span>` },
      { k: 'jugadas', t: 'Jug.', num: true },
      { k: 'vendedor', t: 'Cajero' },
      ...(estado.usuario.rol === 'admin' ? [{ k: 'banca', t: 'Banca' }] : []),
      { k: 'cliente', t: 'Cliente' },
      { k: 'metodo_pago', t: 'Cobro', fmt: (v, f) => v === 'transferencia'
          ? `<span class="etiqueta pendiente" title="${esc(f.referencia_pago || '')}">transf.</span>`
          : '<span class="etiqueta pagado">efectivo</span>' },
      { k: 'total', t: 'Total', num: true, fmt: (v) => dinero(v, false) },
      { k: 'estado', t: 'Estado', fmt: (v) => etiquetaEstado(v) },
      { k: 'premio_total', t: 'Premio', num: true, fmt: (v) => v > 0 ? `<b class="texto-ok">${dinero(v, false)}</b>` : '-' },
    ];

    const totales = {
      codigo: `${filas.length} ticket(s)`,
      total: filas.reduce((s, f) => s + f.total, 0),
      premio_total: filas.reduce((s, f) => s + f.premio_total, 0),
    };

    cont.innerHTML = tabla(cols, filas, {
      vacio: 'No hay tickets con esos filtros.',
      alHacerClick: true,
      pie: filas.length ? totales : null,
    });
    $('#t-conteo').textContent = `${filas.length} ticket(s) - venta ${dinero(totales.total || 0)}`;
    conectarFilas(cont, filas, verDetalle);
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

async function verDetalle(f) {
  const r = await api.get(`/tickets/${encodeURIComponent(f.codigo)}`);
  abrirTicket(r.ticket, () => cargar());
}
