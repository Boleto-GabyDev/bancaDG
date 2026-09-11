'use strict';

/**
 * Carga inicial contra Supabase.
 *
 *   npm run seed              crea lo que falte (idempotente, no pisa nada)
 *   npm run seed -- --reset-claves   regenera las claves de los usuarios base
 *
 * El catalogo (loterias, premios, topes, settings) lo siembra
 * supabase/schema.sql. Aqui se crean la banca y los usuarios, porque las
 * claves se cifran con scrypt y eso no se puede hacer desde SQL.
 *
 * Las claves se generan al azar y se muestran UNA sola vez. Tambien se
 * escriben en CLAVES-INICIALES.txt, que esta en .gitignore: leala, guardela
 * en su gestor de contrasenas y borre el archivo.
 */

const fs = require('fs');
const path = require('path');
const { q, comprobar, cerrar } = require('./index');
const { hashPassword, claveAleatoria } = require('../lib/auth');
const { ROOT } = require('../config');

const resetClaves = process.argv.includes('--reset-claves');

const USUARIOS_BASE = [
  { usuario: 'admin',   nombre: 'Administrador',    rol: 'admin',    comision: 0 },
  { usuario: 'banca1',  nombre: 'Encargado Banca',  rol: 'banca',    comision: 0 },
  { usuario: 'cajero1', nombre: 'Cajero Uno',       rol: 'vendedor', comision: 10 },
];

async function sembrarBanca() {
  let banca = await q.uno('SELECT * FROM bancas WHERE codigo = ?', ['001']);
  if (!banca) {
    banca = await q.uno(
      `INSERT INTO bancas (codigo, nombre) VALUES ('001', 'Banca DG - Principal') RETURNING *`
    );
    console.log('  Banca principal creada (codigo 001).');
  }
  return banca;
}

async function sembrarUsuarios(bancaId) {
  const creadas = [];

  for (const u of USUARIOS_BASE) {
    const existe = await q.uno('SELECT id FROM usuarios WHERE usuario = ?', [u.usuario]);

    if (existe && !resetClaves) continue;

    const clave = claveAleatoria(14);
    const { hash, salt } = hashPassword(clave);

    if (existe) {
      await q.correr(
        'UPDATE usuarios SET password_hash = ?, password_salt = ?, activo = true WHERE id = ?',
        [hash, salt, existe.id]
      );
      await q.correr('DELETE FROM sesiones WHERE usuario_id = ?', [existe.id]);
      creadas.push({ ...u, clave, accion: 'clave reiniciada' });
    } else {
      await q.correr(
        `INSERT INTO usuarios (banca_id, usuario, nombre, rol, password_hash, password_salt, comision_pct, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, true)`,
        [bancaId, u.usuario, u.nombre, u.rol, hash, salt, u.comision]
      );
      creadas.push({ ...u, clave, accion: 'creado' });
    }
  }
  return creadas;
}

function guardarClaves(creadas) {
  if (!creadas.length) return null;
  const archivo = path.join(ROOT, 'CLAVES-INICIALES.txt');
  const texto = [
    '===============================================',
    ' BANCA DG - Claves iniciales',
    ' Generadas el ' + new Date().toISOString(),
    '===============================================',
    '',
    ...creadas.map((c) => `  ${c.usuario.padEnd(10)} ${c.clave.padEnd(16)} (${c.rol}, ${c.accion})`),
    '',
    ' GUARDE ESTAS CLAVES EN UN LUGAR SEGURO Y BORRE ESTE ARCHIVO.',
    ' Cambielas desde la aplicacion: Configuracion -> Cambiar mi clave.',
    '',
  ].join('\n');

  fs.writeFileSync(archivo, texto, { mode: 0o600 });
  return archivo;
}

(async () => {
  console.log('\n  Conectando a la base de datos...');
  const estado = await comprobar();

  if (!estado.completo) {
    console.error(`\n  Faltan tablas: solo hay ${estado.tablas} de 12.`);
    console.error('  Ejecute primero, en el SQL Editor de Supabase:');
    console.error('    1. supabase/schema.sql');
    console.error('    2. supabase/002_metodo_pago.sql\n');
    process.exit(1);
  }

  const columnaPago = await q.uno(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tickets' AND column_name = 'metodo_pago'`
  );
  if (!columnaPago) {
    console.error('\n  Falta la migracion del metodo de cobro.');
    console.error('  Ejecute supabase/002_metodo_pago.sql en Supabase.\n');
    process.exit(1);
  }

  console.log(`  Conectado a "${estado.base}". Esquema completo.`);

  const banca = await sembrarBanca();
  const creadas = await sembrarUsuarios(banca.id);

  const loterias = Number(await q.valor('SELECT COUNT(*) FROM loterias'));
  const premios = Number(await q.valor('SELECT COUNT(*) FROM premios'));
  const topes = Number(await q.valor('SELECT COUNT(*) FROM limites'));
  const usuarios = Number(await q.valor('SELECT COUNT(*) FROM usuarios'));

  console.log(`\n  Loterias: ${loterias}   Premios: ${premios}   Topes: ${topes}   Usuarios: ${usuarios}`);

  if (creadas.length) {
    const archivo = guardarClaves(creadas);
    console.log('\n  ===============================================');
    console.log('   CLAVES GENERADAS (se muestran una sola vez)');
    console.log('  ===============================================');
    for (const c of creadas) {
      console.log(`   ${c.usuario.padEnd(10)} ${c.clave.padEnd(16)} ${c.rol}`);
    }
    console.log('  ===============================================');
    console.log(`   Tambien guardadas en: ${archivo}`);
    console.log('   Guardelas y borre ese archivo.\n');
  } else {
    console.log('\n  Los usuarios ya existian; no se toco ninguna clave.');
    console.log('  Para regenerarlas:  npm run seed -- --reset-claves\n');
  }

  await cerrar();
})().catch(async (e) => {
  console.error('\n  Fallo la carga inicial:', e.message);
  await cerrar();
  process.exit(1);
});
