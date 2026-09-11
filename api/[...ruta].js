'use strict';

/**
 * Punto de entrada en Vercel.
 *
 * Es una ruta comodin: atrapa /api/tickets, /api/reportes/panel y cualquier
 * otra, y le entrega la peticion a Express con la URL original intacta.
 *
 * Se usa un comodin en vez de un `rewrite` hacia una funcion unica porque el
 * rewrite deja la ruta final en manos de como Vercel decida reescribirla; con
 * el comodin, `req.url` es siempre la que pidio el navegador y el enrutador de
 * Express funciona igual que en local.
 *
 * La app se construye una sola vez por instancia: mientras Vercel reutilice el
 * contenedor, se reaprovechan el pool de conexiones y el cache de settings.
 */

const { crearApp } = require('../src/app');

let app;

module.exports = (req, res) => {
  if (!app) app = crearApp();
  return app(req, res);
};
