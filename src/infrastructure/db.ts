/**
 * Postgres access for the whole app: getSql() wraps node-postgres (`pg`),
 * pooled once per process. Schema lives in migrations/*.sql, applied by
 * `npm run db:migrate` (scripts/migrate.mjs) at deploy time — never inline
 * SQL DDL here.
 *
 * Requires DATABASE_URL. There is no embedded fallback: every environment,
 * local dev included, points at a real Postgres (see .env.example). An
 * empty/whitespace value (an easy misconfig in deploy UIs) counts as unset.
 *
 * En producción serverless, DATABASE_URL debe apuntar al connection pooler
 * de Supabase (puerto 6543, modo transaction) — no al puerto 5432 directo,
 * que se queda sin conexiones bajo varias funciones concurrentes. `max: 1`
 * abajo asume ese pooler: cada instancia de función abre como mucho una
 * conexión, y es el pooler el que multiplexa hacia Postgres.
 */
const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;

/**
 * Minimal shared SQL surface. Both the tagged-template and `.query()` forms
 * resolve to an array of row objects:
 *
 *   const sql = await getSql();
 *   const rows = await sql`select * from todos where id = ${id}`; // parameterized
 *   const rows2 = await sql.query("select * from todos where id = $1", [id]);
 */
export interface Sql {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/**
 * pg sends every value as text plus a type OID; these three are the ones
 * whose default JS parsing is either lossy or timezone-dependent:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision —
 *                                   cast ::text if you ever need huge integers)
 *   date                        -> raw text, not a local-midnight JS Date
 *                                   (that shifts a day under JSON.stringify
 *                                   in negative UTC offsets)
 *   interval                    -> raw Postgres interval text
 * numeric already comes back as a string (arbitrary precision) — left alone.
 */
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Wrap a query runner in the tagged-template + `.query()` `Sql` surface. */
function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    // Rebuild with $1, $2, … placeholders so values stay parameterized.
    // strings.length is always values.length + 1 (TemplateStringsArray's own
    // guarantee), so every index below is in range.
    let text = strings[0]!;
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]!}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => run<T>(text, params);
  return sql;
}

/**
 * Init state lives on globalThis: dev HMR creates new instances of this
 * module, and two instances racing module-level state would open a second
 * pool. A failed init clears its slot so the next call retries.
 */
const globalRef = globalThis as typeof globalThis & { __pgSqlPromise__?: Promise<Sql> };

/**
 * Get the shared, **server-only** SQL client (one `pg` pool per process).
 * Memoized — safe to call per request. Throws immediately, with a clear
 * message, if called from the browser or if DATABASE_URL isn't set.
 */
export function getSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/infrastructure/db es solo de servidor — llama a getSql() desde una server action " +
        "o un route handler, nunca desde código de cliente.",
    );
  }
  if (!databaseUrl) {
    throw new Error(
      "Falta DATABASE_URL. Copia .env.example a .env.local (o configúrala en el " +
        "entorno de despliegue) con la conexión de Postgres.",
    );
  }

  globalRef.__pgSqlPromise__ ??= (async () => {
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const pool = new Pool({
      connectionString: databaseUrl,
      // 1 por instancia: en serverless cada cold start es un proceso nuevo,
      // así que un max mayor abre más conexiones de las que el pooler de
      // Supabase espera de un solo cliente (ver nota arriba).
      max: 1,
      ssl: databaseUrl.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}
