// Bitacora de acciones sensibles: ventas, anulaciones, pagos y cambios de configuracion.

import { api } from '../api.js';
import { $, esc, hoyISO, tabla, error, descargarCSV } from '../ui.js';

let vista, filas = [], desde, hasta;

const COLORES = {
  login: 'activo', logout: 'perdedor', login_fallido: 'cancelado',
  venta: 'ganador', cancelacion: 'cancelado', pago_premio: 'pagado',
  resultado_registrado: 'activo', resultado_corregido: 'pendiente', resultado_eliminado: 'cancelado',
};

export async function montar(raiz) {
  vista = raiz;
  hasta = hoyISO();
  const [y, m, d] = hasta.split('-').map(Number);
  desde = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);

  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Auditoria</h1></div>

    <div class="tarjeta"><div class="interior">
      <div class="fila">
        <label class="campo" style="max-width:160px"><span>Desde</span>
          <input type="date" id="a-desde" value="${esc(desde)}"></label>
        <label class="campo" style="max-width:160px"><span>Hasta</span>
          <input type="date" id="a-hasta" value="${esc(hasta)}"></label>
        <label class="campo" style="max-width:200px"><span>Filtrar accion</span>
          <input id="a-filtro" placeholder="venta, pago, login..."></label>
        <button id="a-ver">Ver</button>
        <div class="crece"></div>
        <button class="sec" id="a-csv">Exportar</button>
      </div>
    </div></div>

    <div class="tarjeta">
      <header id="a-conteo">Movimientos</header>
      <div class="interior sin-padding" id="a-tabla"></div>
    </div>`;

  $('#a-ver').onclick = cargar;
  ['a-desde', 'a-hasta'].forEach((id) => { $(`#${id}`).onchange = cargar; });
  $('#a-filtro').oninput = pintar;
  $('#a-csv').onclick = () => descargarCSV(`auditoria_${desde}_${hasta}`, COLS, filas);

  await cargar();
}

const COLS = [
  { k: 'creado_en', t: 'Fecha y hora', fmt: (v) => `<span class="mono chico">${esc(v)}</span>` },
  { k: 'usuario', t: 'Usuario' },
  { k: 'accion', t: 'Accion', fmt: (v) => `<span class="etiqueta ${COLORES[v] || 'activo'}">${esc(String(v).replace(/_/g, ' '))}</span>` },
  { k: 'entidad', t: 'Entidad' },
  { k: 'entidad_id', t: 'Referencia', fmt: (v) => v ? `<b class="mono chico">${esc(v)}</b>` : '' },
  { k: 'detalle', t: 'Detalle', fmt: (v) => `<span class="chico">${esc(v)}</span>` },
  { k: 'ip', t: 'IP', fmt: (v) => `<span class="chico tenue">${esc(v)}</span>` },
];

async function cargar() {
  desde = $('#a-desde').value;
  hasta = $('#a-hasta').value;
  const cont = $('#a-tabla');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await api.get('/admin/auditoria', { desde, hasta, limite: 1000 });
    filas = r.auditoria;
    pintar();
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function pintar() {
  const f = ($('#a-filtro').value || '').toLowerCase().trim();
  const lista = f
    ? filas.filter((x) => `${x.accion} ${x.usuario} ${x.entidad} ${x.entidad_id} ${x.detalle}`.toLowerCase().includes(f))
    : filas;
  $('#a-conteo').textContent = `${lista.length} movimiento(s)`;
  $('#a-tabla').innerHTML = tabla(COLS, lista, { vacio: 'Sin movimientos en el periodo.' });
}
