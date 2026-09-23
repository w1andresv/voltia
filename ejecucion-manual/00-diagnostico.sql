-- DIAGNÓSTICO (SQL Editor de Supabase).

-- A. Migraciones aplicadas. Esperado: 0002 … 0010.
select name, applied_at from public._migrations order by name;

-- B. Dónde están las tablas de Voltia. Esperado: public.voltia_* (tras 0010).
select schemaname, tablename from pg_tables
where tablename like 'voltia\_%' or schemaname = 'voltia'
order by 1, 2;

-- C. Permisos para la API. Esperado: authenticated con SELECT/INSERT/... en voltia_trips.
select table_name, grantee, string_agg(privilege_type, ', ') as permisos
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'voltia\_%' and grantee in ('anon', 'authenticated')
group by 1, 2 order by 1, 2;

-- D. Forzar a la API a releer el esquema.
notify pgrst, 'reload schema';
