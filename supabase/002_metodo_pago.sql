-- ============================================================
--  BANCA DG - Migracion 002: forma de cobro
-- ============================================================
--  El cobro es en efectivo o por transferencia, sin pasarela de pago.
--  Se registra en el momento de facturar, porque cambia el cuadre de caja:
--  lo que se cobro por transferencia NO esta en la gaveta del cajero.
--
--  Ejecutar en: Supabase -> SQL Editor. Es idempotente.
-- ============================================================

alter table tickets
  add column if not exists metodo_pago text not null default 'efectivo',
  add column if not exists referencia_pago text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_metodo_pago_check'
  ) then
    alter table tickets
      add constraint tickets_metodo_pago_check
      check (metodo_pago in ('efectivo', 'transferencia'));
  end if;
end $$;

comment on column tickets.metodo_pago is
  'Como pago el cliente: efectivo (entra a la gaveta) o transferencia (no entra).';
comment on column tickets.referencia_pago is
  'Numero de confirmacion o referencia de la transferencia. Vacio si fue en efectivo.';

create index if not exists ix_tickets_metodo on tickets(fecha_sorteo, metodo_pago);

-- El premio tambien se paga de una de las dos formas.
alter table tickets
  add column if not exists metodo_pago_premio text,
  add column if not exists referencia_pago_premio text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_metodo_pago_premio_check'
  ) then
    alter table tickets
      add constraint tickets_metodo_pago_premio_check
      check (metodo_pago_premio is null or metodo_pago_premio in ('efectivo', 'transferencia'));
  end if;
end $$;

comment on column tickets.metodo_pago_premio is
  'Como se le entrego el premio al ganador. NULL mientras no se haya pagado.';
