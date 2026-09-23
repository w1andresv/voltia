import "server-only";
import { createServerSupabase } from "@/infrastructure/supabase/server";
import type { IdentityProvider } from "@/domain/user/ports";

/**
 * Adaptador de IdentityProvider para Supabase Auth. Con supabase-auth.ts (el
 * cliente de login) es lo único que conoce a Supabase Auth: cambiar de
 * proveedor es escribir otro adaptador que devuelva otro `provider`.
 *
 * Usa `getUser()`, nunca `getSession()`: revalida el token contra el servidor
 * de auth, así una cookie editada no suplanta a nadie.
 */
export const supabaseIdentity: IdentityProvider = {
  async currentIdentity() {
    const supabase = await createServerSupabase();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user || !user.email) return null;
    return { provider: "supabase", subject: user.id, email: user.email };
  },
};
