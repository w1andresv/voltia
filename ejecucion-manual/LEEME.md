# Ejecución manual — usuarios y catálogo (2026-09-23)

Ejecuta en este orden. Los `.sql` se pegan en el SQL Editor de Supabase; los `.sh` van en la terminal
(raíz del proyecto, con `DATABASE_URL` definido). Esta carpeta NO es leída por `db:migrate` ni `db:seed`.

| # | Archivo | Dónde | Obligatorio |
|---|---------|-------|-------------|
| 0 | 00-diagnostico.sql y 00-diagnostico-api.sh (si algo falla) | SQL Editor / Terminal | No |
| 1 | 01-respaldo-catalogo.sql | SQL Editor | Sí |
| 2 | 02-precheck-duplicados.sql (esperado: 0 filas) | SQL Editor | Sí |
| 3 | 03-migrar.sh (0007–0010; la 0010 pasa todo a public.voltia_*) | Terminal | Sí |
| 4 | 04-verificar-migracion.sql | SQL Editor | Sí |
| 5 | 05-exponer-esquema.md (ya no hace falta, solo leer) | — | No |
| 6 | 06-sembrar-catalogo.sh | Terminal | Sí |
| 7 | 07-verificar-catalogo.sql | SQL Editor | Sí |
| 8 | 08-limpiar-catalogo-viejo.sql | SQL Editor | Opcional |
| 9 | 09-regresiones-manuales.md | Navegador | Sí |
| 10 | 10-agregar-vehiculos.sql (más marcas y modelos; datos de referencia a verificar) | SQL Editor | Opcional |

Haz primero todo en una copia/staging de la base. Si el paso 2 devuelve filas o el 3 falla, detente:
la migración 0008 aborta a propósito ante duplicados y nada queda a medias (cada migración es transaccional).
