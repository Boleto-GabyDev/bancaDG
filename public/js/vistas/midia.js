// Mi dia: lo unico que el cajero necesita saber de numeros, lo suyo.
//
// Se apoya en /reportes/cierre, que el servidor fuerza al usuario de la
// sesion cuando el rol es vendedor: no hay forma de pedir el dia de otro.

import { api } from '../api.js';
import { $, esc, dinero, entero, fechaCorta, hoyISO, error } from '../ui.js';
import { estado } from '../app.js';
import { imprimir } from '../ticket.js';

let vista, fecha, datos = null;

export async function montar(raiz) {
  vista = raiz;
  fecha = hoyISO();

  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Mi dia</h1></div>

    <div class="tarjeta"><div class="interior">
      <div class="fila">
        <label class="campo" style="max-width:170px"><span>Fecha</span>
          <input type="date" id="m-fecha" max="${esc(hoyISO())}" value="${esc(fecha)}"></label>
        <button id="m-ver">Ver</button>
      </div>
    </div></div>

    <div id="m-cuerpo"></div>`;

  $('#m-ver').onclick = cargar;
  $('#m-fecha').onchange = cargar;

  await cargar();
}

async function cargar() {
  fecha = $('#m-fecha').value || hoyISO();
  const cont = $('#m-cuerpo');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    datos = await api.get('/reportes/cierre', { fecha });
    pintar();
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function pintar() {
  const d = datos;
  const kpi = (clase, rotulo, valor, nota) =>
    `<div class="kpi ${clase}"><div class="rotulo">${rotulo}</div><div class="valor">${valor}</div><div class="nota">${nota || ''}</div></div>`;

  $('#m-cuerpo').innerHTML = `
    <div class="rejilla c4" style="margin-bottom:14px">
      ${kpi('ok', 'Facturado', dinero(d.venta), `${entero(d.tickets)} tickets vendidos`)}
      ${kpi('', 'En efectivo', dinero(d.venta_efectivo), 'cobrado en la gaveta')}
      ${kpi('', 'Por transferencia', dinero(d.venta_transferencia), 'no pasa por la gaveta')}
      ${kpi('aviso', 'Mi comision', dinero(d.comision), `${d.usuario.comision_pct}% de lo facturado`)}
    </div>

    <div class="tarjeta">
      <header>Resumen de ${esc(d.usuario.nombre)} - ${fechaCorta(d.fecha)}</header>
      <div class="interior">
        <table class="tabla" style="max-width:520px">
          <tbody>
            <tr><td>Tickets vendidos</td><td class="num">${entero(d.tickets)}</td></tr>
            <tr><td>Facturado en efectivo</td><td class="num">${dinero(d.venta_efectivo)}</td></tr>
            <tr><td>Facturado por transferencia</td><td class="num">${dinero(d.venta_transferencia)}</td></tr>
            <tr style="border-top:2px solid var(--borde-fuerte)">
              <td><b>Total facturado</b></td>
              <td class="num"><b style="font-size:1.2rem">${dinero(d.venta)}</b></td></tr>
            <tr><td class="tenue">Mi comision (${d.usuario.comision_pct}%)</td>
                <td class="num tenue">${dinero(d.comision)}</td></tr>
          </tbody>
        </table>

        <p class="chico tenue" style="margin-top:12px">
          Los premios se cobran y se cuadran en la banca. Si un cliente viene a cobrar,
          pase el ticket al encargado.
        </p>

        <div class="botonera">
          <button class="sec" id="m-imprimir">Imprimir resumen</button>
        </div>
      </div>
    </div>`;

  $('#m-imprimir').onclick = () => imprimir(reciboHTML(datos));
}

function reciboHTML(d) {
  const c = estado.config || {};
  return `<div class="ticket58">
    <div class="cab">
      <div class="nombre">${esc(c.empresa_nombre || 'Banca DG')}</div>
      <div class="sub">RESUMEN DEL DIA</div>
      <div class="sub">${esc(d.usuario.banca || '')}</div>
    </div>
    <div class="sep"></div>
    <div class="kv"><span>Cajero:</span><span>${esc(d.usuario.nombre)}</span></div>
    <div class="kv"><span>Fecha:</span><span>${fechaCorta(d.fecha)}</span></div>
    <div class="kv"><span>Tickets:</span><span>${entero(d.tickets)}</span></div>
    <div class="sep"></div>
    <div class="kv"><span>Efectivo</span><span>${dinero(d.venta_efectivo, false)}</span></div>
    <div class="kv"><span>Transferencia</span><span>${dinero(d.venta_transferencia, false)}</span></div>
    <div class="sep"></div>
    <div class="total"><span>FACTURADO</span><span>${dinero(d.venta, false)}</span></div>
    <div class="sep"></div>
    <div class="kv" style="font-size:9.5px"><span>Comision ${d.usuario.comision_pct}%</span><span>${dinero(d.comision, false)}</span></div>
    <div class="pie" style="margin-top:10px">Documento informativo.<br>El cuadre de caja lo firma la banca.</div>
  </div>`;
}
