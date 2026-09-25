# Despliegue en Vercel

Checklist para publicar esta app (Next.js 16) en Vercel, contra el Postgres y el Auth de Supabase que ya usa en local. Vercel no ejecuta `npm run db:migrate` ni `npm run db:seed`: el esquema hay que aplicarlo aparte, antes de dar por bueno el sitio.

No subas `.env` ni `.env.local`. Están en `.gitignore`. Las variables se cargan en el panel de Vercel.

## 0. Antes de tocar Vercel

- [ ] El proyecto de Supabase existe y puedes entrar al SQL editor y a Authentication.
- [ ] En tu máquina, `npm test` pasa.
- [ ] `npm run build` pasa en local con las mismas `NEXT_PUBLIC_*` que vas a poner en Vercel. `next.config.ts` arma la cabecera CSP **en el build** leyendo `NEXT_PUBLIC_SUPABASE_URL`. Si esa variable no está en el build de Vercel, el navegador bloquea Auth y las fotos.
- [ ] Decides la base de producción:
  - **La misma** que usas en local: el esquema ya debería estar aplicado. Igual confirma el paso 3.
  - **Un proyecto nuevo** de Supabase: hay que migrar y sembrar el catálogo antes de que el sitio sirva viajes.

Node en Vercel: **20.x o 22.x**. Next 16 no corre en Node 18. En el proyecto, Settings → General → Node.js Version.

## 1. Crear el proyecto en Vercel

- [ ] Entra a [vercel.com](https://vercel.com) con la cuenta que va a ser dueña del sitio.
- [ ] Add New → Project e importa el repositorio de Git (GitHub, GitLab o Bitbucket). Si el código aún no está en un remoto, súbelo primero. Vercel despliega el commit de la rama que elijas, no la carpeta suelta de tu disco.
- [ ] Framework Preset: **Next.js**. Vercel lo detecta solo si la raíz del repo es esta carpeta.
- [ ] Root Directory: `.` (la raíz). No hace falta si el `package.json` está en la raíz del repo.
- [ ] Build Command: `next build` (el default; equivale a `npm run build`).
- [ ] Output Directory: déjalo vacío. Next no usa un `out/` estático.
- [ ] Install Command: `npm install`.
- [ ] No añadas `npm run db:migrate` al build. El build de Vercel no debe abrir Postgres para aplicar SQL, y el script de migración no está preparado como paso de build.

Todavía no pulses Deploy si puedes evitarlo. Primero carga las variables del paso 2. Si ya desplegaste, cada cambio de `NEXT_PUBLIC_*` exige un **redeploy** (no basta con guardar la variable).

## 2. Variables de entorno

En el proyecto de Vercel: Settings → Environment Variables. Márcalas para **Production**. Si vas a usar Preview (cada PR), márcalas también ahí; si no, los previews salen sin base ni mapa.

Copia los valores desde `.env.local`. No los pegues en el chat ni en el README.

| Variable | Dónde se usa | Obligatoria |
|---|---|---|
| `DATABASE_URL` | Postgres. Viajes, electrolineras, usuarios, catálogo. | Sí, para que el plan guarde y lea datos. |
| `NEXT_PUBLIC_SUPABASE_URL` | Auth en el navegador, fotos, CSP. Se hornea en el build. | Sí, si hay login o fotos. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave pública de Supabase (`sb_publishable_...` o la anon). También acepta el nombre viejo `NEXT_PUBLIC_SUPABASE_ANON_KEY`. | Sí, junto con la URL. |
| `SUPABASE_SECRET_KEY` | Solo servidor (`sb_secret_...`). No uses el nombre `NEXT_PUBLIC_`. | Sí, para altas de usuario y fotos del servidor. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Teselas del mapa en el navegador. Token `pk.`. | Sí, si quieres el mapa de Mapbox. Sin él la app pide el token en pantalla. |
| `MAPBOX_ACCESS_TOKEN` | Direcciones en el servidor (tráfico). Un `pk.` restringido por URL falla aquí con 403, porque el servidor no manda Referer. Usa un token de servidor o un `pk.` sin restricción de URL. | No. Sin ella las rutas caen a OSRM público. |
| `ADMIN_EMAILS` | Correos separados por coma con rol admin (moderar aportes). | No. Ejemplo: `w1andresv@gmail.com`. |
| `PLUGSHARE_TOKEN` | Capa de PlugShare. Solo servidor. | No. Sin ella esa capa no aparece. |
| `PROVIDER_CONTACT` | User-Agent de Overpass y Photon. Ejemplo: `https://tu-dominio; tu@correo`. | Recomendada. Esas APIs piden un contacto. |

### Cómo armar `DATABASE_URL`

En Supabase: Project Settings → Database → Connection string.

- **En Vercel (runtime):** usa el **pooler en modo transaction**, puerto **6543**, con `?pgbouncer=true` en la URI. El código abre como máximo 1 conexión por instancia (`src/infrastructure/db.ts`). El puerto 5432 directo se agota cuando varias funciones corren a la vez.
- **Para migrar y sembrar desde tu máquina:** usa la conexión **directa** (5432) o el pooler en modo **session**. El modo transaction rompe los archivos SQL de `migrations/` (varias sentencias en una transacción).

La URI se ve así (la contraseña es la de la base, no la de tu usuario de Supabase):

```text
postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
```

Si el host contiene `supabase`, la app activa SSL sola. No hace falta añadir `sslmode` para el runtime.

- [ ] `DATABASE_URL` de Vercel es la del pooler 6543.
- [ ] Guardaste las `NEXT_PUBLIC_*` antes del build de producción.
- [ ] Ninguna clave secreta lleva el prefijo `NEXT_PUBLIC_`.

## 3. Esquema y catálogo en Supabase

Desde la raíz del proyecto, con la URI **directa o session** de la base de producción exportada solo en esa terminal:

```bash
DATABASE_URL='postgresql://...' npm run db:migrate
DATABASE_URL='postgresql://...' npm run db:seed
```

`db:migrate` aplica `migrations/0002` … `0010` y las apunta en la tabla `_migrations`. Se puede volver a correr: lo ya aplicado no se repite.

`db:seed` carga `seeds/0001_vehicle_catalog.sql` (el catálogo de vehículos, `owner_id` nulo). Sin este paso, `/api/health` responde `catalog: 0` y el selector de autos queda vacío.

- [ ] `npm run db:migrate` terminó en `up to date` o listó las migraciones nuevas.
- [ ] `npm run db:seed` terminó sin error.
- [ ] En el SQL editor: `select count(*) from public.voltia_vehicles where owner_id is null;` devuelve más de 0.

Si `db:migrate` falla con un error de certificado SSL, la URI de migraciones necesita SSL y el script no lo fuerza como sí lo hace la app. Prueba la URI que Supabase marca como "direct" (ya trae SSL) o añade `?sslmode=require` si el servidor lo acepta. No uses el 6543 transaction para este paso.

### Auth

Authentication → URL configuration:

- [ ] **Site URL:** `https://<tu-proyecto>.vercel.app` (y luego el dominio propio, cuando exista).
- [ ] **Redirect URLs:** `https://<tu-proyecto>.vercel.app/auth/callback` y `http://localhost:8080/auth/callback` si sigues entrando en local.

El enlace mágico vuelve a `{origen}/auth/callback?next=...`. Si la URL no está en esa lista, Supabase rechaza el correo.

Authentication → Providers → Email: activado. Google no es el login del MVP.

### Fotos de electrolineras

Solo hace falta si vas a subir fotos de estaciones.

- [ ] Storage → nuevo bucket `station-photos`.
- [ ] Lectura pública. Escritura solo para usuarios autenticados, cada uno en su carpeta (`<user id>/...`). Tamaño máximo 1 MB, JPEG.
- [ ] Si ya hay fotos viejas en base64, en local: `npm run migrate:photos` con `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SECRET_KEY` de producción.

## 4. Token de Mapbox

En [account.mapbox.com](https://account.mapbox.com):

- [ ] Un token público `pk.` para `NEXT_PUBLIC_MAPBOX_TOKEN`.
- [ ] En las restricciones de URL de ese `pk.`, añade `https://<tu-proyecto>.vercel.app/*` y el dominio final. Sin eso el mapa en el navegador pide el token o sale en blanco.
- [ ] `MAPBOX_ACCESS_TOKEN` aparte, sin restricción por URL, para que el servidor pueda pedir Directions. Si reutilizas el `pk.` restringido, el plan de ruta responde 403 y cae a OSRM.

## 5. Desplegar

- [ ] Deploy. La primera vez puede ser el botón del paso 1, después de guardar las variables.
- [ ] El log de build termina en `next build` sin error de tipos.
- [ ] Anota la URL `https://<proyecto>.vercel.app`.

Cada push a la rama de producción vuelve a desplegar. Cambiar una variable `NEXT_PUBLIC_*` no se aplica hasta el siguiente deploy: Deployments → … → Redeploy.

## 6. Comprobar el sitio

Abre la URL en una ventana de incógnito.

- [ ] `GET /api/health` devuelve JSON con `database: true`, `catalog` mayor que 0 y `auth: true`. `plugshare` es `true` solo si pusiste el token. El cuerpo no incluye secretos.
- [ ] La home carga el mapa (teselas de Mapbox, no un lienzo gris) y el formulario de viaje.
- [ ] Planificas un viaje corto en Colombia. Hay distancia, consumo, gráfica de elevación y, si hace falta, una parada en una estación real.
- [ ] El tema claro/oscuro cambia el panel y el mapa (día / noche).
- [ ] Sin sesión, el menú no muestra Electrolineras. Con `w1andresv@gmail.com` sí. Otra cuenta que abra `/electrolineras` vuelve a planificar.
- [ ] El enlace mágico llega y, al abrirlo, deja la sesión iniciada (vuelve por `/auth/callback`).
- [ ] Consola del navegador: no hay errores de CSP (`Content-Security-Policy`). Si Auth o el mapa fallan en silencio, casi siempre es la CSP del build sin `NEXT_PUBLIC_SUPABASE_URL`, o el token de Mapbox restringido a otro dominio.

## 7. Dominio propio (cuando lo tengas)

- [ ] Vercel → Settings → Domains → añades el dominio y copias los DNS que indique.
- [ ] Supabase → Redirect URLs y Site URL: el dominio nuevo, con `https://` y la ruta `/auth/callback`.
- [ ] Mapbox → el `pk.` acepta `https://tu-dominio/*`.
- [ ] Redeploy.

## 8. Cuando algo falla

| Síntoma | Dónde mirar |
|---|---|
| Build verde, mapa en blanco | Token `pk.` o restricción de URL. Consola: CSP o 401/403 a `api.mapbox.com`. |
| Plan de ruta sin tráfico, aviso de OSRM | Falta `MAPBOX_ACCESS_TOKEN`, o el token está restringido por URL. |
| `/api/health` con `database: false` | `DATABASE_URL` mal copiada, pooler equivocado, o la contraseña tiene caracteres que hay que escapar en la URI (`@`, `#`). |
| `catalog: 0` | No corriste `db:seed` contra esa base. |
| El correo de acceso no entra | Redirect URL de Supabase no incluye `/auth/callback` de esa URL exacta (con `https`). |
| Electrolineras no aparece en el menú | La sesión no es `w1andresv@gmail.com`. |
| Fotos no se ven | Bucket `station-photos` inexistente, o la CSP/img-src no incluye el host de Supabase porque el build no tenía la URL. |
| Tras cambiar una variable pública no se nota | Redeploy. Esas variables entran en el build, no solo en el servidor. |
