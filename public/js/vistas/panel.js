// Tablero: la foto del dia en una sola pantalla.

import { api } from '../api.js';
import { $, esc, dinero, entero, fechaCorta, hoyISO, tabla, error } from '../ui.js';
import { irA } from '../app.js';

let vista, desde, hasta;

export async function montar(raiz) {
  vista = raiz;
  desde = hoyISO();
  hasta = hoyISO();

  vista.innerHTML = `
    <div class="cabecera-vista">
      <h1>Tablero</h1>
      <div class="crece"></div>
      <div class="botonera">
        <button class="sec chico" data-rango="hoy">Hoy</button>
        <button class="sec chico" data-rango="7">7 dias</button>
        <button class="sec chico" data-rango="30">30 dias</button>
        <button class="sec chico" data-rango="mes">Este mes</button>
      </div>
      <label class="campo" style="margin:0;max-width:150px"><span>Desde</span>
        <input type="date" id="p-desde" value="${esc(desde)}"></label>
      <label class="campo" style="margin:0;max-width:150px"><span>Hasta</span>
        <input type="date" id="p-hasta" value="${esc(hasta)}"></label>
      <button id="p-aplicar">Ver</button>
    </div>
    <div id="p-cuerpo"></div>`;

  $('#p-aplicar').onclick = () => { desde = $('#p-desde').value; hasta = $('#p-hasta').value; cargar(); };
  vista.querySelectorAll('[data-rango]').forEach((b) => {
    b.onclick = () => {
      const hoy = hoyISO();
      const r = b.dataset.rango;
      if (r === 'hoy') { desde = hoy; hasta = hoy; }
      else if (r === 'mes') { desde = `${hoy.slice(0, 7)}-01`; hasta = hoy; }
      else {
        const [y, m, d] = hoy.split('-').map(Number);
        desde = new Date(Date.UTC(y, m - 1, d - (Number(r) - 1))).toISOString().slice(0, 10);
        hasta = hoy;
      }
      $('#p-desde').value = desde;
      $('#p-hasta').value = hasta;
      cargar();
    };
  });

  await cargar();
}

async function cargar() {
  const cont = $('#p-cuerpo');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const d = await api.get('/reportes/panel', { desde, hasta });
    pintar(d);
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function pintar(d) {
  const r = d.resumen;
  const margen = r.venta > 0 ? (r.balance / r.venta) * 100 : 0;

  const kpi = (clase, rotulo, valor, nota) => `
    <div class="kpi ${clase}">
      <div class="rotulo">${esc(rotulo)}</div>
      <div class="valor">${valor}</div>
      <div class="nota">${nota || ''}</div>
    </div>`;

  const colsVenta = (etiquetaKey, etiqueta) => [
    { k: etiquetaKey, t: etiqueta },
    { k: 'venta', t: 'Venta', num: true, fmt: (v) => dinero(v, false) },
    { k: 'premios', t: 'Premios', num: true, fmt: (v) => dinero(v, false) },
    { k: 'balance', t: 'Balance', num: true, fmt: (v) => `<b class="${v >= 0 ? 'texto-ok' : 'texto-malo'}">${dinero(v, false)}</b>` },
  ];

  $('#p-cuerpo').innerHTML = `
    <div class="rejilla c4" style="margin-bottom:14px">
      ${kpi('', 'Venta', dinero(r.venta),
        `${entero(r.tickets)} tickets / ${entero(r.jugadas)} jugadas<br>` +
        `efectivo ${dinero(r.venta_efectivo)} &middot; transf. ${dinero(r.venta_transferencia)}`)}
      ${kpi('malo', 'Premios', dinero(r.premios), `${entero(r.ganadores)} ticket(s) ganador(es)`)}
      ${kpi('aviso', 'Comision', dinero(r.comision), 'Pagada a los cajeros')}
      ${kpi(r.balance >= 0 ? 'ok' : 'malo', 'Balance', dinero(r.balance), `Margen ${margen.toFixed(1)}%`)}
    </div>

    <div class="rejilla c4" style="margin-bottom:14px">
      ${kpi('aviso', 'Por pagar', dinero(r.por_pagar), 'Premios ganados sin cobrar')}
      ${kpi('', 'Pagado', dinero(r.pagado), 'Premios ya entregados')}
      ${kpi('', 'Pendientes', entero(r.pendientes), 'Tickets esperando resultados')}
      ${kpi('', 'Anulados', entero(r.cancelados), dinero(r.monto_cancelado))}
    </div>

    <div class="rejilla c2">
      <div class="tarjeta">
        <header>Venta por loteria</header>
        <div class="interior sin-padding">${tabla(colsVenta('loteria', 'Loteria'), d.loteria, { vacio: 'Sin ventas en el periodo.' })}</div>
      </div>
      <div class="tarjeta">
        <header>Venta por tipo de jugada</header>
        <div class="interior sin-padding">${tabla(colsVenta('tipo', 'Tipo'), d.tipo, { vacio: 'Sin ventas en el periodo.' })}</div>
      </div>
    </div>

    <div class="rejilla c2">
      <div class="tarjeta">
        <header>Dia por dia</header>
        <div class="interior sin-padding">${tabla([
          { k: 'fecha', t: 'Fecha', fmt: (v) => fechaCorta(v) },
          { k: 'tickets', t: 'Tickets', num: true, fmt: (v) => entero(v) },
          { k: 'venta', t: 'Venta', num: true, fmt: (v) => dinero(v, false) },
          { k: 'premios', t: 'Premios', num: true, fmt: (v) => dinero(v, false) },
          { k: 'balance', t: 'Balance', num: true, fmt: (v) => `<b class="${v >= 0 ? 'texto-ok' : 'texto-malo'}">${dinero(v, false)}</b>` },
        ], d.dia, { vacio: 'Sin movimientos.' })}</div>
      </div>

      ${d.vendedor.length ? `<div class="tarjeta">
        <header>Por cajero</header>
        <div class="interior sin-padding">${tabla([
          { k: 'nombre', t: 'Cajero' },
          { k: 'tickets', t: 'Tickets', num: true, fmt: (v) => entero(v) },
          { k: 'venta', t: 'Venta', num: true, fmt: (v) => dinero(v, false) },
          { k: 'comision', t: 'Comision', num: true, fmt: (v) => dinero(v, false) },
          { k: 'balance', t: 'Balance', num: true, fmt: (v) => `<b class="${v >= 0 ? 'texto-ok' : 'texto-malo'}">${dinero(v, false)}</b>` },
        ], d.vendedor, { vacio: 'Sin ventas.' })}</div>
      </div>` : ''}
    </div>

    ${d.banca.length > 1 ? `<div class="tarjeta">
      <header>Por banca</header>
      <div class="interior sin-padding">${tabla([
        { k: 'codigo', t: 'Codigo' },
        { k: 'banca', t: 'Banca' },
        { k: 'tickets', t: 'Tickets', num: true, fmt: (v) => entero(v) },
        { k: 'venta', t: 'Venta', num: true, fmt: (v) => dinero(v, false) },
        { k: 'premios', t: 'Premios', num: true, fmt: (v) => dinero(v, false) },
        { k: 'balance', t: 'Balance', num: true, fmt: (v) => `<b class="${v >= 0 ? 'texto-ok' : 'texto-malo'}">${dinero(v, false)}</b>` },
      ], d.banca, { vacio: 'Sin datos.' })}</div>
    </div>` : ''}

    <div class="botonera" style="margin-top:12px">
      <button class="sec" id="p-ir-riesgo">Ver riesgo del dia</button>
      <button class="sec" id="p-ir-pagos">Premios por pagar</button>
      <button class="sec" id="p-ir-reportes">Reportes detallados</button>
    </div>`;

  $('#p-ir-riesgo').onclick = () => irA('riesgo');
  $('#p-ir-pagos').onclick = () => irA('pagos');
  $('#p-ir-reportes').onclick = () => irA('reportes');
}
