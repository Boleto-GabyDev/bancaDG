'use strict';

/** Servidor local. En Vercel el punto de entrada es api/index.js. */

const os = require('os');
const { PORT, HOST, DATABASE_URL } = require('./config');
const { crearApp } = require('./app');
const { comprobar, cerrar, q } = require('./db');
const A = require('./lib/auth');
const F = require('./lib/dates');

function ipsLocales() {
  const out = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

/** Oculta la clave al mostrar la cadena de conexion. */
function urlSegura(url) {
  try {
    const u = new URL(url);
    u.password = '***';
    return `${u.host}${u.pathname}`;
  } catch {
    return '(cadena invalida)';
  }
}

async function arrancar() {
  let estado;
  try {
    estado = await comprobar();
  } catch (e) {
    console.error('\n  No se pudo conectar a la base de datos.');
    console.error(`  ${e.message.split('\n')[0]}`);
    console.error(`\n  Conexion configurada: ${urlSegura(DATABASE_URL)}`);
    console.error('  Revise DATABASE_URL en el archivo .env\n');
    process.exit(1);
  }

  if (!estado.completo) {
    console.error(`\n  La base responde pero le faltan tablas (${estado.tablas} de 12).`);
    console.error('  Ejecute supabase/schema.sql y supabase/002_metodo_pago.sql en Supabase.\n');
    process.exit(1);
  }

  const usuarios = Number(await q.valor('SELECT COUNT(*) FROM usuarios'));
  const app = crearApp();

  const servidor = app.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ===============================================');
    console.log('   BANCA DG - Sistema de venta de loterias');
    console.log('  ===============================================');
    console.log(`   Local:     http://localhost:${PORT}`);
    for (const ip of ipsLocales()) console.log(`   En la red: http://${ip}:${PORT}`);
    console.log(`   Base:      ${urlSegura(DATABASE_URL)}`);
    console.log(`   Fecha RD:  ${F.hoy()} ${F.horaActual()}`);
    if (usuarios === 0) console.log('   AVISO: no hay usuarios. Ejecute:  npm run seed');
    console.log('  ===============================================');
    console.log('   Para detener el servidor: Ctrl + C');
    console.log('');
  });

  const limpieza = setInterval(() => {
    A.limpiarSesiones().catch((e) => console.error('[sesiones]', e.message));
  }, 30 * 60 * 1000);
  limpieza.unref();

  const apagar = async () => {
    console.log('\nCerrando servidor...');
    clearInterval(limpieza);
    servidor.close(async () => { await cerrar(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
}

arrancar().catch((e) => {
  console.error('Fallo al arrancar:', e);
  process.exit(1);
});
