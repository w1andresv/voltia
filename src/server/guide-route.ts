import "server-only";
import { canSeeGuides } from "@/lib/guide-access";

/**
 * ¿Quien abre /v1/como-funciona o /v2/como-funciona puede verla? Se decide en
 * el servidor con la sesión verificada; si la sesión falla, cuenta como invitado.
 */
export async function canOpenGuides(): Promise<boolean> {
  const { getActor } = await import("@/infrastructure/auth/server-actor");
  const actor = await getActor().catch(() => null);
  return canSeeGuides(actor?.email);
}
