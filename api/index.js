'use strict';

/**
 * Punto de entrada en Vercel.
 *
 * Vercel invoca esta funcion por cada peticion a /api/*. La app de Express es
 * un manejador (req, res) normal, asi que se exporta tal cual.
 *
 * La app se construye una sola vez por instancia: mientras Vercel reutilice
 * el contenedor, se reaprovechan el pool de conexiones y el cache de settings.
 */

const { crearApp } = require('../src/app');

let app;
function obtenerApp() {
  if (!app) app = crearApp();
  return app;
}

module.exports = (req, res) => obtenerApp()(req, res);
