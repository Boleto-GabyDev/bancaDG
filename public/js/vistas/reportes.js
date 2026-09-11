// Reportes detallados con exportacion a CSV.

import { api } from '../api.js';
import { $, $$, esc, dinero, entero, fechaCorta, hoyISO, tabla, error, descargarCSV } from '../ui.js';
import { estado } from '../app.js';

const dineroCol = (k, t) => ({ k, t, num: true, fmt: (v) => dinero(v, false) });
const balanceCol = { k: 'balance', t: 'Balance', num: true,
  fmt: (v) => `<b class="${v >= 0 ? 'texto-ok' : 'texto-malo'}">${dinero(v, false)}</b>` };

const REPORTES = {
  dia: {
    titulo: 'Por dia', ruta: '/reportes/dia',
    cols: [{ k: 'fecha', t: 'Fecha', fmt: (v) => fechaCorta(v) },
           { k: 'tickets', t: 'Tickets', num: true, fmt: entero },
           dineroCol('venta', 'Venta'), dineroCol('premios', 'Premios'), balanceCol],
  },
  loteria: {
    titulo: 'Por loteria', ruta: '/reportes/loteria',
    cols: [{ k: 'loteria', t: 'Loteria' },
           { k: 'jugadas', t: 'Jugadas', num: true, fmt: entero },
           dineroCol('venta', 'Venta'), dineroCol('premios', 'Premios'), balanceCol],
  },
  tipo: {
    titulo: 'Por tipo de jugada', ruta: '/reportes/tipo',
    cols: [{ k: 'tipo', t: 'Tipo' },
           { k: 'jugadas', t: 'Jugadas', num: true, fmt: entero },
           dineroCol('venta', 'Venta'), dineroCol('premios', 'Premios'), balanceCol],
  },
  vendedor: {
    titulo: 'Por cajero', ruta: '/reportes/vendedor', roles: ['admin', 'banca'],
    cols: [{ k: 'nombre', t: 'Cajero' }, { k: 'usuario', t: 'Usuario' }, { k: 'banca', t: 'Banca' },
           { k: 'tickets', t: 'Tickets', num: true, fmt: entero },
           dineroCol('venta', 'Venta'), dineroCol('premios', 'Premios'),
           { k: 'comision_pct', t: '% Com.', num: true, fmt: (v) => `${v}%` },
           dineroCol('comision', 'Comision'), balanceCol],
  },
  banca: {
    titulo: 'Por banca', ruta: '/reportes/banca', roles: ['admin'],
    cols: [{ k: 'codigo', t: 'Codigo' }, { k: 'banca', t: 'Banca' },
           { k: 'tickets', t: 'Tickets', num: true, fmt: entero },
           dineroCol('venta', 'Venta'), dineroCol('premios', 'Premios'), balanceCol],
  },
  pendientes: {
    titulo: 'Premios sin cobrar', ruta: '/reportes/pendientes',
    cols: [{ k: 'codigo', t: 'Ticket', fmt: (v) => `<b class="mono">${esc(v)}</b>` },
           { k: 'fecha_sorteo', t: 'Sorteo', fmt: (v) => fechaCorta(v) },
           { k: 'vendedor', t: 'Cajero' }, { k: 'cliente', t: 'Cliente' },
           dineroCol('total', 'Apostado'), dineroCol('premio_total', 'Premio')],
  },
};

let vista, actual = 'dia', desde, hasta, filas = [], filtroUsuario = '', filtroBanca = '';

export async function montar(raiz) {
  vista = raiz;
  desde = hoyISO();
  hasta = hoyISO();

  const disponibles = Object.entries(REPORTES).filter(([, r]) =>
    !r.roles || r.roles.includes(estado.usuario.rol));

  let extraFiltros = '';
  if (estado.usuario.rol !== 'vendedor') {
    const v = await api.get('/catalogo/vendedores').catch(() => ({ vendedores: [] }));
    extraFiltros += `<label class="campo" style="max-width:190px"><span>Cajero</span>
      <select id="f-usuario"><option value="">Todos</option>
      ${v.vendedores.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}
      </select></label>`;
  }
  if (estado.usuario.rol === 'admin') {
    const b = await api.get('/catalogo/bancas').catch(() => ({ bancas: [] }));
    extraFiltros += `<label class="campo" style="max-width:190px"><span>Banca</span>
      <select id="f-banca"><option value="">Todas</option>
      ${b.bancas.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}
      </select></label>`;
  }

  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Reportes</h1></div>

    <div class="tarjeta"><div class="interior">
      <div class="fila">
        <label class="campo" style="max-width:160px"><span>Desde</span>
          <input type="date" id="f-desde" value="${esc(desde)}"></label>
        <label class="campo" style="max-width:160px"><span>Hasta</span>
          <input type="date" id="f-hasta" value="${esc(hasta)}"></label>
        ${extraFiltros}
        <button id="f-aplicar">Aplicar</button>
        <div class="crece"></div>
        <button class="sec" id="f-csv">Exportar CSV</button>
        <button class="sec" id="f-imprimir">Imprimir</button>
      </div>
    </div></div>

    <div id="rep-resumen" class="rejilla c4" style="margin-bottom:14px"></div>

    <div class="pestanas" id="rep-pestanas">
      ${disponibles.map(([k, r]) => `<button data-rep="${k}" class="${k === actual ? 'activo' : ''}">${esc(r.titulo)}</button>`).join('')}
    </div>

    <div class="tarjeta">
      <header id="rep-titulo">${esc(REPORTES[actual].titulo)}</header>
      <div class="interior sin-padding" id="rep-tabla"></div>
    </div>`;

  $('#f-aplicar').onclick = aplicar;
  $('#f-csv').onclick = () => descargarCSV(`${actual}_${desde}_${hasta}`, REPORTES[actual].cols, filas);
  $('#f-imprimir').onclick = () => window.print();
  $$('#rep-pestanas button').forEach((b) => {
    b.onclick = () => {
      actual = b.dataset.rep;
      $$('#rep-pestanas button').forEach((x) => x.classList.toggle('activo', x === b));
      $('#rep-titulo').textContent = REPORTES[actual].titulo;
      cargarTabla();
    };
  });

  await aplicar();
}

function leerFiltros() {
  desde = $('#f-desde').value;
  hasta = $('#f-hasta').value;
  filtroUsuario = $('#f-usuario')?.value || '';
  filtroBanca = $('#f-banca')?.value || '';
  return { desde, hasta, usuario_id: filtroUsuario, banca_id: filtroBanca };
}

async function aplicar() {
  await Promise.all([cargarResumen(), cargarTabla()]);
}

async function cargarResumen() {
  const cont = $('#rep-resumen');
  try {
    const r = await api.get('/reportes/resumen', leerFiltros());
    const kpi = (clase, rotulo, valor, nota) =>
      `<div class="kpi ${clase}"><div class="rotulo">${rotulo}</div><div class="valor">${valor}</div><div class="nota">${nota}</div></div>`;
    cont.innerHTML =
      kpi('', 'Venta', dinero(r.venta), `${entero(r.tickets)} tickets`) +
      kpi('malo', 'Premios', dinero(r.premios), `pagado ${dinero(r.pagado)}`) +
      kpi('aviso', 'Comision', dinero(r.comision), `por pagar ${dinero(r.por_pagar)}`) +
      kpi(r.balance >= 0 ? 'ok' : 'malo', 'Balance', dinero(r.balance), `${fechaCorta(r.desde)} a ${fechaCorta(r.hasta)}`);
  } catch (e) {
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

async function cargarTabla() {
  const cont = $('#rep-tabla');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  const def = REPORTES[actual];
  try {
    const r = await api.get(def.ruta, leerFiltros());
    filas = r.filas || [];
    const pie = {};
    for (const c of def.cols) {
      if (c.num && ['venta', 'premios', 'balance', 'comision', 'tickets', 'jugadas', 'total', 'premio_total'].includes(c.k)) {
        pie[c.k] = filas.reduce((s, f) => s + (Number(f[c.k]) || 0), 0);
      }
    }
    pie[def.cols[0].k] = 'TOTAL';
    cont.innerHTML = tabla(def.cols, filas, { vacio: 'Sin datos en el periodo.', pie: filas.length ? pie : null });
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}
