// Configuracion general del sistema y datos que salen impresos en el ticket.

import { api } from '../api.js';
import { $, esc, hoyISO, exito, error, confirmar, modalFormulario } from '../ui.js';
import { estado } from '../app.js';
import { imprimir, ticketHTML } from '../ticket.js';

let vista, config = {};

export async function montar(raiz) {
  vista = raiz;
  const r = await api.get('/admin/config');
  config = r.config;
  const est = await api.get('/admin/estado').catch(() => null);

  vista.innerHTML = `
    <div class="cabecera-vista"><h1>Configuracion</h1></div>

    <form id="cfg-form">
      <div class="rejilla c2">
        <div class="tarjeta">
          <header>Datos del negocio (salen en el ticket)</header>
          <div class="interior">
            ${texto('empresa_nombre', 'Nombre del negocio')}
            ${texto('empresa_lema', 'Lema o subtitulo')}
            ${texto('empresa_rnc', 'RNC')}
            ${texto('empresa_telefono', 'Telefono')}
            ${texto('empresa_direccion', 'Direccion')}
            ${texto('moneda', 'Simbolo de moneda')}
          </div>
        </div>

        <div class="tarjeta">
          <header>Texto del ticket</header>
          <div class="interior">
            ${texto('ticket_mensaje', 'Mensaje al cliente')}
            ${texto('ticket_pie', 'Pie del ticket')}
            <div class="separador"></div>
            <button type="button" class="sec" id="cfg-probar">Imprimir ticket de prueba</button>
          </div>
        </div>
      </div>

      <div class="rejilla c2">
        <div class="tarjeta">
          <header>Reglas de venta</header>
          <div class="interior">
            ${numero('monto_minimo', 'Monto minimo por jugada')}
            ${numero('monto_maximo', 'Monto maximo por jugada')}
            ${numero('max_jugadas_ticket', 'Maximo de jugadas por ticket')}
            ${numero('minutos_cancelacion', 'Minutos para anular un ticket')}
            ${numero('dias_validez_premio', 'Dias para cobrar un premio')}
          </div>
        </div>

        <div class="tarjeta">
          <header>Reglas de premios</header>
          <div class="interior">
            ${casilla('pagar_repetidos', 'Pagar todas las posiciones si el numero sale repetido',
              'Si el mismo numero cae en 1ra y 2da, la quiniela cobra los dos premios.')}
            ${casilla('permitir_venta_cerrada', 'Permitir al administrador vender con el sorteo cerrado',
              'Solo afecta al rol administrador. Usar con cuidado.')}
            <div class="separador"></div>
            <h3>Mantenimiento</h3>
            <div class="fila">
              <label class="campo" style="max-width:180px"><span>Reevaluar fecha</span>
                <input type="date" id="cfg-fecha-rev" value="${esc(hoyISO())}"></label>
              <button type="button" class="sec" id="cfg-reevaluar">Recalcular premios</button>
            </div>
            <p class="chico tenue">
              Recalcula todos los tickets de esa fecha contra los resultados publicados.
              Util despues de cambiar multiplicadores o corregir un sorteo.
            </p>
          </div>
        </div>
      </div>

      <div class="botonera" style="margin-bottom:14px">
        <button type="submit" class="grande">Guardar configuracion</button>
        <button type="button" class="sec" id="cfg-clave">Cambiar mi clave</button>
      </div>
    </form>

    ${est ? `<div class="tarjeta">
      <header>Estado del sistema</header>
      <div class="interior">
        <table class="tabla" style="max-width:460px"><tbody>
          <tr><td>Version</td><td class="num">${esc(est.version)}</td></tr>
          <tr><td>Node.js</td><td class="num">${esc(est.node)}</td></tr>
          <tr><td>Fecha del servidor (RD)</td><td class="num">${esc(est.hoy)} ${esc(est.hora)}</td></tr>
          <tr><td>Tickets emitidos</td><td class="num">${esc(est.tickets)}</td></tr>
          <tr><td>Jugadas registradas</td><td class="num">${esc(est.jugadas)}</td></tr>
          <tr><td>Resultados cargados</td><td class="num">${esc(est.resultados)}</td></tr>
          <tr><td>Usuarios</td><td class="num">${esc(est.usuarios)}</td></tr>
          <tr><td>Loterias</td><td class="num">${esc(est.loterias)}</td></tr>
          <tr><td>Sesiones abiertas</td><td class="num">${esc(est.sesiones)}</td></tr>
        </tbody></table>
      </div>
    </div>` : ''}`;

  $('#cfg-form').onsubmit = guardar;
  $('#cfg-probar').onclick = imprimirPrueba;
  $('#cfg-reevaluar').onclick = reevaluar;
  $('#cfg-clave').onclick = cambiarClave;
}

const texto = (k, rotulo) =>
  `<label class="campo"><span>${esc(rotulo)}</span><input name="${k}" value="${esc(config[k] ?? '')}"></label>`;

const numero = (k, rotulo) =>
  `<label class="campo"><span>${esc(rotulo)}</span><input type="number" step="0.01" min="0" name="${k}" value="${esc(config[k] ?? 0)}"></label>`;

const casilla = (k, rotulo, nota) =>
  `<label class="chk" style="margin-bottom:6px"><input type="checkbox" name="${k}" ${config[k] ? 'checked' : ''}> ${esc(rotulo)}</label>
   <p class="chico tenue" style="margin:0 0 12px 26px">${esc(nota)}</p>`;

async function guardar(e) {
  e.preventDefault();
  const form = e.target;
  const datos = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    datos[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  try {
    const r = await api.put('/admin/config', datos);
    config = r.config;
    estado.config = { ...estado.config, ...config };
    exito('Configuracion guardada.');
    $('#marca-nombre').textContent = config.empresa_nombre || 'Banca DG';
    $('#marca-lema').textContent = config.empresa_lema || '';
  } catch (err) {
    error(err.message);
  }
}

function imprimirPrueba() {
  const demo = {
    codigo: '001-0000001', pin: '1234', fecha_sorteo: hoyISO(),
    creado_en: `${hoyISO()} 19:45:00`, total: 60, premio_total: 0, estado: 'activo',
    cliente: 'Prueba', vendedor: estado.usuario.nombre,
    banca_nombre: config.empresa_nombre || 'Banca DG',
    banca_direccion: config.empresa_direccion, banca_telefono: config.empresa_telefono,
    banca_rnc: config.empresa_rnc,
    jugadas: [
      { tipo: 'quiniela', numeros: '45', monto: 20, loteria: 'Loteria Nacional', estado: 'pendiente', premio: 0, detalle: '' },
      { tipo: 'pale', numeros: '12-45', monto: 25, loteria: 'Loteria Nacional', estado: 'pendiente', premio: 0, detalle: '' },
      { tipo: 'quiniela', numeros: '07', monto: 15, loteria: 'Quiniela Leidsa', estado: 'pendiente', premio: 0, detalle: '' },
    ],
    resultados: [],
  };
  estado.config = { ...estado.config, ...config };
  imprimir(ticketHTML(demo));
}

async function reevaluar() {
  const fecha = $('#cfg-fecha-rev').value;
  const ok = await confirmar(`¿Recalcular todos los premios del ${fecha}?`, 'Recalcular premios', 'Si, recalcular');
  if (!ok) return;
  try {
    const r = await api.post('/admin/reevaluar', { fecha });
    exito(`${r.resumen.tickets} ticket(s) revisados, ${r.resumen.ganadores} ganador(es).`);
  } catch (e) {
    error(e.message);
  }
}

function cambiarClave() {
  modalFormulario({
    titulo: 'Cambiar mi clave',
    campos: [
      { nombre: 'actual', rotulo: 'Clave actual', tipo: 'password', requerido: true },
      { nombre: 'nueva', rotulo: 'Nueva clave (minimo 6 caracteres)', tipo: 'password', requerido: true },
      { nombre: 'repetir', rotulo: 'Repetir la nueva clave', tipo: 'password', requerido: true },
    ],
    alGuardar: async (datos, { cerrar }) => {
      if (datos.nueva !== datos.repetir) throw new Error('Las claves nuevas no coinciden.');
      await api.post('/auth/cambiar-clave', { actual: datos.actual, nueva: datos.nueva });
      exito('Clave cambiada.');
      cerrar();
    },
  });
}
