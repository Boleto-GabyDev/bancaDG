// Punto de venta: arma el ticket y lo vende.

import { api } from '../api.js';
import { $, $$, esc, dinero, aviso, exito, error, modal, hoyISO } from '../ui.js';
import { imprimirTicket, ticketHTML } from '../ticket.js';
import { estado } from '../app.js';

const ABREV = { quiniela: 'Quiniela', pale: 'Pale', tripleta: 'Tripleta', superpale: 'Super Pale' };
const MONTOS_RAPIDOS = [5, 10, 20, 25, 50, 100, 200, 500];

let vista, fecha, loterias = [], seleccion = new Set(), carrito = [], modoSuper = false, loteria2 = null;
let cronometro = null;

export function destruir() {
  if (cronometro) clearInterval(cronometro);
  cronometro = null;
  document.removeEventListener('keydown', atajos);
}

export async function montar(raiz) {
  vista = raiz;
  fecha = hoyISO();
  carrito = [];
  seleccion = new Set();
  modoSuper = false;
  loteria2 = null;

  dibujar();
  await cargarLoterias();

  document.addEventListener('keydown', atajos);
  cronometro = setInterval(refrescarCuentaRegresiva, 20000);
}

// ---------------------------------------------------------------
function dibujar() {
  vista.innerHTML = `
    <div class="cabecera-vista">
      <h1>Punto de venta</h1>
      <div class="crece"></div>
      <label class="campo" style="margin:0">
        <span>Fecha del sorteo</span>
        <input type="date" id="v-fecha" value="${esc(fecha)}" min="${esc(hoyISO())}">
      </label>
      <button class="sec" id="v-refrescar" title="Actualizar horarios">Actualizar</button>
    </div>

    <div class="pos">
      <!-- Loterias -->
      <div class="tarjeta">
        <header>
          Loterias
          <div class="crece"></div>
          <button class="chico sec" id="v-todas">Todas</button>
          <button class="chico sec" id="v-ninguna">Ninguna</button>
        </header>
        <div class="interior" style="padding:8px">
          <div class="loterias-lista" id="v-loterias"></div>
        </div>
      </div>

      <!-- Entrada -->
      <div>
        <div class="tarjeta">
          <header>Jugada</header>
          <div class="interior">
            <div class="entrada-jugada">
              <label class="campo" style="margin:0">
                <span>Numeros</span>
                <input id="pos-numeros" inputmode="numeric" autocomplete="off" placeholder="00" maxlength="8">
              </label>
              <label class="campo" style="margin:0">
                <span>Monto</span>
                <input id="pos-monto" inputmode="decimal" autocomplete="off" placeholder="0.00">
              </label>
              <button id="pos-agregar" class="grande">Agregar</button>
            </div>

            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px">
              <span class="tipo-detectado" id="pos-tipo">Escriba el numero</span>
              <label class="chk"><input type="checkbox" id="pos-super"> Super Pale</label>
              <select id="pos-loteria2" class="oculto" style="max-width:210px"></select>
              <div class="crece"></div>
              <span class="chico tenue" id="pos-disponible"></span>
            </div>

            <div class="montos-rapidos" id="pos-montos">
              ${MONTOS_RAPIDOS.map((m) => `<button data-monto="${m}" type="button">${m}</button>`).join('')}
            </div>

            <div class="teclado" id="pos-teclado">
              ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-tecla="${n}" type="button">${n}</button>`).join('')}
              <button data-tecla="borrar" class="borrar" type="button">Borrar</button>
              <button data-tecla="0" type="button">0</button>
              <button data-tecla="ok" class="accion" type="button">Agregar</button>
            </div>

            <p class="chico tenue" style="margin:12px 0 0">
              2 digitos = quiniela &nbsp;|&nbsp; 4 digitos = pale &nbsp;|&nbsp; 6 digitos = tripleta.
              Atajos: <b>Enter</b> avanza, <b>F2</b> factura, <b>F4</b> limpia.
            </p>
          </div>
        </div>
      </div>

      <!-- Ticket -->
      <div class="col-ticket">
        <div class="tarjeta">
          <header>
            Ticket
            <div class="crece"></div>
            <button class="chico sec" id="v-limpiar">Limpiar</button>
          </header>
          <div class="interior" style="padding:10px 12px 0">
            <label class="campo">
              <span>Cliente (opcional)</span>
              <input id="v-cliente" maxlength="60" placeholder="Nombre o referencia">
            </label>
          </div>
          <div class="ticket-lista" id="v-carrito"></div>

          <div class="interior" style="padding:10px 12px 0;border-top:1px solid var(--borde)">
            <span style="display:block;font-size:.78rem;font-weight:650;color:var(--texto-2);
                         margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Forma de cobro</span>
            <div class="cobro-opciones">
              <label class="cobro"><input type="radio" name="metodo" value="efectivo" checked> Efectivo</label>
              <label class="cobro"><input type="radio" name="metodo" value="transferencia"> Transferencia</label>
            </div>
            <label class="campo oculto" id="v-caja-ref" style="margin-top:8px">
              <span>Numero de referencia</span>
              <input id="v-referencia" maxlength="60" placeholder="Confirmacion de la transferencia">
            </label>
          </div>

          <div class="total-caja">
            <span class="rotulo">Total</span>
            <span class="valor" id="v-total">${dinero(0)}</span>
          </div>
          <div class="interior">
            <button class="grande bloque ok" id="v-vender">Facturar e imprimir (F2)</button>
          </div>
        </div>
      </div>
    </div>`;

  $('#v-fecha').onchange = async (e) => {
    fecha = e.target.value || hoyISO();
    carrito = [];
    await cargarLoterias();
    pintarCarrito();
  };
  $('#v-refrescar').onclick = () => cargarLoterias();
  $('#v-todas').onclick = () => { loterias.filter((l) => l.estado.abierto).forEach((l) => seleccion.add(l.id)); pintarLoterias(); };
  $('#v-ninguna').onclick = () => { seleccion.clear(); pintarLoterias(); };
  $('#v-limpiar').onclick = limpiar;
  $$('input[name="metodo"]').forEach((r) => {
    r.onchange = () => {
      const transferencia = metodoPago() === 'transferencia';
      $('#v-caja-ref').classList.toggle('oculto', !transferencia);
      if (transferencia) $('#v-referencia').focus();
    };
  });
  $('#v-vender').onclick = vender;

  const nums = $('#pos-numeros');
  const monto = $('#pos-monto');

  nums.addEventListener('input', () => {
    nums.value = nums.value.replace(/[^0-9\-]/g, '');
    actualizarTipo();
  });
  nums.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); monto.focus(); monto.select(); }
  });
  monto.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); agregar(); }
  });
  monto.addEventListener('input', () => { monto.value = monto.value.replace(/[^0-9.]/g, ''); });

  $('#pos-agregar').onclick = agregar;
  $('#pos-super').onchange = (e) => {
    modoSuper = e.target.checked;
    $('#pos-loteria2').classList.toggle('oculto', !modoSuper);
    actualizarTipo();
    pintarLoterias();
  };
  $('#pos-loteria2').onchange = (e) => { loteria2 = Number(e.target.value) || null; };

  $$('#pos-montos button').forEach((b) => {
    b.onclick = () => { monto.value = b.dataset.monto; nums.focus(); };
  });

  $$('#pos-teclado button').forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.tecla;
      const activo = document.activeElement === monto ? monto : nums;
      if (t === 'borrar') activo.value = activo.value.slice(0, -1);
      else if (t === 'ok') return agregar();
      else activo.value += t;
      activo.dispatchEvent(new Event('input'));
      activo.focus();
    };
  });

  pintarCarrito();
  nums.focus();
}

// ---------------------------------------------------------------
async function cargarLoterias() {
  const cont = $('#v-loterias');
  if (cont) cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await api.get('/catalogo/loterias', { fecha });
    loterias = r.loterias;
    // Quitar de la seleccion las que ya cerraron.
    for (const id of [...seleccion]) {
      const l = loterias.find((x) => x.id === id);
      if (!l || !l.estado.abierto) seleccion.delete(id);
    }
    pintarLoterias();
    pintarSegundaLoteria();
  } catch (e) {
    error(e.message);
  }
}

function pintarLoterias() {
  const cont = $('#v-loterias');
  if (!cont) return;
  if (!loterias.length) { cont.innerHTML = '<div class="vacio">Sin loterias configuradas.</div>'; return; }

  cont.innerHTML = loterias.map((l) => {
    const abierta = l.estado.abierto;
    const sel = seleccion.has(l.id);
    const falta = l.estado.faltan;
    const nota = abierta
      ? (falta === null ? l.estado.motivo || 'Anticipada' : `cierra en ${textoFalta(falta)}`)
      : l.estado.motivo;
    return `<div class="lot ${sel ? 'sel' : ''} ${abierta ? '' : 'cerrada'}" data-id="${l.id}">
      <span class="punto" style="background:${esc(l.color)}"></span>
      <span class="nom">${esc(l.nombre)}</span>
      <span style="text-align:right">
        <span class="hora">${esc(l.estado.cierre)}</span><br>
        <span class="falta">${esc(nota)}</span>
      </span>
    </div>`;
  }).join('');

  $$('.lot', cont).forEach((el) => {
    el.onclick = () => {
      const id = Number(el.dataset.id);
      const l = loterias.find((x) => x.id === id);
      if (!l.estado.abierto) return aviso(`${l.nombre}: ${l.estado.motivo}`, 'aviso');
      if (seleccion.has(id)) seleccion.delete(id); else seleccion.add(id);
      pintarLoterias();
      consultarDisponible();
    };
  });
}

function textoFalta(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

function pintarSegundaLoteria() {
  const sel = $('#pos-loteria2');
  if (!sel) return;
  const aptas = loterias.filter((l) => l.tipos.superpale && l.estado.abierto);
  sel.innerHTML = '<option value="">2da loteria...</option>' +
    aptas.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('');
  if (loteria2 && aptas.some((l) => l.id === loteria2)) sel.value = String(loteria2);
  else loteria2 = null;
}

async function refrescarCuentaRegresiva() {
  if (!document.querySelector('#v-loterias')) return;
  await cargarLoterias();
}

// ---------------------------------------------------------------
function detectarTipo(texto) {
  const limpio = String(texto).replace(/[^0-9]/g, '');
  if (modoSuper) return limpio.length === 4 ? 'superpale' : null;
  if (limpio.length === 2) return 'quiniela';
  if (limpio.length === 4) return 'pale';
  if (limpio.length === 6) return 'tripleta';
  return null;
}

function numerosCanonicos(texto, tipo) {
  const limpio = String(texto).replace(/[^0-9]/g, '');
  const partes = limpio.match(/.{2}/g) || [];
  return partes.sort().join('-');
}

function actualizarTipo() {
  const t = detectarTipo($('#pos-numeros').value);
  const el = $('#pos-tipo');
  if (!t) {
    el.textContent = modoSuper ? 'Super Pale: escriba 4 digitos' : 'Escriba el numero';
    el.style.background = '';
    $('#pos-disponible').textContent = '';
  } else {
    el.textContent = ABREV[t];
  }
  consultarDisponible();
}

let temporizadorDisp = null;
function consultarDisponible() {
  clearTimeout(temporizadorDisp);
  temporizadorDisp = setTimeout(async () => {
    const salida = $('#pos-disponible');
    if (!salida) return;
    const tipo = detectarTipo($('#pos-numeros').value);
    const primera = [...seleccion][0];
    if (!tipo || !primera) { salida.textContent = ''; return; }
    try {
      const r = await api.get('/catalogo/disponible', {
        fecha, loteria_id: primera, tipo,
        numeros: numerosCanonicos($('#pos-numeros').value, tipo),
        loteria2_id: modoSuper ? loteria2 : '',
      });
      if (r.sin_tope) { salida.textContent = 'Sin tope'; salida.className = 'chico tenue'; return; }
      salida.textContent = `Disponible: ${dinero(r.disponible)}`;
      salida.className = r.disponible <= 0 ? 'chico texto-malo' : r.disponible < 200 ? 'chico texto-aviso' : 'chico tenue';
    } catch { salida.textContent = ''; }
  }, 250);
}

// ---------------------------------------------------------------
function agregar() {
  const entrada = $('#pos-numeros').value.trim();
  const monto = Number($('#pos-monto').value);
  const tipo = detectarTipo(entrada);

  if (!tipo) return aviso(modoSuper ? 'El super pale necesita 4 digitos (2 numeros).' : 'Escriba 2, 4 o 6 digitos.', 'aviso');
  if (!(monto > 0)) { $('#pos-monto').focus(); return aviso('Indique el monto.', 'aviso'); }

  const min = Number(estado.config.monto_minimo || 0);
  const max = Number(estado.config.monto_maximo || 999999);
  if (monto < min) return aviso(`El monto minimo es ${dinero(min)}.`, 'aviso');
  if (monto > max) return aviso(`El monto maximo es ${dinero(max)}.`, 'aviso');

  const elegidas = [...seleccion];
  if (!elegidas.length) return aviso('Seleccione al menos una loteria.', 'aviso');

  const numeros = numerosCanonicos(entrada, tipo);

  if (tipo === 'superpale') {
    if (elegidas.length !== 1) return aviso('Para super pale elija exactamente una loteria principal.', 'aviso');
    if (!loteria2) return aviso('Elija la segunda loteria del super pale.', 'aviso');
    if (loteria2 === elegidas[0]) return aviso('El super pale requiere dos loterias distintas.', 'aviso');
  }

  // Validar que la loteria acepte el tipo.
  const rechazadas = elegidas.filter((id) => {
    const l = loterias.find((x) => x.id === id);
    return !l || !l.tipos[tipo];
  });
  if (rechazadas.length) {
    const nombres = rechazadas.map((id) => loterias.find((x) => x.id === id)?.nombre).join(', ');
    return aviso(`${nombres}: no acepta ${ABREV[tipo]}.`, 'aviso');
  }

  // Si ya existe el mismo renglon, se suman los montos.
  const igual = carrito.find((c) =>
    c.tipo === tipo && c.numeros === numeros && c.loteria2_id === (tipo === 'superpale' ? loteria2 : null) &&
    c.loterias.length === elegidas.length && c.loterias.every((x) => elegidas.includes(x)));

  if (igual) igual.monto = Math.round((igual.monto + monto) * 100) / 100;
  else carrito.push({ tipo, numeros, monto, loterias: elegidas, loteria2_id: tipo === 'superpale' ? loteria2 : null });

  $('#pos-numeros').value = '';
  actualizarTipo();
  pintarCarrito();
  $('#pos-numeros').focus();
}

function pintarCarrito() {
  const cont = $('#v-carrito');
  if (!cont) return;

  if (!carrito.length) {
    cont.innerHTML = '<div class="vacio">Sin jugadas. Escriba un numero y presione Agregar.</div>';
  } else {
    cont.innerHTML = `<table class="tabla"><tbody>${carrito.map((c, i) => {
      const nombres = c.loterias.map((id) => loterias.find((l) => l.id === id)?.nombre || '?');
      const extra = c.loteria2_id ? ` + ${loterias.find((l) => l.id === c.loteria2_id)?.nombre || '?'}` : '';
      const sub = c.monto * c.loterias.length;
      return `<tr class="linea-jugada">
        <td>
          <span class="num">${esc(c.numeros)}</span>
          <span class="chico tenue">${esc(ABREV[c.tipo])}</span>
          <div class="lot-nom">${esc(nombres.join(', '))}${esc(extra)}</div>
        </td>
        <td class="num nowrap">
          ${dinero(c.monto, false)}
          ${c.loterias.length > 1 ? `<div class="chico tenue">x${c.loterias.length} = ${dinero(sub, false)}</div>` : ''}
        </td>
        <td style="width:30px"><button class="quitar" data-i="${i}" title="Quitar">&times;</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;

    $$('.quitar', cont).forEach((b) => {
      b.onclick = () => { carrito.splice(Number(b.dataset.i), 1); pintarCarrito(); };
    });
  }

  $('#v-total').textContent = dinero(totalCarrito());
  $('#v-vender').disabled = carrito.length === 0;
}

const metodoPago = () =>
  ($$('input[name="metodo"]').find((r) => r.checked) || {}).value || 'efectivo';

const totalCarrito = () =>
  Math.round(carrito.reduce((s, c) => s + c.monto * c.loterias.length, 0) * 100) / 100;

function limpiar() {
  if (!carrito.length) return;
  carrito = [];
  $('#v-cliente').value = '';
  $('#v-referencia').value = '';
  pintarCarrito();
  $('#pos-numeros').focus();
}

// ---------------------------------------------------------------
async function vender() {
  if (!carrito.length) return;
  if (metodoPago() === 'transferencia' && !$('#v-referencia').value.trim()) {
    $('#v-referencia').focus();
    return aviso('Escriba el numero de referencia de la transferencia.', 'aviso');
  }
  const boton = $('#v-vender');
  boton.disabled = true;
  boton.textContent = 'Procesando...';
  try {
    const r = await api.post('/tickets', {
      fecha,
      cliente: $('#v-cliente').value.trim(),
      metodo_pago: metodoPago(),
      referencia_pago: $('#v-referencia').value.trim(),
      jugadas: carrito.map((c) => ({
        numeros: c.numeros, tipo: c.tipo, monto: c.monto,
        loterias: c.loterias, loteria2_id: c.loteria2_id,
      })),
    });
    carrito = [];
    $('#v-cliente').value = '';
    $('#v-referencia').value = '';
    pintarCarrito();
    exito(`Ticket ${r.ticket.codigo} facturado por ${dinero(r.ticket.total)}.`);
    imprimirTicket(r.ticket);
    mostrarVendido(r.ticket);
    $('#pos-numeros').focus();
    cargarLoterias();
  } catch (e) {
    error(e.message, 'No se pudo vender');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Facturar e imprimir (F2)';
  }
}

function mostrarVendido(t) {
  modal({
    titulo: `Ticket ${t.codigo}`,
    cuerpo: `<div class="centro"><div class="vista-previa-ticket">${ticketHTML(t)}</div></div>`,
    botones: [
      { texto: 'Reimprimir', clase: 'sec', cierra: false, alHacerClick: () => imprimirTicket(t, { copia: true }) },
      { texto: 'Listo', clase: '' },
    ],
  });
}

// ---------------------------------------------------------------
function atajos(e) {
  if (e.key === 'F2') { e.preventDefault(); if (carrito.length) vender(); }
  else if (e.key === 'F4') { e.preventDefault(); limpiar(); }
  else if (e.key === 'F3') { e.preventDefault(); $('#pos-numeros')?.focus(); }
}
