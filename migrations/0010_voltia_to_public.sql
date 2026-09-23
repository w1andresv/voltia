-- Mueve los datos de Voltia del esquema `voltia` a `public`, para que la Data API
-- de Supabase los sirva sin configurar "Exposed schemas".
--
-- `public` ya tiene tablas de otros proyectos (p. ej. public.users, public.clients),
-- así que todo lleva el prefijo `voltia_`:
--   voltia.vehicles        -> public.voltia_vehicles
--   voltia.trips           -> public.voltia_trips
--   voltia.users           -> public.voltia_users
--   voltia.user_identities -> public.voltia_user_identities
--   voltia.current_user_id()          -> public.voltia_current_user_id()
--   voltia.import_guest_data(jsonb, jsonb) -> public.voltia_import_guest_data(jsonb, jsonb)
--
-- ALTER ... SET SCHEMA conserva datos, índices, llaves, RLS, políticas y permisos.
-- Los índices se renombran antes de moverlos (users_pkey ya existe en public).
-- Las políticas apuntan a la función por OID, así que siguen valiendo tras
-- moverla; su cuerpo (texto) sí se reescribe para usar las tablas nuevas.
-- Idempotente: si ya se movió, no hace nada. Aborta si hay un choque de nombres.

do $$
declare
  t text;
  idx record;
begin
  foreach t in array array['vehicles', 'trips', 'users', 'user_identities'] loop
    if to_regclass('voltia.' || t) is null then
      continue; -- ya movida (o nunca existió)
    end if;
    if to_regclass('public.voltia_' || t) is not null then
      raise exception 'Existen voltia.% y public.voltia_%: revisa a mano antes de migrar.', t, t;
    end if;

    -- Índices (incluye pkey/unique; renombrarlos renombra su restricción).
    for idx in
      select c.relname as name
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_class tbl on tbl.oid = i.indrelid
      join pg_namespace n on n.oid = tbl.relnamespace
      where n.nspname = 'voltia' and tbl.relname = t and c.relname not like 'voltia\_%'
    loop
      if to_regclass('public.voltia_' || idx.name) is not null then
        raise exception 'El índice public.voltia_% ya existe.', idx.name;
      end if;
      execute format('alter index voltia.%I rename to %I', idx.name, 'voltia_' || idx.name);
    end loop;

    -- Índices que ya se llamaban voltia_* (p. ej. voltia_trips_owner_idx): verificar choque.
    for idx in
      select c.relname as name
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_class tbl on tbl.oid = i.indrelid
      join pg_namespace n on n.oid = tbl.relnamespace
      where n.nspname = 'voltia' and tbl.relname = t
    loop
      if to_regclass('public.' || quote_ident(idx.name)) is not null then
        raise exception 'El índice public.% ya existe.', idx.name;
      end if;
    end loop;

    execute format('alter table voltia.%I rename to %I', t, 'voltia_' || t);
    execute format('alter table voltia.%I set schema public', 'voltia_' || t);
  end loop;

  if to_regprocedure('voltia.current_user_id()') is not null then
    alter function voltia.current_user_id() rename to voltia_current_user_id;
    alter function voltia.voltia_current_user_id() set schema public;
  end if;

  if to_regprocedure('voltia.import_guest_data(jsonb,jsonb)') is not null then
    alter function voltia.import_guest_data(jsonb, jsonb) rename to voltia_import_guest_data;
    alter function voltia.voltia_import_guest_data(jsonb, jsonb) set schema public;
  end if;
end;
$$;

-- Cuerpos reescritos sobre public (create or replace conserva el OID y los permisos).
create or replace function public.voltia_current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.user_id
  from public.voltia_user_identities i
  where i.provider = 'supabase' and i.subject = auth.uid()::text
$$;

revoke all on function public.voltia_current_user_id() from public;
grant execute on function public.voltia_current_user_id() to anon, authenticated, service_role;

create or replace function public.voltia_import_guest_data(p_vehicles jsonb, p_trips jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.voltia_current_user_id();
  item jsonb;
  n integer;
  res_vehicles jsonb := '[]'::jsonb;
  res_trips jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'No hay sesión' using errcode = '28000';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_vehicles, '[]'::jsonb)) loop
    begin
      insert into public.voltia_vehicles (id, owner_id, local_id, payload)
      values (v_uid::text || ':' || (item->>'localId'), v_uid, item->>'localId', item->'payload')
      on conflict do nothing;
      get diagnostics n = row_count;
      res_vehicles := res_vehicles || jsonb_build_object(
        'localId', item->>'localId',
        'status', case when n = 1 then 'imported' else 'duplicate' end
      );
    exception when others then
      res_vehicles := res_vehicles || jsonb_build_object(
        'localId', item->>'localId', 'status', 'failed', 'error', sqlerrm
      );
    end;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_trips, '[]'::jsonb)) loop
    begin
      insert into public.voltia_trips (owner_id, client_id, payload)
      values (v_uid, (item->>'clientId')::uuid, item->'payload')
      on conflict (owner_id, client_id) where client_id is not null do nothing;
      get diagnostics n = row_count;
      res_trips := res_trips || jsonb_build_object(
        'clientId', item->>'clientId',
        'status', case when n = 1 then 'imported' else 'duplicate' end
      );
    exception when others then
      res_trips := res_trips || jsonb_build_object(
        'clientId', item->>'clientId', 'status', 'failed', 'error', sqlerrm
      );
    end;
  end loop;

  return jsonb_build_object('vehicles', res_vehicles, 'trips', res_trips);
end;
$$;

revoke all on function public.voltia_import_guest_data(jsonb, jsonb) from public;
grant execute on function public.voltia_import_guest_data(jsonb, jsonb) to authenticated;

-- Permisos explícitos (se conservan al mover, pero se reafirman por si acaso).
grant select on public.voltia_vehicles to anon, authenticated;
grant insert, update, delete on public.voltia_vehicles to authenticated;
grant select, insert, update, delete on public.voltia_trips to authenticated;
grant select on public.voltia_trips to anon;
grant select on public.voltia_users, public.voltia_user_identities to authenticated;
grant all on public.voltia_vehicles, public.voltia_trips, public.voltia_users,
  public.voltia_user_identities to service_role;

-- El esquema voltia se borra solo si quedó vacío (p. ej. conserva un respaldo manual).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'voltia') then
    begin
      drop schema voltia;
    exception when dependent_objects_still_exist then
      raise notice 'El esquema voltia aún tiene objetos (¿respaldo?); se conserva.';
    end;
  end if;
end;
$$;

-- Que la Data API de Supabase vea las tablas nuevas sin esperar.
notify pgrst, 'reload schema';
