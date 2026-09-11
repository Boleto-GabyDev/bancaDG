'use strict';

const express = require('express');
const { q, getSetting, setSetting, allSettings, auditar, comprobar } = require('../db');
const A = require('../lib/auth');
const { ah, HttpError, texto, numero, booleano, unoDe } = require('../lib/http');
const { POSICIONES, DEFECTOS } = require('../domain/prizes');
const { normNumero, TIPOS } = require('../domain/plays');
const { evaluarFecha } = require('../domain/draws');
const F = require('../lib/dates');

const router = express.Router();
router.use(A.requiereAuth);

const soloAdmin = A.requiereRol('admin');
const adminOBanca = A.requiereRol('admin', 'banca');

const LARGO_MIN_CLAVE = 8;

const log = (req, accion, entidad, id, detalle) => auditar({
  usuario_id: req.usuario.id, usuario: req.usuario.usuario,
  accion, entidad, entidad_id: id, detalle, ip: A.ipDe(req),
});

const idNum = (fila) => ({ ...fila, id: Number(fila.id) });

// ===============================================================
// BANCAS
// ===============================================================
router.get('/bancas', adminOBanca, ah(async (req, res) => {
  const sql = `SELECT b.*, (SELECT COUNT(*) FROM usuarios u WHERE u.banca_id = b.id) AS usuarios
                 FROM bancas b`;
  const filas = req.usuario.rol === 'admin'
    ? await q.todos(`${sql} ORDER BY b.codigo`)
    : await q.todos(`${sql} WHERE b.id = ?`, [req.usuario.banca_id]);
  res.json({ bancas: filas.map((b) => ({ ...idNum(b), usuarios: Number(b.usuarios) })) });
}));

router.post('/bancas', soloAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const codigo = texto(b.codigo, { campo: 'Codigo', max: 10 }).toUpperCase();
  if (await q.uno('SELECT 1 FROM bancas WHERE codigo = ?', [codigo])) {
    throw new HttpError(409, 'Ya existe una banca con ese codigo.');
  }
  const fila = await q.uno(
    `INSERT INTO bancas (codigo, nombre, direccion, telefono, rnc, activo)
     VALUES (?, ?, ?, ?, ?, true) RETURNING id`,
    [codigo,
     texto(b.nombre, { campo: 'Nombre', max: 80 }),
     texto(b.direccion, { requerido: false, max: 120 }),
     texto(b.telefono, { requerido: false, max: 30 }),
     texto(b.rnc, { requerido: false, max: 20 })]
  );
  await log(req, 'banca_creada', 'banca', fila.id, codigo);
  res.status(201).json({ ok: true, id: Number(fila.id) });
}));

router.put('/bancas/:id', adminOBanca, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (req.usuario.rol === 'banca' && id !== req.usuario.banca_id) {
    throw new HttpError(403, 'Solo su propia banca.');
  }
  const actual = await q.uno('SELECT * FROM bancas WHERE id = ?', [id]);
  if (!actual) throw new HttpError(404, 'Banca no encontrada.');

  const b = req.body || {};
  await q.correr(
    `UPDATE bancas SET nombre = ?, direccion = ?, telefono = ?, rnc = ?, activo = ? WHERE id = ?`,
    [texto(b.nombre ?? actual.nombre, { campo: 'Nombre', max: 80 }),
     texto(b.direccion ?? actual.direccion, { requerido: false, max: 120 }),
     texto(b.telefono ?? actual.telefono, { requerido: false, max: 30 }),
     texto(b.rnc ?? actual.rnc, { requerido: false, max: 20 }),
     req.usuario.rol === 'admin' ? booleano(b.activo) : actual.activo,
     id]
  );
  await log(req, 'banca_editada', 'banca', id, actual.codigo);
  res.json({ ok: true });
}));

// ===============================================================
// USUARIOS
// ===============================================================
const SELECT_USUARIO = `
  SELECT u.id, u.usuario, u.nombre, u.rol, u.banca_id, u.comision_pct, u.activo,
         u.creado_en, u.ultimo_acceso, b.nombre AS banca, b.codigo AS banca_codigo
    FROM usuarios u LEFT JOIN bancas b ON b.id = u.banca_id`;

router.get('/usuarios', adminOBanca, ah(async (req, res) => {
  const filas = req.usuario.rol === 'admin'
    ? await q.todos(`${SELECT_USUARIO} ORDER BY u.rol, u.nombre`)
    : await q.todos(`${SELECT_USUARIO} WHERE u.banca_id = ? AND u.rol <> 'admin' ORDER BY u.rol, u.nombre`,
                    [req.usuario.banca_id]);
  res.json({
    usuarios: filas.map((u) => ({
      ...idNum(u),
      banca_id: u.banca_id === null ? null : Number(u.banca_id),
      comision_pct: Number(u.comision_pct) || 0,
    })),
  });
}));

router.post('/usuarios', adminOBanca, ah(async (req, res) => {
  const b = req.body || {};
  const usuario = texto(b.usuario, { campo: 'Usuario', min: 3, max: 30 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(usuario)) {
    throw new HttpError(400, 'El usuario solo admite letras, numeros, punto, guion y guion bajo.');
  }
  if (await q.uno('SELECT 1 FROM usuarios WHERE usuario = ?', [usuario])) {
    throw new HttpError(409, 'Ese nombre de usuario ya existe.');
  }

  // Si no mandan clave se genera una fuerte y se devuelve una sola vez.
  const generada = !b.clave;
  const clave = generada
    ? A.claveAleatoria(12)
    : texto(b.clave, { campo: 'La clave', min: LARGO_MIN_CLAVE, max: 64 });

  const rol = unoDe(b.rol, ['admin', 'banca', 'vendedor'], 'Rol');

  let bancaId = Number(b.banca_id) || null;
  if (req.usuario.rol === 'banca') {
    if (rol === 'admin') throw new HttpError(403, 'No puede crear administradores.');
    bancaId = req.usuario.banca_id;
  }
  if (rol !== 'admin' && !bancaId) throw new HttpError(400, 'Debe asignar una banca.');

  const { hash, salt } = A.hashPassword(clave);
  const fila = await q.uno(
    `INSERT INTO usuarios (banca_id, usuario, nombre, rol, password_hash, password_salt, comision_pct, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, true) RETURNING id`,
    [bancaId, usuario, texto(b.nombre, { campo: 'Nombre', max: 80 }), rol, hash, salt,
     numero(b.comision_pct ?? 0, { campo: 'Comision', min: 0, max: 100 })]
  );

  await log(req, 'usuario_creado', 'usuario', fila.id, `${usuario} (${rol})`);
  res.status(201).json({ ok: true, id: Number(fila.id), clave_generada: generada ? clave : undefined });
}));

router.put('/usuarios/:id', adminOBanca, ah(async (req, res) => {
  const id = Number(req.params.id);
  const u = await q.uno('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!u) throw new HttpError(404, 'Usuario no encontrado.');
  if (req.usuario.rol === 'banca') {
    if (Number(u.banca_id) !== req.usuario.banca_id || u.rol === 'admin') {
      throw new HttpError(403, 'Fuera de su alcance.');
    }
  }

  const b = req.body || {};
  const rol = b.rol ? unoDe(b.rol, ['admin', 'banca', 'vendedor'], 'Rol') : u.rol;
  if (req.usuario.rol === 'banca' && rol === 'admin') {
    throw new HttpError(403, 'No puede asignar el rol admin.');
  }

  const activo = b.activo === undefined ? u.activo : booleano(b.activo);

  // No dejar el sistema sin administradores activos.
  if (u.rol === 'admin' && (rol !== 'admin' || !activo)) {
    const otros = Number(await q.valor(
      `SELECT COUNT(*) FROM usuarios WHERE rol = 'admin' AND activo AND id <> ?`, [id]
    ));
    if (otros === 0) throw new HttpError(409, 'Debe quedar al menos un administrador activo.');
  }

  await q.correr(
    `UPDATE usuarios SET nombre = ?, rol = ?, banca_id = ?, comision_pct = ?, activo = ? WHERE id = ?`,
    [texto(b.nombre ?? u.nombre, { campo: 'Nombre', max: 80 }),
     rol,
     req.usuario.rol === 'banca' ? u.banca_id : (Number(b.banca_id) || u.banca_id),
     numero(b.comision_pct ?? u.comision_pct, { campo: 'Comision', min: 0, max: 100 }),
     activo, id]
  );

  let claveGenerada;
  if (b.clave || b.regenerar_clave) {
    const nueva = b.regenerar_clave && !b.clave
      ? A.claveAleatoria(12)
      : texto(b.clave, { campo: 'La clave', min: LARGO_MIN_CLAVE, max: 64 });
    const { hash, salt } = A.hashPassword(nueva);
    await q.correr('UPDATE usuarios SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, id]);
    await q.correr('DELETE FROM sesiones WHERE usuario_id = ?', [id]);
    if (b.regenerar_clave && !b.clave) claveGenerada = nueva;
    await log(req, 'clave_reiniciada', 'usuario', id, u.usuario);
  }

  // Un usuario desactivado no debe conservar sesiones abiertas.
  if (!activo) await q.correr('DELETE FROM sesiones WHERE usuario_id = ?', [id]);

  await log(req, 'usuario_editado', 'usuario', id, u.usuario);
  res.json({ ok: true, clave_generada: claveGenerada });
}));

router.delete('/usuarios/:id', soloAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) throw new HttpError(409, 'No puede eliminar su propio usuario.');

  const u = await q.uno('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!u) throw new HttpError(404, 'Usuario no encontrado.');

  const tiene = Number(await q.valor('SELECT COUNT(*) FROM tickets WHERE usuario_id = ?', [id]));
  if (tiene > 0) {
    await q.correr('UPDATE usuarios SET activo = false WHERE id = ?', [id]);
    await q.correr('DELETE FROM sesiones WHERE usuario_id = ?', [id]);
    await log(req, 'usuario_desactivado', 'usuario', id, `${u.usuario} (tiene ${tiene} tickets)`);
    return res.json({
      ok: true, desactivado: true,
      mensaje: 'El usuario tiene tickets: se desactivo en lugar de borrarse.',
    });
  }

  await q.correr('DELETE FROM usuarios WHERE id = ?', [id]);
  await log(req, 'usuario_eliminado', 'usuario', id, u.usuario);
  res.json({ ok: true, desactivado: false });
}));

// ===============================================================
// LOTERIAS
// ===============================================================
router.get('/loterias', soloAdmin, ah(async (req, res) => {
  const filas = await q.todos('SELECT * FROM loterias ORDER BY orden, nombre');
  res.json({ loterias: filas.map((l) => ({ ...idNum(l), hora_cierre: String(l.hora_cierre).slice(0, 5) })) });
}));

function datosLoteria(b, actual = {}) {
  const hora = texto(b.hora_cierre ?? actual.hora_cierre, { campo: 'Hora de cierre', max: 8 }).slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(hora)) throw new HttpError(400, 'La hora de cierre debe tener formato HH:MM.');
  const dias = texto(b.dias ?? actual.dias, { campo: 'Dias', max: 20 });
  if (!/^[1-7](,[1-7])*$/.test(dias)) {
    throw new HttpError(400, 'Los dias deben ser numeros del 1 al 7 separados por coma.');
  }
  return {
    nombre: texto(b.nombre ?? actual.nombre, { campo: 'Nombre', max: 60 }),
    pais: texto(b.pais ?? actual.pais ?? 'RD', { requerido: false, max: 4 }) || 'RD',
    color: texto(b.color ?? actual.color ?? '#1565C0', { requerido: false, max: 9 }) || '#1565C0',
    hora_cierre: hora,
    minutos_previos: numero(b.minutos_previos ?? actual.minutos_previos ?? 0,
                            { campo: 'Minutos previos', min: 0, max: 600, entero: true }),
    dias,
    orden: numero(b.orden ?? actual.orden ?? 0, { campo: 'Orden', min: 0, max: 999, entero: true }),
    activo: booleano(b.activo ?? actual.activo),
    q_quiniela: booleano(b.q_quiniela ?? actual.q_quiniela),
    q_pale: booleano(b.q_pale ?? actual.q_pale),
    q_tripleta: booleano(b.q_tripleta ?? actual.q_tripleta),
    q_superpale: booleano(b.q_superpale ?? actual.q_superpale),
  };
}

router.post('/loterias', soloAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const codigo = texto(b.codigo, { campo: 'Codigo', max: 15 }).toUpperCase().replace(/\s+/g, '_');
  if (await q.uno('SELECT 1 FROM loterias WHERE codigo = ?', [codigo])) {
    throw new HttpError(409, 'Ya existe una loteria con ese codigo.');
  }
  const d = datosLoteria(b, {
    activo: true, q_quiniela: true, q_pale: true, q_tripleta: true, q_superpale: false,
    dias: '1,2,3,4,5,6',
  });
  const fila = await q.uno(
    `INSERT INTO loterias (codigo, nombre, pais, color, hora_cierre, minutos_previos, dias, orden, activo,
                           q_quiniela, q_pale, q_tripleta, q_superpale)
     VALUES (@codigo, @nombre, @pais, @color, @hora_cierre::time, @minutos_previos, @dias, @orden, @activo,
             @q_quiniela, @q_pale, @q_tripleta, @q_superpale)
     RETURNING id`,
    { codigo, ...d }
  );
  await log(req, 'loteria_creada', 'loteria', fila.id, codigo);
  res.status(201).json({ ok: true, id: Number(fila.id) });
}));

router.put('/loterias/:id', soloAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const actual = await q.uno('SELECT * FROM loterias WHERE id = ?', [id]);
  if (!actual) throw new HttpError(404, 'Loteria no encontrada.');
  actual.hora_cierre = String(actual.hora_cierre).slice(0, 5);

  const d = datosLoteria(req.body || {}, actual);
  await q.correr(
    `UPDATE loterias SET nombre=@nombre, pais=@pais, color=@color, hora_cierre=@hora_cierre::time,
            minutos_previos=@minutos_previos, dias=@dias, orden=@orden, activo=@activo,
            q_quiniela=@q_quiniela, q_pale=@q_pale, q_tripleta=@q_tripleta, q_superpale=@q_superpale
      WHERE id=@id`,
    { id, ...d }
  );
  await log(req, 'loteria_editada', 'loteria', id, actual.codigo);
  res.json({ ok: true });
}));

router.delete('/loterias/:id', soloAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const usos = Number(await q.valor(
    'SELECT COUNT(*) FROM jugadas WHERE loteria_id = ? OR loteria2_id = ?', [id, id]
  ));
  if (usos > 0) {
    await q.correr('UPDATE loterias SET activo = false WHERE id = ?', [id]);
    await log(req, 'loteria_desactivada', 'loteria', id, `${usos} jugadas`);
    return res.json({
      ok: true, desactivada: true,
      mensaje: 'La loteria tiene jugadas: se desactivo en lugar de borrarse.',
    });
  }
  await q.correr('DELETE FROM loterias WHERE id = ?', [id]);
  await log(req, 'loteria_eliminada', 'loteria', id, '');
  res.json({ ok: true, desactivada: false });
}));

// ===============================================================
// PREMIOS (multiplicadores)
// ===============================================================
router.get('/premios', soloAdmin, ah(async (req, res) => {
  const premios = await q.todos(
    `SELECT p.*, l.nombre AS loteria, l.codigo AS loteria_codigo
       FROM premios p LEFT JOIN loterias l ON l.id = p.loteria_id
      ORDER BY (p.loteria_id IS NOT NULL), l.orden NULLS FIRST, p.tipo, p.posicion`
  );
  res.json({
    premios: premios.map((p) => ({
      ...idNum(p),
      loteria_id: p.loteria_id === null ? null : Number(p.loteria_id),
      multiplicador: Number(p.multiplicador),
    })),
    posiciones: POSICIONES,
    defectos: DEFECTOS,
  });
}));

router.post('/premios', soloAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const tipo = unoDe(b.tipo, Object.keys(POSICIONES), 'Tipo');
  const posicion = unoDe(b.posicion, POSICIONES[tipo], 'Posicion');
  const loteriaId = b.loteria_id ? Number(b.loteria_id) : null;
  const mult = numero(b.multiplicador, { campo: 'Multiplicador', min: 0, max: 1000000 });

  await q.correr(
    `INSERT INTO premios (loteria_id, tipo, posicion, multiplicador) VALUES (?, ?, ?, ?)
     ON CONFLICT (COALESCE(loteria_id, 0), tipo, posicion)
     DO UPDATE SET multiplicador = excluded.multiplicador`,
    [loteriaId, tipo, posicion, mult]
  );

  await log(req, 'premio_actualizado', 'premio', `${loteriaId || 'global'}/${tipo}/${posicion}`, `x${mult}`);
  res.json({ ok: true });
}));

router.delete('/premios/:id', soloAdmin, ah(async (req, res) => {
  const p = await q.uno('SELECT * FROM premios WHERE id = ?', [Number(req.params.id)]);
  if (!p) throw new HttpError(404, 'Premio no encontrado.');
  if (p.loteria_id === null) {
    throw new HttpError(409, 'No se puede borrar un multiplicador global; edite su valor.');
  }
  await q.correr('DELETE FROM premios WHERE id = ?', [p.id]);
  await log(req, 'premio_eliminado', 'premio', p.id, `${p.tipo}/${p.posicion}`);
  res.json({ ok: true });
}));

// ===============================================================
// LIMITES (topes por numero)
// ===============================================================
router.get('/limites', adminOBanca, ah(async (req, res) => {
  const limites = await q.todos(
    `SELECT li.*, l.nombre AS loteria, l.codigo AS loteria_codigo
       FROM limites li LEFT JOIN loterias l ON l.id = li.loteria_id
      ORDER BY (li.numero IS NOT NULL), (li.loteria_id IS NOT NULL), li.tipo, li.numero NULLS FIRST`
  );
  res.json({
    limites: limites.map((l) => ({
      ...idNum(l),
      loteria_id: l.loteria_id === null ? null : Number(l.loteria_id),
      monto_max: Number(l.monto_max),
    })),
  });
}));

router.post('/limites', soloAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const tipo = unoDe(b.tipo, Object.keys(TIPOS), 'Tipo');
  const loteriaId = b.loteria_id ? Number(b.loteria_id) : null;
  const monto = numero(b.monto_max, { campo: 'Monto maximo', min: 0, max: 10000000 });

  let numeros = null;
  if (b.numero !== undefined && b.numero !== null && String(b.numero).trim() !== '') {
    const partes = String(b.numero).split('-').map(normNumero);
    if (partes.some((p) => p === null) || partes.length !== TIPOS[tipo].cantidad) {
      throw new HttpError(400,
        `Para ${TIPOS[tipo].nombre} el numero debe tener ${TIPOS[tipo].cantidad} valor(es) de 00 a 99.`);
    }
    numeros = partes.sort().join('-');
  }

  await q.correr(
    `INSERT INTO limites (loteria_id, tipo, numero, monto_max) VALUES (?, ?, ?, ?)
     ON CONFLICT (COALESCE(loteria_id, 0), tipo, COALESCE(numero, '*'))
     DO UPDATE SET monto_max = excluded.monto_max`,
    [loteriaId, tipo, numeros, monto]
  );

  await log(req, 'limite_actualizado', 'limite',
            `${loteriaId || 'global'}/${tipo}/${numeros || '*'}`, String(monto));
  res.json({ ok: true });
}));

router.delete('/limites/:id', soloAdmin, ah(async (req, res) => {
  const l = await q.uno('SELECT * FROM limites WHERE id = ?', [Number(req.params.id)]);
  if (!l) throw new HttpError(404, 'Limite no encontrado.');
  await q.correr('DELETE FROM limites WHERE id = ?', [l.id]);
  await log(req, 'limite_eliminado', 'limite', l.id, `${l.tipo}/${l.numero || '*'}`);
  res.json({ ok: true });
}));

// ===============================================================
// CONFIGURACION
// ===============================================================
const CLAVES_TEXTO = ['empresa_nombre', 'empresa_lema', 'empresa_rnc', 'empresa_telefono',
  'empresa_direccion', 'ticket_mensaje', 'ticket_pie', 'moneda'];
const CLAVES_NUM = ['monto_minimo', 'monto_maximo', 'max_jugadas_ticket',
  'minutos_cancelacion', 'dias_validez_premio'];
const CLAVES_BOOL = ['pagar_repetidos', 'permitir_venta_cerrada', 'bloquear_sin_resultados'];

router.get('/config', soloAdmin, ah(async (req, res) => res.json({ config: await allSettings() })));

router.put('/config', soloAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const cambios = [];
  for (const k of CLAVES_TEXTO) {
    if (k in b) { await setSetting(k, texto(b[k], { requerido: false, max: 200 })); cambios.push(k); }
  }
  for (const k of CLAVES_NUM) {
    if (k in b) { await setSetting(k, numero(b[k], { campo: k, min: 0, max: 1000000 })); cambios.push(k); }
  }
  for (const k of CLAVES_BOOL) {
    if (k in b) { await setSetting(k, booleano(b[k])); cambios.push(k); }
  }
  await log(req, 'config_actualizada', 'settings', '', cambios.join(', '));
  res.json({ ok: true, config: await allSettings() });
}));

// ===============================================================
// AUDITORIA
// ===============================================================
router.get('/auditoria', adminOBanca, ah(async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 200, 1000);
  const desde = F.esFecha(req.query.desde) ? req.query.desde : F.sumarDias(F.hoy(), -7);
  const hasta = F.esFecha(req.query.hasta) ? req.query.hasta : F.hoy();
  // fecha_rd() convierte el instante a la fecha de operacion dominicana.
  const filas = await q.todos(
    `SELECT a.* FROM auditoria a
      WHERE fecha_rd(a.creado_en) BETWEEN ?::date AND ?::date
      ORDER BY a.id DESC LIMIT ?`,
    [desde, hasta, limite]
  );
  res.json({ auditoria: filas.map(idNum), desde, hasta });
}));

// ===============================================================
// MANTENIMIENTO
// ===============================================================
router.post('/reevaluar', soloAdmin, ah(async (req, res) => {
  const fecha = F.esFecha(req.body.fecha) ? req.body.fecha : F.hoy();
  res.json({ ok: true, fecha, resumen: await evaluarFecha(fecha) });
}));

router.get('/estado', soloAdmin, ah(async (req, res) => {
  const cuenta = (t) => q.valor(`SELECT COUNT(*) FROM ${t}`);
  const [tickets, jugadas, resultados, usuarios, loterias, sesiones, base] = await Promise.all([
    cuenta('tickets'), cuenta('jugadas'), cuenta('resultados'),
    cuenta('usuarios'), cuenta('loterias'), cuenta('sesiones'), comprobar(),
  ]);
  res.json({
    tickets: Number(tickets), jugadas: Number(jugadas), resultados: Number(resultados),
    usuarios: Number(usuarios), loterias: Number(loterias), sesiones: Number(sesiones),
    version: require('../../package.json').version,
    node: process.version,
    base: base.base,
    esquema_completo: base.completo,
    hoy: F.hoy(),
    hora: F.horaActual(),
  });
}));

module.exports = router;
