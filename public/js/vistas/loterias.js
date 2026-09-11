// Loterias, horarios de cierre y multiplicadores de pago.

import { api } from '../api.js';
import { $, $$, esc, entero, tabla, conectarFilas, modal, confirmar, exito, error } from '../ui.js';

const DIAS = [
  { n: 1, t: 'Lun' }, { n: 2, t: 'Mar' }, { n: 3, t: 'Mie' }, { n: 4, t: 'Jue' },
  { n: 5, t: 'Vie' }, { n: 6, t: 'Sab' }, { n: 7, t: 'Dom' },
];

const ETIQUETAS = {
  quiniela:  { 1: 'Quiniela 1ra', 2: 'Quiniela 2da', 3: 'Quiniela 3ra' },
  pale:      { directo: 'Pale (1ra-2da)', tercera: 'Pale con 3ra' },
  tripleta:  { directo: 'Tripleta completa', doble: 'Tripleta 2 de 3' },
  superpale: { directo: 'Super Pale' },
};

let vista, pestana = 'loterias', loterias = [], premios = [], posiciones = {};

export async function montar(raiz) {
  vista = raiz;
  vista.innerHTML = `
    <div class="cabecera-vista">
      <h1>Loterias y pagos</h1>
      <div class="crece"></div>
      <button id="l-nueva">Nueva loteria</button>
    </div>
    <div class="pestanas">
      <button data-p="loterias" class="activo">Loterias y horarios</button>
      <button data-p="premios">Multiplicadores de pago</button>
    </div>
    <div id="l-cuerpo"></div>`;

  $('#l-nueva').onclick = () => formularioLoteria(null);
  $$('.pestanas button').forEach((b) => {
    b.onclick = () => {
      pestana = b.dataset.p;
      $$('.pestanas button').forEach((x) => x.classList.toggle('activo', x === b));
      $('#l-nueva').classList.toggle('oculto', pestana !== 'loterias');
      pintar();
    };
  });

  await cargar();
}

async function cargar() {
  try {
    const [l, p] = await Promise.all([api.get('/admin/loterias'), api.get('/admin/premios')]);
    loterias = l.loterias;
    premios = p.premios;
    posiciones = p.posiciones;
    pintar();
  } catch (e) {
    error(e.message);
    $('#l-cuerpo').innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function pintar() {
  if (pestana === 'loterias') pintarLoterias();
  else pintarPremios();
}

// ---------------------------------------------------------------
function pintarLoterias() {
  const cols = [
    { k: 'orden', t: '#', num: true },
    { k: 'codigo', t: 'Codigo', fmt: (v, f) =>
        `<span class="punto" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(f.color)};margin-right:6px"></span><b class="mono">${esc(v)}</b>` },
    { k: 'nombre', t: 'Nombre' },
    { k: 'hora_cierre', t: 'Cierre', fmt: (v, f) => `<b class="mono">${esc(v)}</b>${f.minutos_previos ? ` <span class="chico tenue">-${f.minutos_previos}m</span>` : ''}` },
    { k: 'dias', t: 'Dias', fmt: (v) => esc(String(v).split(',').map((d) => DIAS.find((x) => x.n === Number(d))?.t || d).join(' ')) },
    { k: 'q_quiniela', t: 'Jugadas admitidas', fmt: (v, f) => [
        f.q_quiniela && 'Qui', f.q_pale && 'Pale', f.q_tripleta && 'Tri', f.q_superpale && 'SPale',
      ].filter(Boolean).map((x) => `<span class="etiqueta activo">${x}</span>`).join(' ') || '<span class="tenue">ninguna</span>' },
    { k: 'activo', t: 'Estado', fmt: (v) => v
        ? '<span class="etiqueta ganador">activa</span>'
        : '<span class="etiqueta cancelado">inactiva</span>' },
  ];

  $('#l-cuerpo').innerHTML = `
    <div class="tarjeta">
      <header>${loterias.length} loteria(s)</header>
      <div class="interior sin-padding" id="l-tabla"></div>
    </div>
    <p class="chico tenue">
      La hora de cierre es la ultima hora en que se aceptan jugadas.
      Los "minutos previos" adelantan ese corte (margen de seguridad).
    </p>`;

  const cont = $('#l-tabla');
  cont.innerHTML = tabla(cols, loterias, { vacio: 'Sin loterias.', alHacerClick: true });
  conectarFilas(cont, loterias, formularioLoteria);
}

function formularioLoteria(l) {
  const esNueva = !l;
  const v = l || {
    codigo: '', nombre: '', color: '#1565C0', hora_cierre: '20:00', minutos_previos: 0,
    dias: '1,2,3,4,5,6', orden: loterias.length + 1, activo: 1,
    q_quiniela: 1, q_pale: 1, q_tripleta: 1, q_superpale: 0,
  };
  const diasSel = String(v.dias).split(',').map(Number);

  const form = document.createElement('form');
  form.innerHTML = `
    <div class="rejilla c2">
      <label class="campo"><span>Codigo</span>
        <input name="codigo" value="${esc(v.codigo)}" ${esNueva ? '' : 'disabled'} required placeholder="NACIONAL"></label>
      <label class="campo"><span>Nombre</span>
        <input name="nombre" value="${esc(v.nombre)}" required></label>
    </div>
    <div class="rejilla c3">
      <label class="campo"><span>Hora de cierre</span>
        <input name="hora_cierre" type="time" value="${esc(v.hora_cierre)}" required></label>
      <label class="campo"><span>Minutos previos</span>
        <input name="minutos_previos" type="number" min="0" max="600" value="${esc(v.minutos_previos)}"></label>
      <label class="campo"><span>Orden</span>
        <input name="orden" type="number" min="0" max="999" value="${esc(v.orden)}"></label>
    </div>
    <label class="campo"><span>Color</span>
      <input name="color" type="color" value="${esc(v.color)}" style="height:40px;padding:2px"></label>

    <div class="campo">
      <span style="display:block;font-size:.78rem;font-weight:650;color:var(--texto-2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Dias que juega</span>
      <div class="botonera">
        ${DIAS.map((d) => `<label class="chk">
          <input type="checkbox" name="dia" value="${d.n}" ${diasSel.includes(d.n) ? 'checked' : ''}> ${d.t}
        </label>`).join('')}
      </div>
    </div>

    <div class="campo">
      <span style="display:block;font-size:.78rem;font-weight:650;color:var(--texto-2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Jugadas admitidas</span>
      <div class="botonera">
        <label class="chk"><input type="checkbox" name="q_quiniela" ${v.q_quiniela ? 'checked' : ''}> Quiniela</label>
        <label class="chk"><input type="checkbox" name="q_pale" ${v.q_pale ? 'checked' : ''}> Pale</label>
        <label class="chk"><input type="checkbox" name="q_tripleta" ${v.q_tripleta ? 'checked' : ''}> Tripleta</label>
        <label class="chk"><input type="checkbox" name="q_superpale" ${v.q_superpale ? 'checked' : ''}> Super Pale</label>
      </div>
    </div>

    <label class="chk"><input type="checkbox" name="activo" ${v.activo ? 'checked' : ''}> Loteria activa</label>`;

  const botones = [{ texto: 'Cancelar', clase: 'sec' }];

  if (!esNueva) {
    botones.push({
      texto: 'Eliminar', clase: 'malo',
      alHacerClick: async ({ cerrar }) => {
        const ok = await confirmar(`¿Eliminar la loteria ${l.nombre}?`, 'Eliminar loteria');
        if (!ok) return false;
        try {
          const r = await api.del(`/admin/loterias/${l.id}`);
          exito(r.mensaje || 'Loteria eliminada.');
          cerrar(); cargar();
        } catch (e) { error(e.message); return false; }
      },
    });
  }

  botones.push({
    texto: 'Guardar', clase: '',
    alHacerClick: async ({ cerrar }) => {
      const dias = $$('input[name="dia"]:checked', form).map((c) => c.value);
      if (!dias.length) { error('Seleccione al menos un dia.'); return false; }
      const datos = {
        codigo: form.codigo.value.trim(),
        nombre: form.nombre.value.trim(),
        hora_cierre: form.hora_cierre.value,
        minutos_previos: Number(form.minutos_previos.value) || 0,
        orden: Number(form.orden.value) || 0,
        color: form.color.value,
        dias: dias.join(','),
        activo: form.activo.checked,
        q_quiniela: form.q_quiniela.checked,
        q_pale: form.q_pale.checked,
        q_tripleta: form.q_tripleta.checked,
        q_superpale: form.q_superpale.checked,
      };
      try {
        if (esNueva) await api.post('/admin/loterias', datos);
        else await api.put(`/admin/loterias/${l.id}`, datos);
        exito(esNueva ? 'Loteria creada.' : 'Loteria actualizada.');
        cerrar(); cargar();
      } catch (e) { error(e.message); return false; }
    },
  });

  modal({ titulo: esNueva ? 'Nueva loteria' : `Editar ${l.nombre}`, cuerpo: form, botones, ancho: true });
}

// ---------------------------------------------------------------
function valorPremio(loteriaId, tipo, pos) {
  const f = premios.find((p) =>
    (loteriaId === null ? p.loteria_id === null : p.loteria_id === loteriaId) && p.tipo === tipo && p.posicion === String(pos));
  return f ? f.multiplicador : '';
}

function bloqueEntradas(loteriaId, prefijo) {
  return Object.entries(posiciones).map(([tipo, lista]) => `
    <div class="tarjeta" style="margin-bottom:10px">
      <header style="font-size:.85rem">${esc(tipo.toUpperCase())}</header>
      <div class="interior">
        <div class="rejilla c3">
          ${lista.map((pos) => `<label class="campo">
            <span>${esc(ETIQUETAS[tipo]?.[pos] || `${tipo} ${pos}`)}</span>
            <input type="number" step="0.01" min="0" data-tipo="${esc(tipo)}" data-pos="${esc(pos)}"
                   id="${prefijo}-${esc(tipo)}-${esc(pos)}" value="${esc(valorPremio(loteriaId, tipo, pos))}"
                   placeholder="usa el general">
          </label>`).join('')}
        </div>
      </div>
    </div>`).join('');
}

function pintarPremios() {
  const especificos = premios.filter((p) => p.loteria_id !== null);

  $('#l-cuerpo').innerHTML = `
    <div class="tarjeta">
      <header>Pagos generales (aplican a todas las loterias)</header>
      <div class="interior">
        ${bloqueEntradas(null, 'g')}
        <button id="pr-guardar-global">Guardar pagos generales</button>
        <p class="chico tenue" style="margin:10px 0 0">
          Un multiplicador en 0 desactiva ese premio. Ejemplo: quiniela 1ra en 60 significa
          que RD$1 jugado paga RD$60 si el numero sale en primera.
        </p>
      </div>
    </div>

    <div class="tarjeta">
      <header>Pago especial por loteria</header>
      <div class="interior">
        <label class="campo" style="max-width:320px"><span>Loteria</span>
          <select id="pr-loteria">
            <option value="">Seleccione una loteria...</option>
            ${loterias.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}
          </select></label>
        <div id="pr-especifico"></div>
      </div>
    </div>

    <div class="tarjeta">
      <header>Excepciones activas</header>
      <div class="interior sin-padding" id="pr-lista"></div>
    </div>`;

  $('#pr-guardar-global').onclick = () => guardarBloque(null, 'g');
  $('#pr-loteria').onchange = (e) => {
    const id = Number(e.target.value) || null;
    const cont = $('#pr-especifico');
    if (!id) { cont.innerHTML = ''; return; }
    cont.innerHTML = bloqueEntradas(id, 'e') +
      `<button id="pr-guardar-esp">Guardar pagos de esta loteria</button>`;
    $('#pr-guardar-esp').onclick = () => guardarBloque(id, 'e');
  };

  const cols = [
    { k: 'loteria', t: 'Loteria' },
    { k: 'tipo', t: 'Tipo' },
    { k: 'posicion', t: 'Posicion', fmt: (v, f) => esc(ETIQUETAS[f.tipo]?.[v] || v) },
    { k: 'multiplicador', t: 'Paga', num: true, fmt: (v) => `<b>x${entero(v)}</b>` },
    { k: 'id', t: '', fmt: (v) => `<button class="chico malo" data-borrar="${v}">Quitar</button>` },
  ];
  const cont = $('#pr-lista');
  cont.innerHTML = tabla(cols, especificos, { vacio: 'No hay excepciones: todas las loterias usan los pagos generales.' });
  $$('[data-borrar]', cont).forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      const ok = await confirmar('¿Quitar esta excepcion? La loteria volvera a usar el pago general.', 'Quitar excepcion');
      if (!ok) return;
      try { await api.del(`/admin/premios/${b.dataset.borrar}`); exito('Excepcion eliminada.'); cargar(); }
      catch (e) { error(e.message); }
    };
  });
}

async function guardarBloque(loteriaId, prefijo) {
  const entradas = $$(`input[id^="${prefijo}-"]`);
  let guardados = 0;
  try {
    for (const inp of entradas) {
      const valor = inp.value.trim();
      if (valor === '') continue;
      await api.post('/admin/premios', {
        loteria_id: loteriaId,
        tipo: inp.dataset.tipo,
        posicion: inp.dataset.pos,
        multiplicador: Number(valor),
      });
      guardados++;
    }
    exito(`${guardados} multiplicador(es) guardados.`);
    await cargar();
    if (loteriaId) { $('#pr-loteria').value = String(loteriaId); $('#pr-loteria').dispatchEvent(new Event('change')); }
  } catch (e) {
    error(e.message);
  }
}
