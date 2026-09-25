import "server-only";
import { getSql } from "@/infrastructure/db";
import type { Identity } from "@/domain/user/ports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Alta idempotente de un usuario a partir de una identidad verificada por el
 * proveedor. Devuelve el id interno de public.voltia_users.
 *
 *  1. Identidad ya registrada → actualiza último acceso y devuelve su usuario.
 *  2. Si no, crea el usuario (o reutiliza el que tenga el mismo correo, que el
 *     proveedor ya verificó) y registra la identidad.
 *
 * Es seguro ante dos llamadas concurrentes: los `on conflict` convergen y el
 * paso final relee la identidad ganadora.
 */
export async function ensureUser(identity: Identity): Promise<string> {
  const sql = await getSql();
  const { provider, subject, email } = identity;

  const known = await sql.query<{ user_id: string }>(
    `select user_id from public.voltia_user_identities where provider = $1 and subject = $2`,
    [provider, subject],
  );
  if (known[0]) {
    await sql.query(
      `update public.voltia_users set last_sign_in_at = now() where id = $1 and (last_sign_in_at is null or last_sign_in_at < now() - interval '1 hour')`,
      [known[0].user_id],
    );
    return known[0].user_id;
  }

  // Para Supabase el usuario nuevo nace con id = auth.uid(), igual que los
  // existentes tras el backfill de 0007: la carpeta de fotos en Storage
  // ("<id>/<uuid>.jpg") y sus políticas siguen alineadas con la sesión. Otro
  // proveedor recibe un uuid propio; la relación va por user_identities.
  const preferredId = provider === "supabase" && UUID.test(subject) ? subject : null;
  const created = await sql.query<{ id: string }>(
    `insert into public.voltia_users (id, email, last_sign_in_at)
     values (coalesce($2::uuid, gen_random_uuid()), $1, now())
     on conflict (lower(email)) do update set last_sign_in_at = now(), updated_at = now()
     returning id`,
    [email, preferredId],
  );
  const userId = created[0]!.id;

  await sql.query(
    `insert into public.voltia_user_identities (provider, subject, user_id)
     values ($1, $2, $3)
     on conflict (provider, subject) do nothing`,
    [provider, subject, userId],
  );

  const final = await sql.query<{ user_id: string }>(
    `select user_id from public.voltia_user_identities where provider = $1 and subject = $2`,
    [provider, subject],
  );
  return final[0]?.user_id ?? userId;
}
