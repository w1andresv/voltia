"use client";

import type { Actor, AuthPort } from "@/domain/auth/port";
import { getBrowserSupabase } from "@/infrastructure/supabase/browser";

const guest: Actor = { role: "guest", id: null, email: null };

export function createSupabaseAuth(): AuthPort {
  return {
    async currentActor() {
      const supabase = getBrowserSupabase();
      if (!supabase) return guest;
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return guest;
      return { role: "member", id: user.id, email: user.email ?? null };
    },
    async signInWithEmail(email, redirectTo) {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Supabase no está configurado");
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
    },
    async signInWithGoogle(redirectTo) {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Supabase no está configurado");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) throw error;
    },
    async signOut() {
      const supabase = getBrowserSupabase();
      if (!supabase) return;
      await supabase.auth.signOut();
    },
  };
}
