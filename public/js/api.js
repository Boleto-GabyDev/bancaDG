// Cliente de la API. Todas las llamadas pasan por aqui.

async function pedir(metodo, ruta, datos, query) {
  let url = ruta.startsWith('/api') ? ruta : `/api${ruta}`;
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }

  const opciones = {
    method: metodo,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (datos !== undefined && datos !== null) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(datos);
  }

  let resp;
  try {
    resp = await fetch(url, opciones);
  } catch {
    throw new Error('No hay conexion con el servidor.');
  }

  const texto = await resp.text();
  let cuerpo = null;
  try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = { error: texto }; }

  if (!resp.ok) {
    const err = new Error(mensajeDeError(cuerpo, resp.status));
    err.status = resp.status;
    err.cuerpo = cuerpo;
    throw err;
  }
  return cuerpo;
}

/**
 * El error puede venir de la aplicacion ({ error: "texto" }) o de la propia
 * plataforma cuando la peticion ni siquiera llega a la app
 * ({ error: { code, message } }). Sin distinguirlos, lo segundo se veia en
 * pantalla como "[object Object]", que no le dice nada a nadie.
 */
function mensajeDeError(cuerpo, status) {
  const e = cuerpo && cuerpo.error;
  if (typeof e === 'string' && e.trim()) return e.slice(0, 300);
  if (e && typeof e === 'object' && e.message) return `${e.message} (${e.code || status})`;
  if (status === 404) {
    return 'La API no responde en esta direccion (404). Revise que el despliegue incluya la funcion de /api.';
  }
  return `Error ${status}`;
}

export const api = {
  get:  (ruta, query)       => pedir('GET', ruta, null, query),
  post: (ruta, datos, q)    => pedir('POST', ruta, datos ?? {}, q),
  put:  (ruta, datos)       => pedir('PUT', ruta, datos ?? {}),
  del:  (ruta, query)       => pedir('DELETE', ruta, null, query),
};
