// Bancas / sucursales.

import { api } from '../api.js';
import { $, esc, tabla, conectarFilas, modalFormulario, exito, error, fechaCorta } from '../ui.js';

let vista, filas = [];

export async function montar(raiz) {
  vista = raiz;
  vista.innerHTML = `
    <div class="cabecera-vista">
      <h1>Bancas</h1>
      <div class="crece"></div>
      <button id="b-nueva">Nueva banca</button>
    </div>
    <div class="tarjeta">
      <header>Sucursales</header>
      <div class="interior sin-padding" id="b-tabla"></div>
    </div>
    <p class="chico tenue">
      El codigo de la banca es el prefijo de los tickets que emite (por ejemplo 001-0000123).
    </p>`;

  $('#b-nueva').onclick = () => formulario(null);
  await cargar();
}

async function cargar() {
  const cont = $('#b-tabla');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const r = await api.get('/admin/bancas');
    filas = r.bancas;
    const cols = [
      { k: 'codigo', t: 'Codigo', fmt: (v) => `<b class="mono">${esc(v)}</b>` },
      { k: 'nombre', t: 'Nombre' },
      { k: 'direccion', t: 'Direccion' },
      { k: 'telefono', t: 'Telefono' },
      { k: 'rnc', t: 'RNC' },
      { k: 'usuarios', t: 'Usuarios', num: true },
      { k: 'creado_en', t: 'Creada', fmt: (v) => fechaCorta(String(v).slice(0, 10)) },
      { k: 'activo', t: 'Estado', fmt: (v) => v
          ? '<span class="etiqueta ganador">activa</span>'
          : '<span class="etiqueta cancelado">inactiva</span>' },
    ];
    cont.innerHTML = tabla(cols, filas, { vacio: 'Sin bancas.', alHacerClick: true });
    conectarFilas(cont, filas, formulario);
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function formulario(b) {
  const esNueva = !b;
  const campos = [
    { nombre: 'codigo', rotulo: 'Codigo (prefijo del ticket)', requerido: true, placeholder: '002' },
    { nombre: 'nombre', rotulo: 'Nombre de la banca', requerido: true },
    { nombre: 'direccion', rotulo: 'Direccion' },
    { nombre: 'telefono', rotulo: 'Telefono' },
    { nombre: 'rnc', rotulo: 'RNC' },
    { nombre: 'activo', rotulo: 'Banca activa', tipo: 'checkbox' },
  ];
  if (esNueva) campos.pop();

  modalFormulario({
    titulo: esNueva ? 'Nueva banca' : `Editar ${b.nombre}`,
    campos,
    valores: esNueva ? {} : { ...b, activo: !!b.activo },
    alGuardar: async (datos, { cerrar }) => {
      if (esNueva) await api.post('/admin/bancas', datos);
      else { delete datos.codigo; await api.put(`/admin/bancas/${b.id}`, datos); }
      exito(esNueva ? 'Banca creada.' : 'Banca actualizada.');
      cerrar();
      cargar();
    },
  });
}
