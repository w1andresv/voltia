# API pública de Blaze v1 (electrolineras)

Copia de la documentación que entregó el dueño del producto el 2026-09-27. No lleva keys: la real va solo en `BLAZE_API_KEY` (`.env.local` y Vercel).

Es el catálogo de electrolineras de Blaze, de solo lectura, autenticado con API key.

## Autenticación
Se envía la key en cada petición, por cabecera:

```
Authorization: Bearer blz_xxxxxxxxxxxx
# o bien
X-API-Key: blz_xxxxxxxxxxxx
```

- **Base URL:** `https://blaze.muvatec.com/electrolineras-api/public/v1`.
- **Límites:** cada key tiene scopes (permisos de lectura) y un límite por minuto; si se excede, la API responde 429.
- **Qué expone:** solo electrolineras activas.

## Scopes

| Scope | Qué habilita |
|---|---|
| `stations:read` | Listado y detalle de estaciones (nombre, ciudad, estado) |
| `location:read` | Coordenadas GPS (`lat`/`lon`) y dirección |
| `operators:read` | Proveedor u operador, y el endpoint `/operators` |
| `connectors:read` | Tipos de conector, y el endpoint `/connector-types` |
| `chargers:read` | Cargadores con su estado y potencia máxima |

## Endpoints

```
GET /stations            # scope stations:read
GET /stations/{id}       # scope stations:read
GET /connector-types     # scope connectors:read
GET /operators           # scope operators:read
```

## Respuesta del listado
Con los scopes stations, location, connectors, chargers y operators:

```json
[
  {
    "id": 12,
    "name": "EDS Blaze Cabecera",
    "city": "Bucaramanga",
    "status": "en_servicio",
    "verified": true,
    "operator": "Blaze Charge",
    "lat": 7.119, "lon": -73.119,
    "connectors": "CCS2, Tipo 2",
    "maxKw": 150,
    "chargersCount": 3
  }
]
```

## Detalle
`/stations/{id}` agrega la lista de cargadores con su estado:

```json
"chargers": [
  { "connectorType": "CCS2", "powerKw": 150, "status": "en_servicio" },
  { "connectorType": "Tipo 2", "powerKw": 22, "status": "fuera_servicio" }
]
```

Estados posibles: `en_servicio`, `mantenimiento`, `fuera_servicio`, `desconocido`.

## Confirmado con Blaze (2026-09-27)
- **Paginación:** no hay; `/stations` devuelve todas las estaciones activas en una sola respuesta.

## Lo que la documentación no dice (confirmar con Blaze)
- **Límite por minuto:** no se da el número. `npm run blaze:check` lo muestra si la API manda `x-ratelimit-limit`.
- **Dirección:** el scope `location:read` la menciona, pero el ejemplo no trae el campo. La app lee `address` si llega.
- **Actualización:** no dice cada cuánto se actualizan el estado del listado ni el del detalle.
- **`verified`:** no se explica qué significa. La app lo guarda, pero no lo usa para decidir.
