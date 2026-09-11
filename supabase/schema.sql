-- ============================================================
--  BANCA DG - Esquema para PostgreSQL / Supabase
-- ============================================================
--  Traduccion del esquema SQLite a Postgres. Diferencias de fondo:
--
--   * Las marcas de tiempo se guardan como TIMESTAMPTZ (instante real)
--     y la "fecha de negocio" dominicana se deriva con fecha_rd().
--     Postgres tiene zonas horarias de verdad, asi que ya no hace falta
--     el truco de restar 4 horas que usa la version SQLite.
--   * El dinero es NUMERIC(14,2): exacto, sin errores de coma flotante.
--   * Los booleanos son BOOLEAN en vez de INTEGER 0/1.
--
--  Este script es idempotente: se puede volver a ejecutar sin romper nada.
--  Ejecutar en: Supabase -> SQL Editor -> New query -> Run
-- ============================================================

create extension if not exists citext;

-- ------------------------------------------------------------
-- Fecha de negocio de Republica Dominicana
-- ------------------------------------------------------------
create or replace function fecha_rd(ts timestamptz default now())
returns date
language sql
stable
as $$
  select (ts at time zone 'America/Santo_Domingo')::date;
$$;

comment on function fecha_rd is
  'Fecha de operacion de la banca (America/Santo_Domingo) para un instante dado.';

-- ------------------------------------------------------------
-- Configuracion general (clave/valor)
-- ------------------------------------------------------------
create table if not exists settings (
  key          text primary key,
  value        jsonb       not null,
  actualizado  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Bancas / sucursales
-- ------------------------------------------------------------
create table if not exists bancas (
  id         bigint generated always as identity primary key,
  codigo     text        not null unique,
  nombre     text        not null,
  direccion  text        not null default '',
  telefono   text        not null default '',
  rnc        text        not null default '',
  activo     boolean     not null default true,
  creado_en  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Usuarios:  admin | banca | vendedor
-- ------------------------------------------------------------
create table if not exists usuarios (
  id            bigint generated always as identity primary key,
  banca_id      bigint references bancas(id) on delete set null,
  usuario       citext      not null unique,
  nombre        text        not null,
  rol           text        not null check (rol in ('admin','banca','vendedor')),
  password_hash text        not null,
  password_salt text        not null,
  comision_pct  numeric(5,2) not null default 0 check (comision_pct between 0 and 100),
  activo        boolean     not null default true,
  creado_en     timestamptz not null default now(),
  ultimo_acceso timestamptz
);
create index if not exists ix_usuarios_banca on usuarios(banca_id);

-- ------------------------------------------------------------
-- Sesiones
-- ------------------------------------------------------------
create table if not exists sesiones (
  token      text primary key,
  usuario_id bigint      not null references usuarios(id) on delete cascade,
  creado_en  timestamptz not null default now(),
  expira_en  timestamptz not null,
  ip         text        not null default '',
  agente     text        not null default ''
);
create index if not exists ix_sesiones_usuario on sesiones(usuario_id);
create index if not exists ix_sesiones_expira  on sesiones(expira_en);

-- ------------------------------------------------------------
-- Loterias
-- ------------------------------------------------------------
create table if not exists loterias (
  id              bigint generated always as identity primary key,
  codigo          text    not null unique,
  nombre          text    not null,
  pais            text    not null default 'RD',
  color           text    not null default '#1565C0',
  hora_cierre     time    not null default '20:00',
  minutos_previos integer not null default 0 check (minutos_previos between 0 and 600),
  dias            text    not null default '1,2,3,4,5,6,7'
                    check (dias ~ '^[1-7](,[1-7])*$'),
  orden           integer not null default 0,
  activo          boolean not null default true,
  q_quiniela      boolean not null default true,
  q_pale          boolean not null default true,
  q_tripleta      boolean not null default true,
  q_superpale     boolean not null default false
);

-- ------------------------------------------------------------
-- Multiplicadores de premio
--   loteria_id NULL => valor por defecto (aplica a todas)
-- ------------------------------------------------------------
create table if not exists premios (
  id            bigint generated always as identity primary key,
  loteria_id    bigint references loterias(id) on delete cascade,
  tipo          text    not null check (tipo in ('quiniela','pale','tripleta','superpale')),
  posicion      text    not null,
  multiplicador numeric(12,2) not null default 0 check (multiplicador >= 0)
);
-- Indice de expresion: permite ON CONFLICT tratando NULL como "global".
create unique index if not exists ux_premios
  on premios (coalesce(loteria_id, 0), tipo, posicion);

-- ------------------------------------------------------------
-- Limites (topes) de venta por numero
--   loteria_id NULL => todas las loterias
--   numero     NULL => tope general del tipo
-- ------------------------------------------------------------
create table if not exists limites (
  id         bigint generated always as identity primary key,
  loteria_id bigint references loterias(id) on delete cascade,
  tipo       text    not null check (tipo in ('quiniela','pale','tripleta','superpale')),
  numero     text,
  monto_max  numeric(14,2) not null default 0 check (monto_max >= 0)
);
create unique index if not exists ux_limites
  on limites (coalesce(loteria_id, 0), tipo, coalesce(numero, '*'));

-- ------------------------------------------------------------
-- Tickets
-- ------------------------------------------------------------
create table if not exists tickets (
  id            bigint generated always as identity primary key,
  codigo        text        not null unique,
  pin           text        not null,
  banca_id      bigint      not null references bancas(id),
  usuario_id    bigint      not null references usuarios(id),
  fecha_sorteo  date        not null,
  creado_en     timestamptz not null default now(),
  total         numeric(14,2) not null default 0 check (total >= 0),
  cliente       text        not null default '',
  estado        text        not null default 'activo'
                  check (estado in ('activo','cancelado','ganador','pagado','perdedor')),
  premio_total  numeric(14,2) not null default 0 check (premio_total >= 0),
  cancelado_en  timestamptz,
  cancelado_por bigint references usuarios(id),
  pagado_en     timestamptz,
  pagado_por    bigint references usuarios(id),
  evaluado_en   timestamptz
);
create index if not exists ix_tickets_fecha  on tickets(fecha_sorteo);
create index if not exists ix_tickets_banca  on tickets(banca_id, fecha_sorteo);
create index if not exists ix_tickets_user   on tickets(usuario_id, fecha_sorteo);
create index if not exists ix_tickets_estado on tickets(estado);

-- ------------------------------------------------------------
-- Jugadas
-- ------------------------------------------------------------
create table if not exists jugadas (
  id          bigint generated always as identity primary key,
  ticket_id   bigint  not null references tickets(id) on delete cascade,
  loteria_id  bigint  not null references loterias(id),
  loteria2_id bigint  references loterias(id),
  tipo        text    not null check (tipo in ('quiniela','pale','tripleta','superpale')),
  numeros     text    not null,
  monto       numeric(14,2) not null check (monto > 0),
  estado      text    not null default 'pendiente'
                check (estado in ('pendiente','ganadora','perdedora','cancelada')),
  premio      numeric(14,2) not null default 0 check (premio >= 0),
  detalle     text    not null default ''
);
create index if not exists ix_jugadas_ticket  on jugadas(ticket_id);
create index if not exists ix_jugadas_loteria on jugadas(loteria_id, tipo, numeros);
-- Acelera el calculo de topes (cuanto se vendio de un numero en una fecha).
create index if not exists ix_jugadas_tope
  on jugadas(loteria_id, tipo, numeros) where estado <> 'cancelada';

-- ------------------------------------------------------------
-- Resultados de sorteos
-- ------------------------------------------------------------
create table if not exists resultados (
  id         bigint generated always as identity primary key,
  loteria_id bigint      not null references loterias(id) on delete cascade,
  fecha      date        not null,
  primera    char(2)     not null check (primera ~ '^\d{2}$'),
  segunda    char(2)     not null check (segunda ~ '^\d{2}$'),
  tercera    char(2)     not null check (tercera ~ '^\d{2}$'),
  creado_en  timestamptz not null default now(),
  creado_por bigint references usuarios(id),
  unique (loteria_id, fecha)
);
create index if not exists ix_resultados_fecha on resultados(fecha);

-- ------------------------------------------------------------
-- Cierres de caja
-- ------------------------------------------------------------
create table if not exists cierres (
  id          bigint generated always as identity primary key,
  banca_id    bigint      not null references bancas(id),
  usuario_id  bigint      not null references usuarios(id),
  fecha       date        not null,
  venta       numeric(14,2) not null default 0,
  premios     numeric(14,2) not null default 0,
  comision    numeric(14,2) not null default 0,
  balance     numeric(14,2) not null default 0,
  tickets     integer     not null default 0,
  notas       text        not null default '',
  cerrado_en  timestamptz not null default now(),
  cerrado_por bigint references usuarios(id),
  unique (usuario_id, fecha)
);

-- ------------------------------------------------------------
-- Auditoria
-- ------------------------------------------------------------
create table if not exists auditoria (
  id         bigint generated always as identity primary key,
  usuario_id bigint references usuarios(id) on delete set null,
  usuario    text        not null default '',
  accion     text        not null,
  entidad    text        not null default '',
  entidad_id text        not null default '',
  detalle    text        not null default '',
  ip         text        not null default '',
  creado_en  timestamptz not null default now()
);
create index if not exists ix_auditoria_fecha on auditoria(creado_en desc);
-- Filtrar la bitacora por dia de operacion dominicano.
create index if not exists ix_auditoria_fecha_rd on auditoria(fecha_rd(creado_en));

-- ============================================================
--  SEGURIDAD: Row Level Security
-- ============================================================
--  La aplicacion NO expone Supabase al navegador: el servidor Node es el
--  unico que se conecta, con la service role key, y es quien aplica los
--  permisos por rol (admin / banca / vendedor).
--
--  Por eso se activa RLS sin ninguna policy: cualquier clave publica
--  (anon / authenticated) queda sin acceso a nada. La service role key
--  salta RLS por diseno, asi que la app sigue funcionando.
--
--  >>> Si algun dia el navegador habla directo con Supabase, hay que
--  >>> escribir policies antes; sin ellas no leeria nada.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['settings','bancas','usuarios','sesiones','loterias',
                           'premios','limites','tickets','jugadas','resultados',
                           'cierres','auditoria']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Revocar el acceso de las claves publicas por si acaso.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ============================================================
--  CATALOGO INICIAL
-- ============================================================
--  Los usuarios NO se crean aqui: sus claves se cifran con scrypt en el
--  servidor. Para crearlos ejecute  `npm run seed`  con la conexion ya
--  configurada.
-- ============================================================

-- --- Loterias dominicanas -----------------------------------
insert into loterias (codigo, nombre, hora_cierre, dias, color, orden, q_superpale) values
  ('GANAMAS',  'Gana Mas',            '14:25', '1,2,3,4,5,6',   '#E53935',  1, true),
  ('NACIONAL', 'Loteria Nacional',    '20:50', '1,2,3,4,5,6',   '#1565C0',  2, true),
  ('LEIDSA',   'Quiniela Leidsa',     '20:50', '1,2,3,4,5,6,7', '#00897B',  3, true),
  ('LOTEKA',   'Quiniela Loteka',     '19:50', '1,2,3,4,5,6,7', '#6A1B9A',  4, true),
  ('REAL',     'Quiniela Real',       '12:50', '1,2,3,4,5,6',   '#F9A825',  5, true),
  ('LOTEDOM',  'Quiniela Lotedom',    '13:45', '1,2,3,4,5,6',   '#D81B60',  6, true),
  ('SUERTE',   'La Suerte 12:30',     '12:25', '1,2,3,4,5,6',   '#43A047',  7, true),
  ('PRIMERA',  'La Primera Dia',      '11:55', '1,2,3,4,5,6',   '#3949AB',  8, false),
  ('ANG_MAN',  'Anguila Manana',      '10:55', '1,2,3,4,5,6,7', '#00ACC1',  9, false),
  ('ANG_TAR',  'Anguila Tarde',       '12:55', '1,2,3,4,5,6,7', '#26A69A', 10, false),
  ('ANG_NOC',  'Anguila Noche',       '17:55', '1,2,3,4,5,6,7', '#5E35B1', 11, false),
  ('KING_DIA', 'King Lottery Dia',    '12:25', '1,2,3,4,5,6',   '#FB8C00', 12, false),
  ('KING_NOC', 'King Lottery Noche',  '20:25', '1,2,3,4,5,6',   '#EF6C00', 13, false),
  ('NY_TAR',   'New York Tarde',      '14:15', '1,2,3,4,5,6,7', '#455A64', 14, false),
  ('NY_NOC',   'New York Noche',      '22:15', '1,2,3,4,5,6,7', '#263238', 15, false),
  ('FL_DIA',   'Florida Dia',         '13:15', '1,2,3,4,5,6,7', '#7CB342', 16, false),
  ('FL_NOC',   'Florida Noche',       '21:35', '1,2,3,4,5,6,7', '#558B2F', 17, false)
on conflict (codigo) do nothing;

-- --- Multiplicadores de pago por defecto --------------------
insert into premios (loteria_id, tipo, posicion, multiplicador) values
  (null, 'quiniela',  '1',       60),
  (null, 'quiniela',  '2',       20),
  (null, 'quiniela',  '3',       10),
  (null, 'pale',      'directo', 1000),
  (null, 'pale',      'tercera', 100),
  (null, 'tripleta',  'directo', 12000),
  (null, 'tripleta',  'doble',   0),
  (null, 'superpale', 'directo', 2000)
on conflict (coalesce(loteria_id, 0), tipo, posicion) do nothing;

-- --- Topes por defecto --------------------------------------
insert into limites (loteria_id, tipo, numero, monto_max) values
  (null, 'quiniela',  null, 3000),
  (null, 'pale',      null, 1000),
  (null, 'tripleta',  null, 300),
  (null, 'superpale', null, 500)
on conflict (coalesce(loteria_id, 0), tipo, coalesce(numero, '*')) do nothing;

-- --- Configuracion general ----------------------------------
insert into settings (key, value) values
  ('empresa_nombre',         '"Banca DG"'),
  ('empresa_lema',           '"Loterias Dominicanas"'),
  ('empresa_rnc',            '""'),
  ('empresa_telefono',       '""'),
  ('empresa_direccion',      '""'),
  ('ticket_mensaje',         '"Gracias por su preferencia. Revise su ticket antes de retirarse."'),
  ('ticket_pie',             '"Los premios se pagan en la misma banca presentando este ticket."'),
  ('moneda',                 '"RD$"'),
  ('monto_minimo',           '5'),
  ('monto_maximo',           '5000'),
  ('max_jugadas_ticket',     '40'),
  ('minutos_cancelacion',    '10'),
  ('dias_validez_premio',    '30'),
  ('pagar_repetidos',        'true'),
  ('permitir_venta_cerrada', 'false'),
  ('bloquear_sin_resultados','true')
on conflict (key) do nothing;
