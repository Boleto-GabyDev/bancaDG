// Chequeo y pago de premios: se escribe el codigo del ticket y se paga.

import { api } from '../api.js';
import { $, esc, dinero, fechaCorta, error, exito, etiquetaEstado } from '../ui.js';
import { cuerpoTicket, pedirFormaDePago } from './_detalle-ticket.js';
import { imprimirComprobante, imprimirTicket } from '../ticket.js';

let vista, ticket = null;

export async function montar(raiz) {
  vista = raiz;
  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Pagar premio</h1></div>

    <div class="tarjeta">
      <div class="interior">
        <div class="fila">
          <label class="campo crece" style="max-width:340px">
            <span>Codigo del ticket</span>
            <input id="p-codigo" class="mono" style="font-size:1.3rem;letter-spacing:2px"
                   placeholder="001-0000123" autocomplete="off" autofocus>
          </label>
          <button class="grande" id="p-buscar">Chequear</button>
          <button class="sec" id="p-limpiar">Limpiar</button>
        </div>
        <p class="chico tenue" style="margin:8px 0 0">
          Escriba o escanee el codigo impreso en el ticket y presione Enter.
        </p>
      </div>
    </div>

    <div id="p-resultado"></div>`;

  $('#p-buscar').onclick = buscar;
  $('#p-limpiar').onclick = () => { $('#p-codigo').value = ''; $('#p-resultado').innerHTML = ''; $('#p-codigo').focus(); };
  $('#p-codigo').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } };
  $('#p-codigo').focus();
}

async function buscar() {
  const codigo = $('#p-codigo').value.trim();
  if (!codigo) return;
  const cont = $('#p-resultado');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await api.get(`/tickets/${encodeURIComponent(codigo)}/chequear`);
    ticket = r.ticket;
    pintar(r.ticket, r.resumen);
  } catch (e) {
    ticket = null;
    cont.innerHTML = `<div class="tarjeta"><div class="interior">
      <h2 class="texto-malo">No encontrado</h2>
      <p class="tenue">${esc(e.message)}</p></div></div>`;
  }
}

function pintar(t, resumen) {
  let banner = '';
  if (resumen.cobrable) {
    banner = `<div class="kpi ok" style="border-left-width:6px">
        <div class="rotulo">Ticket ganador - premio por pagar</div>
        <div class="valor" style="font-size:2.2rem">${dinero(t.premio_total)}</div>
        <div class="nota">Valido para cobro hasta ${fechaCorta(resumen.vence)}</div>
      </div>`;
  } else if (t.estado === 'pagado') {
    banner = `<div class="kpi"><div class="rotulo">Ya pagado</div>
        <div class="valor">${dinero(t.premio_total)}</div>
        <div class="nota">Pagado el ${esc(t.pagado_en)}</div></div>`;
  } else if (t.estado === 'cancelado') {
    banner = `<div class="kpi malo"><div class="rotulo">Ticket anulado</div>
        <div class="valor">Sin valor</div>
        <div class="nota">Anulado el ${esc(t.cancelado_en)}</div></div>`;
  } else if (resumen.jugadas_pendientes > 0) {
    banner = `<div class="kpi aviso"><div class="rotulo">En espera de resultados</div>
        <div class="valor">${resumen.jugadas_pendientes} jugada(s)</div>
        <div class="nota">Aun no se han publicado todos los sorteos de este ticket.</div></div>`;
  } else {
    banner = `<div class="kpi"><div class="rotulo">Sin premio</div>
        <div class="valor">${dinero(0)}</div>
        <div class="nota">Ninguna jugada resulto ganadora.</div></div>`;
  }

  $('#p-resultado').innerHTML = `
    <div style="margin-bottom:14px">${banner}</div>
    <div class="tarjeta">
      <header>Detalle del ticket ${esc(t.codigo)} ${etiquetaEstado(t.estado)}</header>
      <div class="interior">${cuerpoTicket(t)}</div>
      <div class="interior" style="border-top:1px solid var(--borde)">
        <div class="botonera">
          ${resumen.cobrable ? `<button class="ok grande" id="p-pagar">Pagar ${dinero(t.premio_total)}</button>` : ''}
          <button class="sec" id="p-reimprimir">Reimprimir ticket</button>
          ${t.estado === 'pagado' ? '<button class="sec" id="p-comprobante">Comprobante de pago</button>' : ''}
        </div>
      </div>
    </div>`;

  const bPagar = $('#p-pagar');
  if (bPagar) bPagar.onclick = () => pagar(t);
  $('#p-reimprimir').onclick = () => imprimirTicket(t, { copia: true });
  const bComp = $('#p-comprobante');
  if (bComp) bComp.onclick = () => imprimirComprobante(t);
}

async function pagar(t) {
  const forma = await pedirFormaDePago(t.premio_total, `Pagar ticket ${t.codigo}`);
  if (!forma) return;
  try {
    const r = await api.post(`/tickets/${encodeURIComponent(t.codigo)}/pagar`, forma);
    exito(`Premio pagado: ${dinero(r.ticket.premio_total)}.`);
    imprimirComprobante(r.ticket);
    const chequeo = await api.get(`/tickets/${encodeURIComponent(t.codigo)}/chequear`);
    pintar(chequeo.ticket, chequeo.resumen);
  } catch (e) {
    error(e.message, 'No se pudo pagar');
  }
}
