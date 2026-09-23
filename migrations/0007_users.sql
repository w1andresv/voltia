-- Gestión de usuarios (fase 4): tabla propia de usuarios, desacoplada del
-- proveedor de identidad. Todas las relaciones apuntan a voltia.users.id,
-- nunca al id del proveedor (Supabase Auth hoy, cualquier otro mañana).
--
-- Los usuarios existentes CONSERVAN su id (voltia.users.id = su auth.uid()
-- actual), así ningún owner_id de vehicles/trips cambia.

create table if not exists voltia.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create unique index if not exists voltia_users_email_lower_idx on voltia.users (lower(email));

create table if not exists voltia.user_identities (
  provider text not null,
  subject text not null,
  user_id uuid not null references voltia.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);

create index if not exists voltia_user_identities_user_idx on voltia.user_identities (user_id);

-- Backfill desde Supabase Auth. En una base local sin esquema `auth` se omite.
do $$
begin
  if to_regclass('auth.users') is not null then
    insert into voltia.users (id, email, created_at, last_sign_in_at)
    select
      u.id,
      coalesce(nullif(trim(u.email), ''), u.id::text || '@usuario.invalid'),
      coalesce(u.created_at, now()),
      u.last_sign_in_at
    from auth.users u
    on conflict do nothing;
  end if;
end $$;

-- Dueños ya presentes en las tablas de datos pero sin fila en auth.users
-- (cuentas borradas, datos de prueba): se les crea un usuario marcador para
-- que las claves foráneas de 0008 puedan validarse sin perder datos.
insert into voltia.users (id, email)
select o.owner_id, o.owner_id::text || '@huerfano.invalid'
from (
  select owner_id from voltia.vehicles where owner_id is not null
  union
  select owner_id from voltia.trips
) o
where not exists (select 1 from voltia.users u where u.id = o.owner_id)
on conflict do nothing;

do $$
begin
  if to_regclass('public.electrolineras') is not null then
    insert into voltia.users (id, email)
    select o.uid, o.uid::text || '@huerfano.invalid'
    from (
      select created_by as uid from public.electrolineras where created_by is not null
      union
      select reviewed_by from public.electrolineras where reviewed_by is not null
    ) o
    where not exists (select 1 from voltia.users u where u.id = o.uid)
    on conflict do nothing;
  end if;
end $$;

insert into voltia.user_identities (provider, subject, user_id)
select 'supabase', u.id::text, u.id
from voltia.users u
on conflict do nothing;

-- Mapea la sesión de Supabase (auth.uid()) al id interno. `security definer`
-- para leer user_identities sin depender de su RLS (evita recursión).
create or replace function voltia.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = voltia, pg_temp
as $$
  select i.user_id
  from voltia.user_identities i
  where i.provider = 'supabase' and i.subject = auth.uid()::text
$$;

revoke all on function voltia.current_user_id() from public;
grant execute on function voltia.current_user_id() to anon, authenticated, service_role;

alter table voltia.users enable row level security;
alter table voltia.user_identities enable row level security;

drop policy if exists users_self_read on voltia.users;
create policy users_self_read on voltia.users
  for select to authenticated
  using (id = voltia.current_user_id());

drop policy if exists user_identities_self_read on voltia.user_identities;
create policy user_identities_self_read on voltia.user_identities
  for select to authenticated
  using (user_id = voltia.current_user_id());

-- Las escrituras (alta, último acceso) las hace el servidor con DATABASE_URL.
grant select on voltia.users, voltia.user_identities to authenticated;
grant all on voltia.users, voltia.user_identities to service_role;
