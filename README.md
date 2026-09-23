# Voltia

Planificador de viajes en vehículo eléctrico. Origen, destino, energía, desnivel y paradas solo en electrolineras verificadas.

## Requisitos

- Node.js 22
- npm

## Arranque

```bash
npm install
npm run dev
```

Abre [http://localhost:8080](http://localhost:8080).

Sin `DATABASE_URL` las electrolineras de la comunidad se guardan en una base local (PGLite). No hace falta Postgres para desarrollar.

## Mapa y PlugShare

El token de Mapbox que ya usabas está en `.grok/app-env.json` (`VITE_MAPBOX_TOKEN`). Cámbialo ahí si quieres otra clave. También puedes pegarlo en el menú de la app.

PlugShare es opcional: menú → PlugShare. Sin clave se usan OpenStreetMap, el catálogo de operadores y las estaciones confirmadas.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en el puerto 8080 |
| `npm run typecheck` | Comprobación de TypeScript |
| `npm run build` | Build de producción |
