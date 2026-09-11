// Arranque de la aplicacion: sesion, menu y enrutado.

import { api } from './api.js';
import { $, esc, error, aviso, fijarMoneda } from './ui.js';

export const estado = {
  usuario: null,
  config: {},
};

// --- Registro de vistas -----------------------------------------
const VISTAS = {
  panel:       () => import('./vistas/panel.js'),
  venta:       () => import('./vistas/venta.js'),
  tickets:     () => import('./vistas/tickets.js'),
  premios:     () => import('./vistas/premios.js'),
  resultados:  () => import('./vistas/resultados.js'),
  reportes:    () => import('./vistas/reportes.js'),
  riesgo:      () => import('./vistas/riesgo.js'),
  cierre:      () => import('./vistas/cierre.js'),
  usuarios:    () => import('./vistas/usuarios.js'),
  loterias:    () => import('./vistas/loterias.js'),
  pagos:       () => import('./vistas/pagos.js'),
  topes:       () => import('./vistas/topes.js'),
  bancas:      () => import('./vistas/bancas.js'),
  config:      () => import('./vistas/config.js'),
  auditoria:   () => import('./vistas/auditoria.js'),
};

const MENU = [
  { grupo: 'Operacion' },
  { id: 'venta',      texto: 'Punto de venta', ico: '&#128181;', roles: ['admin', 'banca', 'vendedor'] },
  { id: 'tickets',    texto: 'Tickets',        ico: '&#127915;', roles: ['admin', 'banca', 'vendedor'] },
  { id: 'premios',    texto: 'Pagar premio',   ico: '&#127942;', roles: ['admin', 'banca', 'vendedor'] },
  { id: 'resultados', texto: 'Resultados',     ico: '&#127919;', roles: ['admin', 'banca', 'vendedor'] },

  { grupo: 'Control' },
  { id: 'panel',      texto: 'Tablero',        ico: '&#128202;', roles: ['admin', 'banca'] },
  { id: 'reportes',   texto: 'Reportes',       ico: '&#128203;', roles: ['admin', 'banca', 'vendedor'] },
  { id: 'riesgo',     texto: 'Riesgo y topes', ico: '&#9888;',   roles: ['admin', 'banca'] },
  { id: 'cierre',     texto: 'Cierre de caja', ico: '&#129534;', roles: ['admin', 'banca', 'vendedor'] },
  { id: 'pagos',      texto: 'Premios por pagar', ico: '&#128176;', roles: ['admin', 'banca'] },

  { grupo: 'Administracion' },
  { id: 'usuarios',   texto: 'Usuarios',       ico: '&#128100;', roles: ['admin', 'banca'] },
  { id: 'bancas',     texto: 'Bancas',         ico: '&#127970;', roles: ['admin'] },
  { id: 'loterias',   texto: 'Loterias y pagos', ico: '&#127922;', roles: ['admin'] },
  { id: 'topes',      texto: 'Limites de venta', ico: '&#128274;', roles: ['admin'] },
  { id: 'config',     texto: 'Configuracion',  ico: '&#9881;',   roles: ['admin'] },
  { id: 'auditoria',  texto: 'Auditoria',      ico: '&#128269;', roles: ['admin', 'banca'] },
];

// --- Sesion ------------------------------------------------------
async function comprobarSesion() {
  try {
    const r = await api.get('/auth/yo');
    estado.usuario = r.usuario;
    estado.config = r.config || {};
    return true;
  } catch {
    return false;
  }
}

function mostrarLogin() {
  $('#pantalla-login').classList.remove('oculto');
  $('#pantalla-login').style.display = '';
  $('#app').classList.remove('visible');
  setTimeout(() => $('#login-usuario')?.focus(), 50);
}

function mostrarApp() {
  const u = estado.usuario;
  fijarMoneda(estado.config.moneda);
  $('#pantalla-login').style.display = 'none';
  $('#app').classList.add('visible');
  $('#quien-nombre').textContent = u.nombre;
  $('#quien-rol').textContent = `${rotuloRol(u.rol)}${u.banca ? ' - ' + u.banca : ''}`;
  $('#marca-nombre').textContent = estado.config.empresa_nombre || 'Banca DG';
  $('#marca-lema').textContent = estado.config.empresa_lema || '';
  document.title = `${estado.config.empresa_nombre || 'Banca DG'} - Sistema de Loterias`;
  dibujarMenu();
  enrutar();
}

const rotuloRol = (r) => ({ admin: 'Administrador', banca: 'Encargado de banca', vendedor: 'Cajero' }[r] || r);

// --- Menu --------------------------------------------------------
function dibujarMenu() {
  const rol = estado.usuario.rol;
  const partes = [];
  let grupoPendiente = null;

  for (const item of MENU) {
    if (item.grupo) { grupoPendiente = item.grupo; continue; }
    if (!item.roles.includes(rol)) continue;
    if (grupoPendiente) { partes.push(`<div class="grupo">${esc(grupoPendiente)}</div>`); grupoPendiente = null; }
    partes.push(
      `<a data-ruta="${item.id}" href="#/${item.id}"><span class="ico">${item.ico}</span>${esc(item.texto)}</a>`
    );
  }
  $('#menu').innerHTML = partes.join('');
}

function marcarMenu(ruta) {
  document.querySelectorAll('#menu a').forEach((a) => {
    a.classList.toggle('activo', a.dataset.ruta === ruta);
  });
}

// --- Enrutado ----------------------------------------------------
function rutaPorDefecto() {
  return estado.usuario.rol === 'vendedor' ? 'venta' : 'panel';
}

function rutaPermitida(id) {
  const item = MENU.find((m) => m.id === id);
  return item && item.roles.includes(estado.usuario.rol);
}

let vistaActual = null;

async function enrutar() {
  if (!estado.usuario) return;
  const cruda = (location.hash || '').replace(/^#\/?/, '');
  const [id, ...resto] = cruda.split('/');
  const ruta = VISTAS[id] && rutaPermitida(id) ? id : rutaPorDefecto();

  if (ruta !== id) { location.hash = `#/${ruta}`; return; }

  marcarMenu(ruta);
  const vista = $('#vista');
  vista.innerHTML = '<div class="cargando"><div class="giro"></div></div>';

  try {
    if (vistaActual && vistaActual.destruir) vistaActual.destruir();
    const modulo = await VISTAS[ruta]();
    vistaActual = modulo;
    await modulo.montar(vista, { params: resto, estado });
  } catch (e) {
    console.error(e);
    vista.innerHTML = `<div class="tarjeta"><div class="interior">
      <h2>No se pudo abrir la seccion</h2>
      <p class="tenue">${esc(e.message || e)}</p>
    </div></div>`;
  }
}

export function irA(ruta) { location.hash = `#/${ruta}`; }

// --- Reloj -------------------------------------------------------
function reloj() {
  const f = new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
  const pintar = () => { const el = $('#reloj'); if (el) el.textContent = f.format(new Date()); };
  pintar();
  setInterval(pintar, 1000);
}

// --- Tema --------------------------------------------------------
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  localStorage.setItem('banca_tema', t);
}

// --- Inicio ------------------------------------------------------
async function iniciar() {
  aplicarTema(localStorage.getItem('banca_tema') || 'claro');

  $('#btn-tema').onclick = () => {
    aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro');
  };

  $('#form-login').onsubmit = async (e) => {
    e.preventDefault();
    const boton = $('#login-boton');
    const cajaError = $('#login-error');
    cajaError.classList.add('oculto');
    boton.disabled = true;
    boton.textContent = 'Entrando...';
    try {
      const r = await api.post('/auth/login', {
        usuario: $('#login-usuario').value.trim(),
        clave: $('#login-clave').value,
      });
      estado.usuario = r.usuario;
      const yo = await api.get('/auth/yo');
      estado.config = yo.config || {};
      $('#login-clave').value = '';
      mostrarApp();
      if (r.clave_por_defecto) {
        aviso('Esta usando una clave de fabrica. Cambiela desde Configuracion antes de operar.',
              'aviso', 'Seguridad');
      }
    } catch (err) {
      cajaError.textContent = err.message;
      cajaError.classList.remove('oculto');
      $('#login-clave').select();
    } finally {
      boton.disabled = false;
      boton.textContent = 'Entrar';
    }
  };

  $('#btn-salir').onclick = async () => {
    try { await api.post('/auth/logout'); } catch {}
    estado.usuario = null;
    location.hash = '';
    mostrarLogin();
  };

  window.addEventListener('hashchange', enrutar);

  // Sesion caducada en cualquier llamada -> volver al login.
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason && e.reason.status === 401 && estado.usuario) {
      estado.usuario = null;
      mostrarLogin();
      error('Su sesion expiro. Vuelva a entrar.');
    }
  });

  reloj();

  if (await comprobarSesion()) mostrarApp();
  else mostrarLogin();
}

iniciar();
