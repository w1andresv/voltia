# Voltia

Planificador de viajes en vehículo eléctrico. Next.js 16, español, Colombia.

## Local

```bash
npm install
npm run dev
```

Abre http://localhost:8080

Las claves van en `.env.local`. `SUPABASE_SECRET_KEY` está vacía a propósito. No subas ese archivo: incluye la conexión de Postgres.

## Base de datos

- `npm run db:migrate` aplica `migrations/` (una sola vez cada archivo).
- `npm run db:seed` aplica `seeds/` (catálogo de vehículos); es rerunnable y va después de migrar.
- Supabase: el esquema `voltia` debe estar en "Exposed Schemas" (lo usan `.schema("voltia")` y la función `voltia.import_guest_data`).
