'use strict';

/**
 * Construccion de la aplicacion Express.
 *
 * Este modulo NO abre el puerto: solo arma la app. Asi el mismo codigo sirve
 * para el servidor local (src/server.js) y para la funcion de Vercel
 * (api/index.js), que necesita exportar un manejador en vez de escuchar.
 */

const path = require('path');
const express = require('express');

const { PUBLIC_DIR, PRODUCCION, EN_VERCEL } = require('./config');
const A = require('./lib/auth');
const { HttpError } = require('./lib/http');
const F = require('./lib/dates');
const { comprobar } = require('./db');

function crearApp() {
  const app = express();
  app.disable('x-powered-by');

  // Detras de Vercel las peticiones llegan por un proxy: sin esto, la IP de
  // auditoria seria la del proxy y la cookie `secure` no se negociaria bien.
  app.set('trust proxy', true);

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // --- Cabeceras de seguridad ------------------------------------
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (PRODUCCION) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  // --- Limpieza de sesiones vencidas -----------------------------
  // En serverless no hay proceso vivo para un setInterval, asi que la
  // limpieza se hace de vez en cuando aprovechando una peticion cualquiera.
  // Una sesion vencida no da acceso (la consulta filtra por expira_en), esto
  // es solo higiene de la tabla.
  app.use((req, res, next) => {
    if (Math.random() < 0.005) {
      A.limpiarSesiones().catch((e) => console.error('[sesiones]', e.message));
    }
    next();
  });

  app.use(A.cargarUsuario);

  // --- API -------------------------------------------------------
  const { router: authRouter } = require('./routes/auth.routes');
  app.use('/api/auth', authRouter);
  app.use('/api/catalogo', require('./routes/catalogo.routes'));
  app.use('/api/tickets', require('./routes/tickets.routes'));
  app.use('/api/resultados', require('./routes/resultados.routes'));
  app.use('/api/reportes', require('./routes/reportes.routes'));
  app.use('/api/admin', require('./routes/admin.routes'));

  app.get('/api/salud', async (req, res) => {
    try {
      const base = await comprobar();
      res.json({
        ok: true,
        hoy: F.hoy(),
        hora: F.horaActual(),
        version: require('../package.json').version,
        base: base.base,
        esquema_completo: base.completo,
        entorno: EN_VERCEL ? 'vercel' : 'local',
      });
    } catch (e) {
      res.status(503).json({ ok: false, error: 'Sin conexion con la base de datos: ' + e.message });
    }
  });

  app.use('/api', (req, res) =>
    res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` }));

  // --- Frontend --------------------------------------------------
  // En Vercel los estaticos los sirve el CDN y esto no llega a usarse; en
  // local es lo que entrega la interfaz.
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: PRODUCCION ? '1h' : 0 }));
  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // --- Errores ---------------------------------------------------
  app.use((err, req, res, _next) => {
    const status = err instanceof HttpError ? err.status : (err.status || 500);
    if (status >= 500) console.error('[error]', err);

    // Nunca devolver detalles internos de Postgres al navegador. La excepcion
    // es un fallo de instalacion (falta DATABASE_URL y demas): ese hay que
    // decirlo, porque sin verlo nadie sabe que tiene que ir a configurar.
    const mensaje = err.configuracion
      ? err.message
      : status >= 500
        ? 'Error interno del servidor. Intente de nuevo.'
        : (err.message || 'Solicitud invalida.');
    res.status(status).json({ error: mensaje });
  });

  return app;
}

module.exports = { crearApp };
