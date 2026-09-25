# PASO 5 — Ya no hace falta exponer ningún esquema

Desde la migración 0010 las tablas viven en `public` (prefijo `voltia_`), que la Data API
de Supabase ya expone. Si antes agregaste `voltia` en *Exposed schemas*, puedes quitarlo.

Solo confirma en el entorno de despliegue (Vercel u otro) que existe `PLUGSHARE_TOKEN`
(sin prefijo `NEXT_PUBLIC_`): ya no se guarda en el navegador.
