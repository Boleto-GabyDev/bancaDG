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
cp usuarios.ejemplo.json usuarios.json     # en Windows: copy
```

Abra `usuarios.json` y ponga las personas reales: el administrador y sus
vendedores, cada uno con su clave (mínimo 8 caracteres) y su comisión. Después:

```bash
npm run usuarios -- --ver   # muestra lo que haría, sin tocar la base
npm run usuarios            # lo aplica
```

Crea la banca, da de alta a cada quien y **desactiva** los usuarios que liste
en `"desactivar"`. Es idempotente: si lo vuelve a correr, actualiza nombre,
rol, comisión y clave. El resumen queda en `CLAVES-INICIALES.txt`.

> `usuarios.json` y `CLAVES-INICIALES.txt` llevan claves en claro y están
> ignorados por git. Repártalas y **borre los dos archivos**.

Para una instalación de prueba con claves aleatorias existe `npm run seed`,
que crea `admin`, `banca1` y `cajero1`. No lo use en producción.

### 4. Correr en local

```bash
npm start          # http://localhost:3000
```

En Windows: doble clic en `Iniciar local.bat`.

---

## Despliegue en Vercel

1. Suba el repositorio a GitHub.
2. En Vercel: **Add New → Project → Import** del repositorio.
3. El Framework Preset no hay que tocarlo: `vercel.json` lo fija en "Other" y
   eso tiene prioridad sobre lo que muestre la interfaz. (Vercel suele
   autodetectar "Express" y buscar un servidor que escuche un puerto; aquí no
   hay tal cosa, sino una función serverless en `api/`.)
4. En **Settings → Environment Variables** agregue exactamente dos:
   `DATABASE_URL` y `DATABASE_PASSWORD`, para Production, Preview y
   Development.

   **No** agregue `PORT`: en serverless no se usa, la plataforma decide.
5. Deploy.

`vercel.json` deja fijado en el repositorio el preset (`"framework": null`, es
decir "Other"), la región y el directorio estático, para que el despliegue no
dependa de lo que se haya elegido a mano en la interfaz.

La API entra por `api/[...ruta].js`, una ruta comodín que atrapa todo `/api/*`
y se lo pasa a Express con la URL original intacta.

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
| **Vendedor** (cajero) | Facturar, anular sus propios tickets dentro de la ventana permitida, consultar los números ganadores y ver en **Mi día** cuánto lleva facturado. Nada más. |
| **Encargado** de banca | Todo lo anterior para **toda su banca**, más pagar premios, cargar resultados, ver riesgo y reportes, firmar el cierre de caja, administrar sus cajeros y la auditoría. |
| **Administrador** | Todo, incluido facturar: loterías, multiplicadores, topes, bancas, usuarios, configuración y mantenimiento. |

El vendedor **no** ve el tablero, los reportes de gestión, el riesgo, los
premios por pagar ni ninguna pantalla administrativa, y **no puede pagar
premios**: entregar dinero por ventanilla lo autoriza la banca. El menú se
dibuja según el rol, pero el permiso de verdad lo aplica el servidor en
`src/routes/` (`requiereRol`), así que no se salta escribiendo una URL.

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
npm run usuarios # dar de alta a las personas reales (usuarios.json)
npm run seed   # instalacion de prueba con claves aleatorias
npm run salud  # comprobar la conexión a la base
```

### Estructura

```
api/[...ruta].js       punto de entrada de Vercel (ruta comodin)
src/
  app.js               construccion de la app Express
  server.js            servidor local
  config.js            .env, puerto, zona horaria
  db/
    index.js           pool de Postgres, tipos, transacciones, settings
    sql.js             traduccion de marcadores ? y @nombre a $n
    seed.js            banca y usuarios de prueba (claves al azar)
    usuarios.js        alta de los usuarios reales desde usuarios.json
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
