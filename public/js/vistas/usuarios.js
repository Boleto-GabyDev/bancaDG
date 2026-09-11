// Alta, edicion y baja de usuarios (cajeros, encargados y administradores).

import { api } from '../api.js';
import { $, esc, tabla, conectarFilas, modalFormulario, confirmar, exito, error } from '../ui.js';
import { estado } from '../app.js';

let vista, filas = [], bancas = [];

const ROLES = [
  { valor: 'vendedor', texto: 'Cajero (vende y paga premios)' },
  { valor: 'banca', texto: 'Encargado de banca (ve toda su banca)' },
  { valor: 'admin', texto: 'Administrador (acceso total)' },
];

export async function montar(raiz) {
  vista = raiz;
  vista.innerHTML = `
    <div class="cabecera-vista">
      <h1>Usuarios</h1>
      <div class="crece"></div>
      <button id="u-nuevo">Nuevo usuario</button>
    </div>
    <div class="tarjeta">
      <header>Usuarios del sistema</header>
      <div class="interior sin-padding" id="u-tabla"></div>
    </div>
    <p class="chico tenue">Haga clic en un usuario para editarlo o cambiarle la clave.</p>`;

  $('#u-nuevo').onclick = () => formulario(null);
  await cargar();
}

async function cargar() {
  const cont = $('#u-tabla');
  cont.innerHTML = '<div class="cargando"><div class="giro"></div></div>';
  try {
    const [u, b] = await Promise.all([
      api.get('/admin/usuarios'),
      api.get('/catalogo/bancas').catch(() => ({ bancas: [] })),
    ]);
    filas = u.usuarios;
    bancas = b.bancas;

    const cols = [
      { k: 'usuario', t: 'Usuario', fmt: (v) => `<b class="mono">${esc(v)}</b>` },
      { k: 'nombre', t: 'Nombre' },
      { k: 'rol', t: 'Rol', fmt: (v) => esc(ROLES.find((r) => r.valor === v)?.texto.split(' (')[0] || v) },
      { k: 'banca', t: 'Banca' },
      { k: 'comision_pct', t: 'Comision', num: true, fmt: (v) => `${v}%` },
      { k: 'ultimo_acceso', t: 'Ultimo acceso', fmt: (v) => v ? `<span class="chico">${esc(String(v).slice(0, 16))}</span>` : '<span class="tenue chico">nunca</span>' },
      { k: 'activo', t: 'Estado', fmt: (v) => v
          ? '<span class="etiqueta ganador">activo</span>'
          : '<span class="etiqueta cancelado">inactivo</span>' },
    ];

    cont.innerHTML = tabla(cols, filas, { vacio: 'Sin usuarios.', alHacerClick: true });
    conectarFilas(cont, filas, (f) => formulario(f));
  } catch (e) {
    error(e.message);
    cont.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function formulario(u) {
  const esNuevo = !u;
  const puedeAdmin = estado.usuario.rol === 'admin';

  const campos = [
    { nombre: 'usuario', rotulo: 'Usuario (para entrar al sistema)', requerido: true },
    { nombre: 'nombre', rotulo: 'Nombre completo', requerido: true },
    { nombre: 'rol', rotulo: 'Rol', tipo: 'select',
      opciones: ROLES.filter((r) => puedeAdmin || r.valor !== 'admin') },
    { nombre: 'banca_id', rotulo: 'Banca', tipo: 'select',
      opciones: bancas.map((b) => ({ valor: b.id, texto: `${b.codigo} - ${b.nombre}` })) },
    { nombre: 'comision_pct', rotulo: 'Comision (% de la venta)', tipo: 'number', paso: '0.01', min: 0, max: 100 },
    { nombre: 'clave', rotulo: esNuevo ? 'Clave' : 'Nueva clave (dejar vacio para no cambiarla)',
      tipo: 'password', requerido: esNuevo },
    { nombre: 'activo', rotulo: 'Usuario activo', tipo: 'checkbox' },
  ];

  if (esNuevo) campos.pop();

  modalFormulario({
    titulo: esNuevo ? 'Nuevo usuario' : `Editar ${u.usuario}`,
    campos,
    valores: esNuevo
      ? { rol: 'vendedor', comision_pct: 0, banca_id: estado.usuario.banca_id }
      : { ...u, clave: '', activo: !!u.activo },
    alGuardar: async (datos, { cerrar }) => {
      if (!esNuevo) {
        delete datos.usuario;              // el nombre de usuario no se cambia
        if (!datos.clave) delete datos.clave;
      }
      if (esNuevo) await api.post('/admin/usuarios', datos);
      else await api.put(`/admin/usuarios/${u.id}`, datos);
      exito(esNuevo ? 'Usuario creado.' : 'Usuario actualizado.');
      cerrar();
      cargar();
    },
  });

  // Boton de eliminar para usuarios existentes (solo admin).
  if (!esNuevo && estado.usuario.rol === 'admin' && u.id !== estado.usuario.id) {
    const pie = document.querySelector('#modales .velo:last-child footer');
    if (pie) {
      const b = document.createElement('button');
      b.textContent = 'Eliminar';
      b.className = 'malo';
      b.type = 'button';
      b.style.marginRight = 'auto';
      b.onclick = async () => {
        const ok = await confirmar(`¿Eliminar el usuario ${u.usuario}?`, 'Eliminar usuario');
        if (!ok) return;
        try {
          const r = await api.del(`/admin/usuarios/${u.id}`);
          exito(r.mensaje || 'Usuario eliminado.');
          document.querySelector('#modales .velo:last-child')?.remove();
          cargar();
        } catch (e) { error(e.message); }
      };
      pie.insertBefore(b, pie.firstChild);
    }
  }
}
