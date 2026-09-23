-- Gestión de usuarios (fase 8): importación de los datos del invitado al
-- iniciar sesión. `security invoker`: corre con los permisos (y el RLS) del
-- usuario que llama, así solo puede escribir bajo su propio id interno.
--
-- p_vehicles: [{ "localId": text, "payload": Vehicle }]
-- p_trips:    [{ "clientId": uuid, "payload": { request, summary } }]
-- Devuelve por ítem: imported (insertado) | duplicate (ya existía) | failed.
-- Cada ítem va en su propio subbloque: uno que falle no revierte a los demás.
-- Las decisiones (qué subir, qué omitir, remapeo de ids) las toma el servidor
-- en src/domain/user/import-plan.ts; esta función solo las aplica.

create or replace function voltia.import_guest_data(p_vehicles jsonb, p_trips jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = voltia, pg_temp
as $$
declare
  v_uid uuid := voltia.current_user_id();
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
      insert into voltia.vehicles (id, owner_id, local_id, payload)
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
      insert into voltia.trips (owner_id, client_id, payload)
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

revoke all on function voltia.import_guest_data(jsonb, jsonb) from public;
grant execute on function voltia.import_guest_data(jsonb, jsonb) to authenticated;
