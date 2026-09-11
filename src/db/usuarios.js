'use strict';

/**
 * Alta de los usuarios reales del sistema.
 *
 *   npm run usuarios            crea/actualiza lo que diga usuarios.json
 *   npm run usuarios -- --ver   solo muestra lo que haria, no toca la base
 *
 * A diferencia de `npm run seed` (que siembra usuarios de prueba con claves
 * al azar), aqui las personas y sus claves las define usted en el archivo
 * usuarios.json de la raiz del proyecto. Ese archivo esta en .gitignore
 * porque lleva claves en claro: uselo, ejecute el script y borrelo.
 *
 * Formato de usuarios.json:
 *
 *   {
 *     "banca": { "codigo": "001", "nombre": "Banca DG - Principal" },
 *     "usuarios": [
 *       { "usuario": "gabriel", "nombre": "Gabriel Peralta",
 *         "rol": "admin", "clave": "...", "comision_pct": 0 },
 *       { "usuario": "vendedor1", "nombre": "Juan Perez",
 *         "rol": "vendedor", "clave": "...", "comision_pct": 10 }
 *     ],
 *     "desactivar": ["banca1", "cajero1"]
 *   }
 *
 * Es idempotente: si el usuario ya existe se le actualiza el nombre, el rol,
 * la comision y la clave, y se le cierran las sesiones abiertas.
 */

const fs = require('fs');
const path = require('path');
const { q, comprobar, cerrar } = require('./index');
const { hashPassword } = require('../lib/auth');
const { ROOT } = require('../config');

const soloVer = process.argv.includes('--ver');
const ARCHIVO = path.join(ROOT, 'usuarios.json');

const ROLES = ['admin', 'banca', 'vendedor'];
const LARGO_MIN_CLAVE = 8;

function fallar(mensaje) {
  console.error(`\n  ${mensaje}\n`);
  process.exit(1);
}

function leerDefinicion() {
  if (!fs.existsSync(ARCHIVO)) {
    console.error(`\n  No encuentro ${ARCHIVO}.`);
    console.error('  Cree ese archivo con los usuarios y sus claves.');
    console.error('  El formato esta en la cabecera de src/db/usuarios.js\n');
    process.exit(1);
  }

  let def;
  try {
    def = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  } catch (e) {
    fallar(`usuarios.json no es un JSON valido: ${e.message}`);
  }

  const lista = Array.isArray(def.usuarios) ? def.usuarios : [];
  if (!lista.length) fallar('usuarios.json no trae ningun usuario en "usuarios".');

  const vistos = new Set();
  for (const u of lista) {
    const nombre = String(u.usuario || '').toLowerCase().trim();
    if (!/^[a-z0-9._-]{3,30}$/.test(nombre)) {
      fallar(`"${u.usuario}" no sirve como nombre de usuario (3 a 30 caracteres: letras, numeros, . _ -).`);
    }
    if (vistos.has(nombre)) fallar(`"${nombre}" esta repetido en usuarios.json.`);
    vistos.add(nombre);
    u.usuario = nombre;

    if (!ROLES.includes(u.rol)) fallar(`El rol de "${nombre}" debe ser ${ROLES.join(', ')}.`);
    if (!String(u.nombre || '').trim()) fallar(`Falta el nombre completo de "${nombre}".`);
    if (String(u.clave || '').length < LARGO_MIN_CLAVE) {
      fallar(`La clave de "${nombre}" debe tener al menos ${LARGO_MIN_CLAVE} caracteres.`);
    }
    u.comision_pct = Number(u.comision_pct) || 0;
    if (u.comision_pct < 0 || u.comision_pct > 100) fallar(`La comision de "${nombre}" esta fuera de 0-100.`);
  }

  if (!lista.some((u) => u.rol === 'admin')) fallar('Tiene que haber al menos un usuario con rol admin.');

  return {
    banca: {
      codigo: String(def.banca?.codigo || '001').toUpperCase(),
      nombre: String(def.banca?.nombre || 'Banca DG - Principal'),
    },
    usuarios: lista,
    desactivar: (def.desactivar || []).map((s) => String(s).toLowerCase()),
  };
}

async function asegurarBanca(banca) {
  let fila = await q.uno('SELECT * FROM bancas WHERE codigo = ?', [banca.codigo]);
  if (!fila) {
    fila = await q.uno(
      'INSERT INTO bancas (codigo, nombre, activo) VALUES (?, ?, true) RETURNING *',
      [banca.codigo, banca.nombre]
    );
    console.log(`  Banca ${banca.codigo} creada.`);
  }
  return fila;
}

/**
 * El admin manda sobre todas las bancas, pero igual se le cuelga de una:
 * los tickets que el mismo facture tienen que salir de algun sitio.
 */
async function guardarUsuario(u, bancaId) {
  const existe = await q.uno('SELECT id FROM usuarios WHERE usuario = ?', [u.usuario]);
  const { hash, salt } = hashPassword(u.clave);

  if (existe) {
    await q.correr(
      `UPDATE usuarios SET nombre = ?, rol = ?, banca_id = ?, comision_pct = ?,
              password_hash = ?, password_salt = ?, activo = true
        WHERE id = ?`,
      [u.nombre, u.rol, bancaId, u.comision_pct, hash, salt, existe.id]
    );
    await q.correr('DELETE FROM sesiones WHERE usuario_id = ?', [existe.id]);
    return 'actualizado';
  }

  await q.correr(
    `INSERT INTO usuarios (banca_id, usuario, nombre, rol, password_hash, password_salt, comision_pct, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, true)`,
    [bancaId, u.usuario, u.nombre, u.rol, hash, salt, u.comision_pct]
  );
  return 'creado';
}

/**
 * Apaga los usuarios viejos. No los borra: si alguno vendio algo, sus tickets
 * tienen que seguir apuntando a alguien. Desactivado no puede entrar.
 */
async function desactivar(nombres, conservar) {
  const hechos = [];
  for (const nombre of nombres) {
    if (conservar.has(nombre)) continue;
    const u = await q.uno('SELECT id FROM usuarios WHERE usuario = ?', [nombre]);
    if (!u) continue;
    await q.correr('UPDATE usuarios SET activo = false WHERE id = ?', [u.id]);
    await q.correr('DELETE FROM sesiones WHERE usuario_id = ?', [u.id]);
    hechos.push(nombre);
  }
  return hechos;
}

function guardarResumen(def) {
  const archivo = path.join(ROOT, 'CLAVES-INICIALES.txt');
  const texto = [
    '===============================================',
    ' BANCA DG - Usuarios del sistema',
    ' Generado el ' + new Date().toISOString(),
    '===============================================',
    '',
    ...def.usuarios.map((u) =>
      `  ${u.usuario.padEnd(14)} ${u.clave.padEnd(18)} ${u.rol.padEnd(9)} ${u.nombre}`),
    '',
    ' GUARDE ESTAS CLAVES EN UN LUGAR SEGURO Y BORRE ESTE ARCHIVO.',
    ' Cada quien cambia la suya desde la aplicacion:',
    '   Configuracion -> Cambiar mi clave   (o el admin desde Usuarios).',
    '',
  ].join('\n');
  fs.writeFileSync(archivo, texto, { mode: 0o600 });
  return archivo;
}

(async () => {
  const def = leerDefinicion();

  console.log('\n  Usuarios que define usuarios.json:\n');
  for (const u of def.usuarios) {
    const extra = u.rol === 'vendedor' ? `   comision ${u.comision_pct}%` : '';
    console.log(`    ${u.usuario.padEnd(14)} ${u.rol.padEnd(9)} ${u.nombre}${extra}`);
  }
  if (def.desactivar.length) console.log(`\n  Se desactivaran: ${def.desactivar.join(', ')}`);

  if (soloVer) {
    console.log('\n  (--ver) No se toco la base de datos.\n');
    return cerrar();
  }

  console.log('\n  Conectando a la base de datos...');
  const estado = await comprobar();
  if (!estado.completo) {
    console.error(`\n  Faltan tablas: solo hay ${estado.tablas} de 12.`);
    console.error('  Ejecute supabase/schema.sql y supabase/002_metodo_pago.sql en Supabase.\n');
    process.exit(1);
  }
  console.log(`  Conectado a "${estado.base}".`);

  const banca = await asegurarBanca(def.banca);

  const hechos = [];
  for (const u of def.usuarios) {
    hechos.push({ ...u, accion: await guardarUsuario(u, banca.id) });
  }

  const conservar = new Set(def.usuarios.map((u) => u.usuario));
  const apagados = await desactivar(def.desactivar, conservar);

  const admins = Number(await q.valor("SELECT COUNT(*) FROM usuarios WHERE rol = 'admin' AND activo"));
  if (admins === 0) fallar('El resultado dejaria el sistema sin administradores activos. Revise usuarios.json.');

  console.log('');
  for (const h of hechos) console.log(`  ${h.accion.padEnd(12)} ${h.usuario.padEnd(14)} (${h.rol})`);
  if (apagados.length) console.log(`  desactivado  ${apagados.join(', ')}`);

  const archivo = guardarResumen(def);
  console.log(`\n  Resumen escrito en: ${archivo}`);
  console.log('  Repartalo, guardelo y borre ese archivo y usuarios.json.\n');

  await cerrar();
})().catch(async (e) => {
  console.error('\n  Fallo el alta de usuarios:', e.message);
  await cerrar();
  process.exit(1);
});
