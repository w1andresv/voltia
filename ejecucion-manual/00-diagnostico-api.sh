#!/usr/bin/env bash
# DIAGNÓSTICO (terminal, raíz del proyecto) — consulta la Data API con la URL y llave pública de la app.
# Uso: bash ejecucion-manual/00-diagnostico-api.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; [ -f .env.local ] && . ./.env.local; set +a
KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
echo "Proyecto: ${NEXT_PUBLIC_SUPABASE_URL}"
curl -sS "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/voltia_vehicles?select=id&limit=3" -H "apikey: ${KEY}"
echo
# OK:    [{"id":"mg-s5-ev-comfort"}, ...]  o  []
# PGRST205 "Could not find the table": falta correr la migración 0010 (npm run db:migrate).
