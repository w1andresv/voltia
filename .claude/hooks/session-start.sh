#!/bin/bash
# Instala dependencias al iniciar una sesión de Claude Code en la web, para que
# `npm run typecheck`, `npm run lint` y `npm test` funcionen desde el principio.
# No necesita red a Mapbox/Open-Meteo ni base de datos.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install (no npm ci) para aprovechar el node_modules cacheado del contenedor.
npm install --no-audit --no-fund --loglevel=error
