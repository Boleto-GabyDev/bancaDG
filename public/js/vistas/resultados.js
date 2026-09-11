// Carga de resultados de sorteos y reevaluacion automatica de tickets.

import { api } from '../api.js';
import { $, $$, esc, hoyISO, fechaCorta, error, exito, confirmar, aviso } from '../ui.js';
import { estado } from '../app.js';

let vista, fecha, datos = [];

const puedeEditar = () => ['admin', 'banca'].includes(estado.usuario.rol);

export async function montar(raiz) {
  vista = raiz;
  fecha = hoyISO();

  vista.innerHTML = `
    <div class="cabecera-vista">
      <h1>Resultados</h1>
      <div class="crece"></div>
      <label class="campo" style="margin:0"><span>Fecha</span>
        <input type="date" id="r-fecha" value="${esc(fecha)}" max="${esc(hoyISO())}"></label>
      <button class="sec" id="r-ayer">Dia anterior</button>
      <button class="sec" id="r-hoy">Hoy</button>
    </div>
    <div id="r-cuerpo"></div>`;

  $('#r-fecha').onchange = (e) => { fecha = e.target.value; cargar(); };
  $('#r-hoy').onclick = () => { fecha = hoyISO(); $('#r-fecha').value = fecha; cargar(); };
  $('#r-ayer').onclick = () => {
    const [y, m, d] = fecha.split('-').map(Number);
    fecha = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    $('#r-fecha').value = fecha;
    cargar();
  };

  await cargar();
}

async function cargar() {
  const cont = $('#r-cuerpo');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await api.get('/resultados', { fecha });
    datos = r.resultados;
    pintar(r);
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function pintar(r) {
  const juegan = datos.filter((d) => d.juega);
  const noJuegan = datos.filter((d) => !d.juega);
  const cargados = juegan.filter((d) => d.cargado).length;

  $('#r-cuerpo').innerHTML = `
    <div class="tarjeta">
      <header>
        ${esc(r.dia)} ${fechaCorta(fecha)}
        <span class="etiqueta ${cargados === juegan.length ? 'ganador' : 'pendiente'}">
          ${cargados} de ${juegan.length} cargados
        </span>
        <div class="crece"></div>
        ${puedeEditar() ? '<button id="r-guardar">Guardar resultados</button>' : ''}
      </header>
      <div class="interior">
        ${juegan.length ? juegan.map(filaHTML).join('') : '<div class="vacio">Ninguna loteria juega este dia.</div>'}
      </div>
    </div>

    ${noJuegan.length ? `<div class="tarjeta">
      <header>No juegan este dia</header>
      <div class="interior chico tenue">${noJuegan.map((d) => esc(d.nombre)).join(' &middot; ')}</div>
    </div>` : ''}`;

  if (puedeEditar()) {
    $('#r-guardar').onclick = guardar;
    $$('#r-cuerpo input').forEach((inp) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 2);
        if (inp.value.length === 2) {
          const todos = $$('#r-cuerpo input');
          const i = todos.indexOf(inp);
          if (todos[i + 1]) todos[i + 1].focus();
        }
      });
      inp.addEventListener('blur', () => {
        if (inp.value.length === 1) inp.value = inp.value.padStart(2, '0');
      });
    });
    $$('[data-borrar]').forEach((b) => { b.onclick = () => borrar(Number(b.dataset.borrar)); });
  }
}

function filaHTML(d) {
  const editable = puedeEditar();
  const bolas = d.cargado
    ? `<div class="bolas">
         <span class="bola p1">${esc(d.primera)}</span>
         <span class="bola p2">${esc(d.segunda)}</span>
         <span class="bola p3">${esc(d.tercera)}</span>
       </div>`
    : '<span class="etiqueta pendiente">pendiente</span>';

  if (!editable) {
    return `<div class="res-fila" style="grid-template-columns:1fr auto">
      <div class="lot-nombre"><span class="punto" style="background:${esc(d.color)};width:11px;height:11px;border-radius:50%;display:inline-block"></span> ${esc(d.nombre)}</div>
      <div>${bolas}</div>
    </div>`;
  }

  return `<div class="res-fila">
    <div class="lot-nombre">
      <span style="background:${esc(d.color)};width:11px;height:11px;border-radius:50%;display:inline-block"></span>
      ${esc(d.nombre)}
      <span class="chico tenue">${esc(d.hora_cierre)}</span>
    </div>
    <input data-lot="${d.loteria_id}" data-pos="primera" value="${esc(d.primera ?? '')}" placeholder="1ra" inputmode="numeric" maxlength="2">
    <input data-lot="${d.loteria_id}" data-pos="segunda" value="${esc(d.segunda ?? '')}" placeholder="2da" inputmode="numeric" maxlength="2">
    <input data-lot="${d.loteria_id}" data-pos="tercera" value="${esc(d.tercera ?? '')}" placeholder="3ra" inputmode="numeric" maxlength="2">
    <div class="nowrap">
      ${d.cargado && estado.usuario.rol === 'admin'
        ? `<button class="chico sec" data-borrar="${d.loteria_id}" title="Borrar resultado">Borrar</button>` : ''}
    </div>
  </div>`;
}

async function guardar() {
  const porLoteria = new Map();
  for (const inp of $$('#r-cuerpo input[data-lot]')) {
    const id = Number(inp.dataset.lot);
    if (!porLoteria.has(id)) porLoteria.set(id, { loteria_id: id });
    porLoteria.get(id)[inp.dataset.pos] = inp.value.trim();
  }

  const aEnviar = [];
  for (const [id, v] of porLoteria) {
    const llenos = ['primera', 'segunda', 'tercera'].filter((k) => v[k] !== '');
    if (llenos.length === 0) continue;
    if (llenos.length < 3) {
      const nombre = datos.find((d) => d.loteria_id === id)?.nombre || id;
      return aviso(`${nombre}: debe completar las tres posiciones.`, 'aviso');
    }
    const previo = datos.find((d) => d.loteria_id === id);
    if (previo && previo.cargado &&
        previo.primera === v.primera.padStart(2, '0') &&
        previo.segunda === v.segunda.padStart(2, '0') &&
        previo.tercera === v.tercera.padStart(2, '0')) continue;
    aEnviar.push(v);
  }

  if (!aEnviar.length) return aviso('No hay cambios que guardar.', 'aviso');

  const correcciones = aEnviar.filter((v) => datos.find((d) => d.loteria_id === v.loteria_id)?.cargado);
  if (correcciones.length) {
    const ok = await confirmar(
      `Va a corregir ${correcciones.length} resultado(s) ya publicados. Los premios se recalcularan. ¿Continuar?`,
      'Corregir resultados', 'Si, corregir');
    if (!ok) return;
  }

  try {
    const r = await api.post('/resultados/lote', { fecha, resultados: aEnviar });
    const fallos = r.resultados.filter((x) => !x.ok);
    const exitos = r.resultados.filter((x) => x.ok);

    let premios = 0, ganadores = 0, tickets = 0;
    for (const e of exitos) {
      premios += e.resumen.premios; ganadores += e.resumen.ganadores; tickets += e.resumen.tickets;
    }
    if (exitos.length) {
      exito(`${exitos.length} sorteo(s) guardados. ${tickets} ticket(s) evaluados, ${ganadores} ganador(es).`);
    }
    for (const f of fallos) error(f.error);
    await cargar();
  } catch (e) {
    error(e.message);
  }
}

async function borrar(loteriaId) {
  const d = datos.find((x) => x.loteria_id === loteriaId);
  const ok = await confirmar(
    `¿Borrar el resultado de ${d?.nombre} del ${fechaCorta(fecha)}? Los tickets volveran a quedar pendientes.`,
    'Borrar resultado');
  if (!ok) return;
  try {
    await api.del('/resultados', { loteria_id: loteriaId, fecha });
    exito('Resultado eliminado.');
    await cargar();
  } catch (e) {
    error(e.message);
  }
}
