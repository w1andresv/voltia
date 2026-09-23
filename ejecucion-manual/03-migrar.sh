#!/usr/bin/env bash
# PASO 3 (terminal, raíz del proyecto) — Migraciones pendientes:
#   0007 usuarios · 0008 relaciones · 0009 importación · 0010 mueve todo de `voltia` a `public`
#   (tablas public.voltia_vehicles, voltia_trips, voltia_users, voltia_user_identities).
# Lee DATABASE_URL de .env.local / .env.  Uso: bash ejecucion-manual/03-migrar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npm run db:migrate
