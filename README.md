# Banca DG — Sistema de venta de loterías

Sistema web para administrar una banca de lotería dominicana: punto de venta,
facturación e impresión de tickets, carga de resultados, cálculo automático de
premios, pago, control de riesgo por número, comisiones, cierre de caja y
reportes.

**Arquitectura:** Node.js + Express sobre PostgreSQL (Supabase), desplegado en
Vercel. El navegador nunca habla con Supabase: todo pasa por la API, que es
quien aplica los permisos por rol.

---

## Puesta en marcha

### 1. Base de datos (Supabase)

En **SQL Editor → New query**, ejecute en orden:

1. `supabase/schema.sql` — tablas, índices, RLS y catálogo inicial
2. `supabase/002_metodo_pago.sql` — columnas de forma de cobro

Ambos son idempotentes: se pueden volver a ejecutar sin romper nada.

### 2. Conexión

Copie `.env.example` a `.env` y complete `DATABASE_URL` con la cadena de
Supabase: **Project Settings → Database → Connection string → Transaction
pooler**.

```
DATABASE_URL=postgresql://postgres.xxxx@aws-0-us-east-1.pooler.supabase.com:6543/postgres
DATABASE_PASSWORD=la-clave-de-la-base
```

> **No use la conexión directa** (`db.<proyecto>.supabase.co:5432`): ese host
> solo resuelve por IPv6 y Vercel no tiene salida IPv6, así que fallaría en
> producción. El pooler es IPv4 y además multiplexa conexiones, que es lo que
> necesita un entorno serverless.
>
> En el pooler el usuario lleva el código del proyecto pegado
> (`postgres.<proyecto>`), no es solo `postgres`. La clave va en
> `DATABASE_PASSWORD` para que no importe si trae símbolos.

### 3. Usuarios

```bash
npm install
npm run seed
```

Crea la banca `001` y tres usuarios con **claves aleatorias fuertes**, que se
muestran una sola vez y se guardan en `CLAVES-INICIALES.txt` (ignorado por git).
Léalas, guárdelas en su gestor de contraseñas y borre el archivo.

Para regenerarlas: `npm run seed -- --reset-claves`.

### 4. Correr en local

```bash
npm start          # http://localhost:3000
```

En Windows: doble clic en `Iniciar local.bat`.

---

## Despliegue en Vercel

1. Suba el repositorio a GitHub.
2. En Vercel: **Add New → Project → Import** del repositorio.
3. Framework Preset: **Other**. No hace falta build command. (Vercel puede
   autodetectar "Express"; cámbielo a Other: aquí no hay un servidor que
   escuche un puerto, sino una función serverless en `api/`.)
4. En **Settings → Environment Variables** agregue exactamente dos:
   `DATABASE_URL` y `DATABASE_PASSWORD`, para Production, Preview y
   Development.

   **No** agregue `PORT`: en serverless no se usa, la plataforma decide.
5. Deploy.

`vercel.json` ya enruta `/api/*` a la función y sirve `public/` como estático.

### Sobre la región

`vercel.json` fija `"regions": ["iad1"]` (Washington DC = us-east-1), la misma
región donde está la base en Supabase. Esto importa: una venta hace unas diez
consultas, y cruzar regiones las convierte en diez viajes de ~50 ms en vez de
diez de ~2 ms — la diferencia entre facturar en medio segundo o en cinco.

Si alguna vez mueve el proyecto de Supabase a otra región, cambie ese valor.

> `vercel.json` se valida contra un esquema estricto: no admite propiedades
> que no estén en él (no se pueden dejar comentarios dentro del archivo).

Después del primer deploy, verifique:

```
https://SU-APP.vercel.app/api/salud
```

Debe responder `{"ok":true,"esquema_completo":true,...}`.

### Cosas que cambian por ser serverless

- **No hay proceso permanente.** La limpieza de sesiones vencidas se hace de
  forma oportunista en una de cada doscientas peticiones. Una sesión vencida
  nunca da acceso: la consulta filtra por `expira_en > now()`.
- **El control de fuerza bruta es por instancia.** Cada contenedor lleva su
  propia cuenta de intentos fallidos, así que estorba a un atacante pero no lo
  detiene del todo. La defensa real son las claves largas y el hash `scrypt`.
- **Sin internet no hay sistema.** Con Supabase como única base, si se cae la
  conexión de la banca no se puede vender. Es la contrapartida de tener todo en
  la nube y varias sucursales viendo los mismos datos.

---

## Roles

| Rol | Qué puede hacer |
|-----|-----------------|
| **Cajero** | Facturar, anular dentro de la ventana permitida, pagar premios de su banca, ver sus reportes y su cierre de caja. |
| **Encargado** | Todo lo del cajero para **toda su banca**, más cargar resultados, ver riesgo, administrar sus cajeros y la auditoría. |
| **Administrador** | Todo: loterías, multiplicadores, topes, bancas, configuración y mantenimiento. |

---

## Tipos de jugada

| Jugada | Números | Gana cuando | Paga por defecto |
|--------|---------|-------------|------------------|
| **Quiniela** | 1 | sale en 1ra / 2da / 3ra | x60 / x20 / x10 |
| **Palé** | 2 | los dos salen entre 1ra y 2da | x1000 |
| **Palé c/3ra** | 2 | los dos salen usando la 3ra | x100 |
| **Tripleta** | 3 | los tres salen en 1ra, 2da y 3ra | x12000 |
| **Super Palé** | 2 | uno en la 1ra de cada una de dos loterías | x2000 |

Todos los multiplicadores se editan en **Loterías y pagos**, de forma general o
con excepciones por lotería. Un multiplicador en `0` desactiva ese premio.

---

## Cómo se factura

En **Punto de venta**:

1. Marque una o varias loterías (las cerradas aparecen en gris).
2. Escriba los números: **2 dígitos = quiniela**, **4 = palé**, **6 = tripleta**.
3. Escriba el monto y presione **Agregar**. La jugada se aplica a todas las
   loterías marcadas.
4. Elija la **forma de cobro** — efectivo o transferencia (esta última exige el
   número de referencia).
5. **Facturar e imprimir**. El ticket sale en el acto; es el comprobante.

Para **Super Palé** marque la casilla, elija la lotería principal en la lista y
la segunda en el desplegable.

| Tecla | Acción |
|-------|--------|
| `Enter` | del campo de números pasa al monto; del monto, agrega |
| `F2` | facturar e imprimir |
| `F3` | volver al campo de números |
| `F4` | limpiar el ticket |

---

## Control de riesgo (topes)

Un **tope** es el monto máximo que la banca acepta de un mismo número, por
lotería y por fecha. Se configuran en **Límites de venta** y se aplican del más
específico al más general:

1. Lotería + tipo + número exacto
2. Todas las loterías + tipo + número exacto
3. Lotería + tipo
4. Todas las loterías + tipo

De fábrica: quiniela 3 000, palé 1 000, tripleta 300, super palé 500.

En **Riesgo y topes** se ve cuánto se vendió de cada número, cuánto habría que
pagar si sale (exposición) y cuánto queda disponible. Anular un ticket libera el
tope automáticamente.

---

## Resultados y premios

En **Resultados** se digitan las tres posiciones y se guarda. El sistema evalúa
al instante todos los tickets afectados. Un ticket con jugadas en varias
loterías sigue `activo` hasta que estén todos los sorteos.

Si se digitó mal, se corrige y se guarda de nuevo: los premios se recalculan
solos, sin duplicar. Un resultado no se puede borrar si ya hay tickets pagados
con él.

Para cobrar: **Pagar premio** → código del ticket → verificar → elegir si se
entrega en efectivo o por transferencia. Se imprime un comprobante con espacio
para firma y cédula. No deja pagar dos veces ni fuera del plazo.

---

## Cierre de caja

Separa el dinero físico del resto, que es lo que importa para cuadrar:

```
efectivo a entregar = venta en efectivo
                    - premios entregados en efectivo
                    - comisión del cajero
```

Lo cobrado por transferencia suma a la venta pero **no** entra a la gaveta, y un
premio pagado por transferencia tampoco la vacía. El balance contable del día se
muestra aparte.

---

## Impresión

Los tickets están diseñados para **rollo térmico de 58 mm**. Configure la
impresora como predeterminada y, en el diálogo de impresión, desactive
encabezados y pies de página y deje los márgenes al mínimo.

Para probar sin facturar: Configuración → **Imprimir ticket de prueba**.

---

## Pruebas

Con el servidor levantado:

```bash
ADMIN_CLAVE=su-clave node pruebas/e2e.js
```

Contra un despliegue:

```bash
BASE=https://su-app.vercel.app ADMIN_CLAVE=su-clave node pruebas/e2e.js
```

Crea dos loterías `TEST1`/`TEST2`, vende, publica resultados, verifica los
premios peso por peso, cobra, comprueba el cuadre de caja y deja todo
desactivado al terminar. **No lo corra contra la base de producción una vez que
tenga ventas reales**: escribe tickets de prueba.

---

## Detalles técnicos

- **Base:** PostgreSQL. El dinero es `numeric(14,2)` (exacto, sin coma
  flotante); las marcas de tiempo son `timestamptz` y la fecha de operación se
  deriva con `fecha_rd()`, así que el sistema cuadra con el día dominicano sin
  importar dónde corra el servidor.
- **RLS:** activado en todas las tablas y sin policies. Las claves públicas de
  Supabase (`anon`, `authenticated`) no ven nada; solo el servidor, con la
  cadena de conexión, accede a los datos.
- **Claves:** `scrypt` con sal por usuario. Nunca se guardan en claro.
- **Sesiones:** cookie `httpOnly`, `sameSite=lax` y `secure` en producción,
  12 horas de vigencia.
- **Auditoría:** cada venta, anulación, pago, resultado y cambio de
  configuración queda registrado con usuario, hora e IP.

### Comandos

```bash
npm start      # servidor local
npm run dev    # con recarga automática
npm run seed   # crear banca y usuarios (idempotente)
npm run salud  # comprobar la conexión a la base
```

### Estructura

```
api/index.js           punto de entrada de Vercel
src/
  app.js               construccion de la app Express
  server.js            servidor local
  config.js            .env, puerto, zona horaria
  db/
    index.js           pool de Postgres, tipos, transacciones, settings
    sql.js             traduccion de marcadores ? y @nombre a $n
    seed.js            banca y usuarios iniciales
  lib/                 fechas RD, autenticacion, validacion HTTP
  domain/              reglas del negocio
    plays.js             tipos de jugada y normalizacion de numeros
    prizes.js            motor de premios (funcion pura)
    limits.js            topes por numero
    sales.js             apertura de sorteos, facturacion, anulacion, cobro
    draws.js             resultados y reevaluacion en lote
    reports.js           ventas, premios, comisiones, riesgo, cierre
  routes/              API REST por area
public/                interfaz (HTML, CSS y modulos ES, sin build)
supabase/              migraciones SQL
pruebas/e2e.js         prueba de extremo a extremo
```

---

## Seguridad

- Cambie las claves generadas por unas propias y borre `CLAVES-INICIALES.txt`.
- `DATABASE_URL` da acceso total a la base: va en variables de entorno de
  Vercel, **nunca** en el repositorio.
- Si rota la contraseña de la base en Supabase, actualice la variable en Vercel
  y vuelva a desplegar.

---

## Cumplimiento

La venta de loterías en República Dominicana está regulada por la Dirección de
Casinos y Juegos de Azar del Ministerio de Hacienda. Este programa es la
herramienta administrativa de la banca; quien lo opera es responsable de contar
con la licencia y los permisos correspondientes y de cumplir con sus
obligaciones fiscales.
