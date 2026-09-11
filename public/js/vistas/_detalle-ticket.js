// Ventana de detalle de un ticket, compartida por varias vistas.

import { api } from '../api.js';
import { esc, dinero, fechaCorta, modal, confirmar, exito, error, etiquetaEstado } from '../ui.js';
import { imprimirTicket, imprimirComprobante } from '../ticket.js';
import { estado } from '../app.js';

const ABREV = { quiniela: 'Quiniela', pale: 'Pale', tripleta: 'Tripleta', superpale: 'Super Pale' };

/**
 * Pregunta como se entrega el premio. Devuelve {metodo_pago, referencia_pago}
 * o null si el cajero cancela.
 */
export function pedirFormaDePago(monto, titulo = 'Pagar premio') {
  return new Promise((resolve) => {
    let decidido = false;
    const cuerpo = document.createElement('div');
    cuerpo.innerHTML = `
      <div class="kpi ok" style="margin-bottom:14px">
        <div class="rotulo">Monto a entregar</div>
        <div class="valor">${dinero(monto)}</div>
      </div>
      <span style="display:block;font-size:.78rem;font-weight:650;color:var(--texto-2);
                   margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Forma de entrega</span>
      <div class="cobro-opciones">
        <label class="cobro"><input type="radio" name="mpremio" value="efectivo" checked> Efectivo</label>
        <label class="cobro"><input type="radio" name="mpremio" value="transferencia"> Transferencia</label>
      </div>
      <label class="campo oculto" id="mp-ref" style="margin-top:10px">
        <span>Numero de referencia</span>
        <input id="mp-referencia" maxlength="60" placeholder="Confirmacion de la transferencia">
      </label>`;

    const m = modal({
      titulo,
      cuerpo,
      alCerrar: () => { if (!decidido) resolve(null); },
      botones: [
        { texto: 'Cancelar', clase: 'sec', alHacerClick: () => { decidido = true; resolve(null); } },
        {
          texto: 'Confirmar pago', clase: 'ok',
          alHacerClick: () => {
            const metodo = cuerpo.querySelector('input[name="mpremio"]:checked').value;
            const referencia = cuerpo.querySelector('#mp-referencia').value.trim();
            if (metodo === 'transferencia' && !referencia) {
              error('Escriba el numero de referencia de la transferencia.');
              cuerpo.querySelector('#mp-referencia').focus();
              return false;
            }
            decidido = true;
            resolve({ metodo_pago: metodo, referencia_pago: referencia });
          },
        },
      ],
    });

    cuerpo.querySelectorAll('input[name="mpremio"]').forEach((r) => {
      r.onchange = () => {
        const esTransferencia = r.value === 'transferencia' && r.checked;
        cuerpo.querySelector('#mp-ref').classList.toggle('oculto', !esTransferencia);
        if (esTransferencia) cuerpo.querySelector('#mp-referencia').focus();
      };
    });

    return m;
  });
}

export function cuerpoTicket(t) {
  const res = new Map(t.resultados.map((r) => [r.loteria_id, r]));

  const filas = t.jugadas.map((j) => {
    const r = res.get(j.loteria_id);
    const salidos = r ? `${r.primera} - ${r.segunda} - ${r.tercera}` : '<span class="tenue">pendiente</span>';
    const clase = j.estado === 'ganadora' ? 'texto-ok' : j.estado === 'perdedora' ? 'tenue' : '';
    return `<tr>
      <td><span class="pill-num">${esc(j.numeros)}</span></td>
      <td>${esc(ABREV[j.tipo] || j.tipo)}</td>
      <td>${esc(j.loteria)}${j.loteria2 ? ` <span class="tenue">+ ${esc(j.loteria2)}</span>` : ''}</td>
      <td class="mono chico">${salidos}</td>
      <td class="num">${dinero(j.monto, false)}</td>
      <td class="${clase}">${esc(j.detalle || j.estado)}</td>
      <td class="num ${clase}">${j.premio > 0 ? dinero(j.premio, false) : '-'}</td>
    </tr>`;
  }).join('');

  return `
    <div class="rejilla c2" style="margin-bottom:12px">
      <div>
        <div><span class="tenue">Ticket:</span> <b class="mono">${esc(t.codigo)}</b> ${etiquetaEstado(t.estado)}</div>
        <div><span class="tenue">Sorteo:</span> <b>${fechaCorta(t.fecha_sorteo)}</b></div>
        <div><span class="tenue">Emitido:</span> ${esc(t.creado_en)}</div>
        <div><span class="tenue">PIN:</span> <b class="mono">${esc(t.pin)}</b></div>
      </div>
      <div>
        <div><span class="tenue">Banca:</span> ${esc(t.banca_nombre)}</div>
        <div><span class="tenue">Cajero:</span> ${esc(t.vendedor)}</div>
        ${t.cliente ? `<div><span class="tenue">Cliente:</span> ${esc(t.cliente)}</div>` : ''}
        ${t.cancelado_en ? `<div class="texto-malo">Anulado: ${esc(t.cancelado_en)}</div>` : ''}
        ${t.pagado_en ? `<div class="texto-ok">Pagado: ${esc(t.pagado_en)}</div>` : ''}
      </div>
    </div>

    <div class="tabla-env">
      <table class="tabla">
        <thead><tr>
          <th>Numero</th><th>Tipo</th><th>Loteria</th><th>Resultado</th>
          <th class="num">Monto</th><th>Estado</th><th class="num">Premio</th>
        </tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr>
          <td colspan="4">TOTALES</td>
          <td class="num">${dinero(t.total, false)}</td>
          <td></td>
          <td class="num">${dinero(t.premio_total, false)}</td>
        </tr></tfoot>
      </table>
    </div>

    ${t.estado === 'ganador' ? `<div class="kpi ok" style="margin-top:12px">
        <div class="rotulo">Premio por pagar</div>
        <div class="valor">${dinero(t.premio_total)}</div>
      </div>` : ''}`;
}

/**
 * Abre el detalle. `alCambiar` se llama si el ticket se anula o se paga.
 */
export function abrirTicket(t, alCambiar = null) {
  const u = estado.usuario;
  const botones = [];

  botones.push({
    texto: 'Reimprimir', clase: 'sec', cierra: false,
    alHacerClick: () => imprimirTicket(t, { copia: true }),
  });

  if (t.estado === 'pagado') {
    botones.push({
      texto: 'Comprobante', clase: 'sec', cierra: false,
      alHacerClick: () => imprimirComprobante(t),
    });
  }

  if (t.estado === 'activo' || t.estado === 'perdedor') {
    botones.push({
      texto: 'Anular', clase: 'malo',
      alHacerClick: async ({ cerrar }) => {
        const ok = await confirmar(`¿Anular el ticket ${t.codigo} por ${dinero(t.total)}?`, 'Anular ticket');
        if (!ok) return false;
        try {
          const r = await api.post(`/tickets/${encodeURIComponent(t.codigo)}/cancelar`);
          exito(`Ticket ${t.codigo} anulado.`);
          cerrar();
          if (alCambiar) alCambiar(r.ticket);
        } catch (e) { error(e.message); return false; }
      },
    });
  }

  if (t.estado === 'ganador' && ['admin', 'banca', 'vendedor'].includes(u.rol)) {
    botones.push({
      texto: `Pagar ${dinero(t.premio_total)}`, clase: 'ok',
      alHacerClick: async ({ cerrar }) => {
        const forma = await pedirFormaDePago(t.premio_total, `Pagar ticket ${t.codigo}`);
        if (!forma) return false;
        try {
          const r = await api.post(`/tickets/${encodeURIComponent(t.codigo)}/pagar`, forma);
          exito(`Premio pagado: ${dinero(r.ticket.premio_total)}.`);
          imprimirComprobante(r.ticket);
          cerrar();
          if (alCambiar) alCambiar(r.ticket);
        } catch (e) { error(e.message); return false; }
      },
    });
  }

  botones.push({ texto: 'Cerrar', clase: 'sec' });

  return modal({ titulo: `Ticket ${t.codigo}`, cuerpo: cuerpoTicket(t), botones, ancho: true });
}

/** Busca por codigo y abre el detalle. */
export async function buscarYAbrir(codigo, alCambiar) {
  const limpio = String(codigo || '').trim();
  if (!limpio) return;
  try {
    const r = await api.get(`/tickets/${encodeURIComponent(limpio)}`);
    abrirTicket(r.ticket, alCambiar);
  } catch (e) {
    error(e.message, 'Ticket');
  }
}
