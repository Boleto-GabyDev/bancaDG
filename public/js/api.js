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
    const err = new Error((cuerpo && cuerpo.error) || `Error ${resp.status}`);
    err.status = resp.status;
    err.cuerpo = cuerpo;
    throw err;
  }
  return cuerpo;
}

export const api = {
  get:  (ruta, query)       => pedir('GET', ruta, null, query),
  post: (ruta, datos, q)    => pedir('POST', ruta, datos ?? {}, q),
  put:  (ruta, datos)       => pedir('PUT', ruta, datos ?? {}),
  del:  (ruta, query)       => pedir('DELETE', ruta, null, query),
};
