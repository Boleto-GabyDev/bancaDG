// Armado e impresion del ticket en formato de rollo de 58 mm.

import { esc, dinero, fechaCorta, sumarDias } from './ui.js';
import { estado } from './app.js';

const ABREV = { quiniela: 'QUI', pale: 'PAL', tripleta: 'TRI', superpale: 'SPL' };

function horaBonita(iso) {
  if (!iso) return '';
  const [f, h] = String(iso).split(' ');
  if (!h) return fechaCorta(f);
  const [hh, mm] = h.split(':');
  const n = Number(hh);
  const ampm = n >= 12 ? 'PM' : 'AM';
  const h12 = n % 12 === 0 ? 12 : n % 12;
  return `${fechaCorta(f)} ${String(h12).padStart(2, '0')}:${mm} ${ampm}`;
}

/** HTML del ticket de venta. */
export function ticketHTML(t, { copia = false } = {}) {
  const c = estado.config || {};
  const empresa = c.empresa_nombre || t.banca_nombre || 'Banca DG';

  // Agrupar jugadas por loteria para que el ticket sea corto y legible.
  const grupos = new Map();
  for (const j of t.jugadas) {
    const clave = j.loteria2 ? `${j.loteria} + ${j.loteria2}` : j.loteria;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(j);
  }

  const filas = [];
  for (const [loteria, jugadas] of grupos) {
    filas.push(`<tr><td colspan="3" style="font-weight:800;padding-top:2px">${esc(loteria.toUpperCase())}</td></tr>`);
    for (const j of jugadas) {
      filas.push(`<tr>
        <td style="width:22px">${ABREV[j.tipo] || j.tipo}</td>
        <td style="font-weight:800;letter-spacing:.5px">${esc(j.numeros)}</td>
        <td class="der">${dinero(j.monto, false)}</td>
      </tr>`);
    }
  }

  const vence = t.fecha_sorteo ? sumarDias(t.fecha_sorteo, Number(c.dias_validez_premio) || 30) : '';

  return `
  <div class="ticket58">
    <div class="cab">
      <div class="nombre">${esc(empresa)}</div>
      ${c.empresa_lema ? `<div class="sub">${esc(c.empresa_lema)}</div>` : ''}
      <div class="sub">${esc(t.banca_nombre || '')}</div>
      ${t.banca_direccion ? `<div class="sub">${esc(t.banca_direccion)}</div>` : ''}
      ${t.banca_telefono ? `<div class="sub">Tel. ${esc(t.banca_telefono)}</div>` : ''}
      ${t.banca_rnc ? `<div class="sub">RNC ${esc(t.banca_rnc)}</div>` : ''}
    </div>

    <div class="sep"></div>
    <div class="codigo-grande">${esc(t.codigo)}</div>
    <div class="sep"></div>

    <div class="kv"><span>Sorteo:</span><span>${fechaCorta(t.fecha_sorteo)}</span></div>
    <div class="kv"><span>Emitido:</span><span>${horaBonita(t.creado_en)}</span></div>
    <div class="kv"><span>Cajero:</span><span>${esc(t.vendedor || '')}</span></div>
    ${t.cliente ? `<div class="kv"><span>Cliente:</span><span>${esc(t.cliente)}</span></div>` : ''}

    <div class="sep"></div>
    <table>
      <thead><tr><th></th><th>JUGADA</th><th class="der">MONTO</th></tr></thead>
      <tbody>${filas.join('')}</tbody>
    </table>
    <div class="sep"></div>

    <div class="total"><span>TOTAL</span><span>${dinero(t.total, false)}</span></div>
    <div class="kv" style="font-size:9.5px"><span>Jugadas:</span><span>${t.jugadas.length}</span></div>
    <div class="kv" style="font-size:9.5px"><span>Cobro:</span><span>${esc((t.metodo_pago || 'efectivo').toUpperCase())}</span></div>
    ${t.referencia_pago
      ? `<div class="kv" style="font-size:9.5px"><span>Ref:</span><span>${esc(t.referencia_pago)}</span></div>`
      : ''}

    ${t.estado === 'cancelado' ? '<div class="premio">*** ANULADO ***</div>' : ''}
    ${copia ? '<div class="premio">COPIA</div>' : ''}

    <div class="sep"></div>
    <div class="kv"><span>PIN:</span><span style="font-weight:800">${esc(t.pin)}</span></div>
    <div class="pie">
      ${c.ticket_mensaje ? esc(c.ticket_mensaje) : ''}<br>
      ${vence ? `Valido para cobro hasta ${fechaCorta(vence)}` : ''}<br>
      ${c.ticket_pie ? esc(c.ticket_pie) : ''}
    </div>
    <div class="pie" style="margin-top:5px">. . .</div>
  </div>`;
}

/** HTML del comprobante de pago de premio. */
export function comprobanteHTML(t) {
  const c = estado.config || {};
  const ganadoras = t.jugadas.filter((j) => j.estado === 'ganadora');
  return `
  <div class="ticket58">
    <div class="cab">
      <div class="nombre">${esc(c.empresa_nombre || 'Banca DG')}</div>
      <div class="sub">COMPROBANTE DE PAGO</div>
      <div class="sub">${esc(t.banca_nombre || '')}</div>
    </div>
    <div class="sep"></div>
    <div class="codigo-grande">${esc(t.codigo)}</div>
    <div class="sep"></div>
    <div class="kv"><span>Sorteo:</span><span>${fechaCorta(t.fecha_sorteo)}</span></div>
    <div class="kv"><span>Pagado:</span><span>${horaBonita(t.pagado_en)}</span></div>
    <div class="kv"><span>Apostado:</span><span>${dinero(t.total, false)}</span></div>
    <div class="sep"></div>
    <table><tbody>
      ${ganadoras.map((j) => `<tr>
        <td>${esc(j.loteria.slice(0, 10))}</td>
        <td style="font-weight:800">${esc(j.numeros)}</td>
        <td class="der">${dinero(j.premio, false)}</td>
      </tr><tr><td colspan="3" style="font-size:9px">${esc(j.detalle)}</td></tr>`).join('')}
    </tbody></table>
    <div class="premio">PREMIO ${dinero(t.premio_total, false)}</div>
    <div class="kv" style="font-size:9.5px;margin-top:3px">
      <span>Entregado en:</span><span>${esc((t.metodo_pago_premio || 'efectivo').toUpperCase())}</span>
    </div>
    ${t.referencia_pago_premio
      ? `<div class="kv" style="font-size:9.5px"><span>Ref:</span><span>${esc(t.referencia_pago_premio)}</span></div>`
      : ''}
    <div class="sep"></div>
    <div class="pie">Firma del beneficiario<br><br>______________________<br>Cedula: ______________</div>
  </div>`;
}

/** Envia HTML a la impresora usando el area oculta de impresion. */
export function imprimir(html) {
  const area = document.getElementById('area-impresion');
  area.innerHTML = html;
  const alTerminar = () => {
    setTimeout(() => { area.innerHTML = ''; }, 400);
    window.removeEventListener('afterprint', alTerminar);
  };
  window.addEventListener('afterprint', alTerminar);
  setTimeout(() => window.print(), 60);
}

export const imprimirTicket = (t, opts) => imprimir(ticketHTML(t, opts));
export const imprimirComprobante = (t) => imprimir(comprobanteHTML(t));
