// Cierre de caja diario por cajero.

import { api } from '../api.js';
import { $, esc, dinero, entero, fechaCorta, hoyISO, error, exito, confirmar } from '../ui.js';
import { estado } from '../app.js';
import { imprimir } from '../ticket.js';

let vista, fecha, usuarioId = '', datos = null;

export async function montar(raiz) {
  vista = raiz;
  fecha = hoyISO();
  usuarioId = String(estado.usuario.id);

  let selector = '';
  if (estado.usuario.rol !== 'vendedor') {
    const v = await api.get('/catalogo/vendedores').catch(() => ({ vendedores: [] }));
    selector = `<label class="campo" style="max-width:240px"><span>Cajero</span>
      <select id="c-usuario">
        ${v.vendedores.map((x) => `<option value="${x.id}" ${String(x.id) === usuarioId ? 'selected' : ''}>${esc(x.nombre)} (${esc(x.usuario)})</option>`).join('')}
      </select></label>`;
  }

  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Cierre de caja</h1></div>

    <div class="tarjeta"><div class="interior">
      <div class="fila">
        <label class="campo" style="max-width:170px"><span>Fecha</span>
          <input type="date" id="c-fecha" value="${esc(fecha)}"></label>
        ${selector}
        <button id="c-ver">Ver</button>
      </div>
    </div></div>

    <div id="c-cuerpo"></div>`;

  $('#c-ver').onclick = cargar;
  $('#c-fecha').onchange = cargar;
  if ($('#c-usuario')) $('#c-usuario').onchange = cargar;

  await cargar();
}

async function cargar() {
  fecha = $('#c-fecha').value;
  usuarioId = $('#c-usuario')?.value || String(estado.usuario.id);
  const cont = $('#c-cuerpo');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    datos = await api.get('/reportes/cierre', { fecha, usuario_id: usuarioId });
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

  $('#c-cuerpo').innerHTML = `
    <div class="rejilla c4" style="margin-bottom:14px">
      ${kpi('', 'Venta', dinero(d.venta), `${entero(d.tickets)} tickets`)}
      ${kpi('malo', 'Premios', dinero(d.premios), `pagados ${dinero(d.pagado)}`)}
      ${kpi('aviso', 'Comision', dinero(d.comision), `${d.usuario.comision_pct}% de la venta`)}
      ${kpi(d.balance >= 0 ? 'ok' : 'malo', 'Balance', dinero(d.balance), 'venta - premios - comision')}
    </div>

    <div class="tarjeta">
      <header>
        Cierre de ${esc(d.usuario.nombre)} - ${fechaCorta(d.fecha)}
        ${d.cerrado ? '<span class="etiqueta pagado">cerrado</span>' : '<span class="etiqueta pendiente">abierto</span>'}
      </header>
      <div class="interior">
        <table class="tabla" style="max-width:560px">
          <tbody>
            <tr><td colspan="2" class="fuerte" style="background:var(--superficie-2)">Dinero en la gaveta</td></tr>
            <tr><td>Venta cobrada en efectivo</td><td class="num">${dinero(d.venta_efectivo)}</td></tr>
            <tr><td>Premios entregados en efectivo</td><td class="num">- ${dinero(d.pagado_efectivo)}</td></tr>
            <tr><td>Comision del cajero (${d.usuario.comision_pct}%)</td><td class="num">- ${dinero(d.comision)}</td></tr>
            <tr style="border-top:2px solid var(--borde-fuerte)">
              <td><b>Efectivo a entregar</b></td>
              <td class="num"><b style="font-size:1.2rem">${dinero(d.entregar)}</b></td></tr>

            <tr><td colspan="2" class="fuerte" style="background:var(--superficie-2);padding-top:14px">
              No pasa por la gaveta</td></tr>
            <tr><td class="tenue">Venta cobrada por transferencia</td>
                <td class="num tenue">${dinero(d.venta_transferencia)}</td></tr>
            <tr><td class="tenue">Premios pagados por transferencia</td>
                <td class="num tenue">${dinero(d.pagado - d.pagado_efectivo)}</td></tr>
            <tr><td class="tenue">Premios ganados aun sin cobrar</td>
                <td class="num tenue">${dinero(d.premios - d.pagado)}</td></tr>

            <tr><td colspan="2" class="fuerte" style="background:var(--superficie-2);padding-top:14px">
              Resultado del dia</td></tr>
            <tr><td>Venta total</td><td class="num">${dinero(d.venta)}</td></tr>
            <tr><td>Premios totales</td><td class="num">- ${dinero(d.premios)}</td></tr>
            <tr><td><b>Balance contable</b></td>
                <td class="num"><b class="${d.balance >= 0 ? 'texto-ok' : 'texto-malo'}">${dinero(d.balance)}</b></td></tr>
          </tbody>
        </table>

        ${d.cerrado ? `<p class="chico tenue" style="margin-top:12px">
          Cerrado el ${esc(d.cierre.cerrado_en)}. ${d.cierre.notas ? 'Nota: ' + esc(d.cierre.notas) : ''}
        </p>` : ''}

        <div class="separador"></div>
        <label class="campo"><span>Notas del cierre</span>
          <input id="c-notas" maxlength="300" value="${esc(d.cierre?.notas || '')}" placeholder="Observaciones, faltantes, etc."></label>

        <div class="botonera">
          <button id="c-guardar">${d.cerrado ? 'Actualizar cierre' : 'Cerrar caja'}</button>
          <button class="sec" id="c-imprimir">Imprimir cierre</button>
        </div>
      </div>
    </div>`;

  $('#c-guardar').onclick = guardar;
  $('#c-imprimir').onclick = () => imprimir(reciboHTML(datos));
}

async function guardar() {
  const notas = $('#c-notas').value.trim();
  const ok = await confirmar(
    `¿Registrar el cierre de ${datos.usuario.nombre} del ${fechaCorta(datos.fecha)} con ${dinero(datos.entregar)} a entregar?`,
    'Cerrar caja', 'Si, cerrar', 'ok');
  if (!ok) return;
  try {
    const r = await api.post('/reportes/cierre', { fecha: datos.fecha, usuario_id: datos.usuario.id, notas });
    datos = r.cierre;
    exito('Cierre registrado.');
    pintar();
    imprimir(reciboHTML(datos));
  } catch (e) {
    error(e.message);
  }
}

function reciboHTML(d) {
  const c = estado.config || {};
  return `<div class="ticket58">
    <div class="cab">
      <div class="nombre">${esc(c.empresa_nombre || 'Banca DG')}</div>
      <div class="sub">CIERRE DE CAJA</div>
      <div class="sub">${esc(d.usuario.banca || '')}</div>
    </div>
    <div class="sep"></div>
    <div class="kv"><span>Cajero:</span><span>${esc(d.usuario.nombre)}</span></div>
    <div class="kv"><span>Fecha:</span><span>${fechaCorta(d.fecha)}</span></div>
    <div class="kv"><span>Tickets:</span><span>${entero(d.tickets)}</span></div>
    <div class="sep"></div>
    <div class="kv"><span>Venta efectivo</span><span>${dinero(d.venta_efectivo, false)}</span></div>
    <div class="kv"><span>Premios efectivo</span><span>-${dinero(d.pagado_efectivo, false)}</span></div>
    <div class="kv"><span>Comision ${d.usuario.comision_pct}%</span><span>-${dinero(d.comision, false)}</span></div>
    <div class="sep"></div>
    <div class="total"><span>ENTREGAR</span><span>${dinero(d.entregar, false)}</span></div>
    <div class="sep"></div>
    <div class="kv" style="font-size:9.5px"><span>Venta transferencia</span><span>${dinero(d.venta_transferencia, false)}</span></div>
    <div class="kv" style="font-size:9.5px"><span>Venta total</span><span>${dinero(d.venta, false)}</span></div>
    <div class="kv" style="font-size:9.5px"><span>Premios sin cobrar</span><span>${dinero(d.premios - d.pagado, false)}</span></div>
    <div class="kv" style="font-size:9.5px"><span>Balance del dia</span><span>${dinero(d.balance, false)}</span></div>
    ${d.cierre?.notas ? `<div class="pie">${esc(d.cierre.notas)}</div>` : ''}
    <div class="pie" style="margin-top:10px">Recibido por<br><br>____________________</div>
  </div>`;
}
