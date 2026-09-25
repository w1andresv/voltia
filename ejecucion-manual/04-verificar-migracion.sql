-- PASO 4 (SQL Editor) — Verifica las migraciones 0007–0010. Ejecuta cada bloque.

-- 4.1 Tablas de Voltia en public. Esperado: 4 filas.
select tablename from pg_tables
where schemaname = 'public' and tablename in ('voltia_vehicles', 'voltia_trips', 'voltia_users', 'voltia_user_identities');

-- 4.2 Usuarios e identidades.
select (select count(*) from public.voltia_users)           as usuarios,
       (select count(*) from public.voltia_user_identities) as identidades;

-- 4.3 Usuarios de Supabase Auth sin identidad interna. Esperado: 0
--     (se crean también solos en el primer inicio de sesión).
select count(*) as auth_sin_identidad
from auth.users au
where not exists (
  select 1 from public.voltia_user_identities i
  where i.provider = 'supabase' and i.subject = au.id::text
);

-- 4.4 Llaves foráneas validadas. Esperado: convalidated = true en todas.
select conname, conrelid::regclass as tabla, convalidated
from pg_constraint
where contype = 'f' and conrelid::regclass::text like 'voltia\_%';

-- 4.5 Usuarios placeholder por datos huérfanos (revísalos).
select id, email from public.voltia_users where email like '%@huerfano.invalid';

-- 4.6 Funciones. Esperado: voltia_current_user_id y voltia_import_guest_data.
select proname from pg_proc
where pronamespace = 'public'::regnamespace and proname like 'voltia\_%';

-- 4.7 El esquema voltia ya no debería existir (o solo con respaldos manuales).
select schema_name from information_schema.schemata where schema_name = 'voltia';
