#!/usr/bin/env bash
# PASO 6 (terminal, raíz del proyecto) — Aplica seeds/0001_vehicle_catalog.sql (rerunnable).
# Debe imprimir "[seed] catálogo: N vehículos." (N = filas viejas + 6 nuevas, hasta que hagas el paso 8).
# Uso: bash ejecucion-manual/06-sembrar-catalogo.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npm run db:seed
