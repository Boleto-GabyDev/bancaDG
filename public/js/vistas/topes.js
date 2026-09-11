// Limites (topes) de venta por numero: el control de riesgo de la banca.

import { api } from '../api.js';
import { $, $$, esc, dinero, tabla, modalFormulario, confirmar, exito, error } from '../ui.js';

let vista, limites = [], loterias = [];

const TIPOS = [
  { valor: 'quiniela', texto: 'Quiniela (1 numero)' },
  { valor: 'pale', texto: 'Pale (2 numeros)' },
  { valor: 'tripleta', texto: 'Tripleta (3 numeros)' },
  { valor: 'superpale', texto: 'Super Pale (2 numeros)' },
];

export async function montar(raiz) {
  vista = raiz;
  vista.innerHTML = `
    <div class="cabecera-vista">
      <h1>Limites de venta</h1>
      <div class="crece"></div>
      <button id="lm-nuevo">Nuevo limite</button>
    </div>

    <div class="tarjeta">
      <div class="interior">
        <p style="margin:0">
          El tope es el monto maximo que la banca acepta vender de un mismo numero, por sorteo y por dia.
          Se aplica el mas especifico que exista:
        </p>
        <ol class="chico tenue" style="margin:8px 0 0;padding-left:20px">
          <li>Loteria + tipo + numero exacto</li>
          <li>Todas las loterias + tipo + numero exacto</li>
          <li>Loteria + tipo (tope general del tipo en esa loteria)</li>
          <li>Todas las loterias + tipo (tope general)</li>
        </ol>
      </div>
    </div>

    <div class="tarjeta">
      <header>Topes configurados</header>
      <div class="interior sin-padding" id="lm-tabla"></div>
    </div>`;

  $('#lm-nuevo').onclick = () => formulario();
  await cargar();
}

async function cargar() {
  const cont = $('#lm-tabla');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const [l, lo] = await Promise.all([
      api.get('/admin/limites'),
      api.get('/admin/loterias').catch(() => ({ loterias: [] })),
    ]);
    limites = l.limites;
    loterias = lo.loterias;

    const cols = [
      { k: 'loteria', t: 'Loteria', fmt: (v) => v ? esc(v) : '<span class="tenue">Todas</span>' },
      { k: 'tipo', t: 'Tipo', fmt: (v) => esc(TIPOS.find((t) => t.valor === v)?.texto.split(' (')[0] || v) },
      { k: 'numero', t: 'Numero', fmt: (v) => v
          ? `<span class="pill-num">${esc(v)}</span>`
          : '<span class="tenue">tope general del tipo</span>' },
      { k: 'monto_max', t: 'Tope', num: true, fmt: (v) => v > 0
          ? `<b>${dinero(v, false)}</b>`
          : '<span class="tenue">sin limite</span>' },
      { k: 'id', t: '', fmt: (v) => `<button class="chico sec" data-editar="${v}">Editar</button>
                                     <button class="chico malo" data-borrar="${v}">Quitar</button>` },
    ];

    cont.innerHTML = tabla(cols, limites, { vacio: 'Sin topes configurados: la venta no tiene limite por numero.' });

    $$('[data-editar]', cont).forEach((b) => {
      b.onclick = () => formulario(limites.find((x) => x.id === Number(b.dataset.editar)));
    });
    $$('[data-borrar]', cont).forEach((b) => {
      b.onclick = async () => {
        const ok = await confirmar('¿Quitar este tope?', 'Quitar tope');
        if (!ok) return;
        try { await api.del(`/admin/limites/${b.dataset.borrar}`); exito('Tope eliminado.'); cargar(); }
        catch (e) { error(e.message); }
      };
    });
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function formulario(l) {
  modalFormulario({
    titulo: l ? 'Editar tope' : 'Nuevo tope',
    campos: [
      { nombre: 'loteria_id', rotulo: 'Loteria', tipo: 'select',
        opciones: [{ valor: '', texto: 'Todas las loterias' },
                   ...loterias.map((x) => ({ valor: x.id, texto: x.nombre }))] },
      { nombre: 'tipo', rotulo: 'Tipo de jugada', tipo: 'select', opciones: TIPOS },
      { nombre: 'numero', rotulo: 'Numero (vacio = tope general del tipo)',
        placeholder: '45  o  45-12  o  45-12-07' },
      { nombre: 'monto_max', rotulo: 'Monto maximo', tipo: 'number', paso: '0.01', min: 0, requerido: true },
    ],
    valores: l ? { ...l, loteria_id: l.loteria_id || '', numero: l.numero || '' } : { tipo: 'quiniela', monto_max: 1000 },
    alGuardar: async (datos, { cerrar }) => {
      await api.post('/admin/limites', datos);
      exito('Tope guardado.');
      cerrar();
      cargar();
    },
  });
}
