"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/infrastructure/supabase/browser";
import { getActorFn } from "@/lib/api/auth";
import type { Actor } from "@/domain/auth/port";

const guest: Actor = { role: "guest", id: null, email: null };

/**
 * Current actor for UI purposes (show the sign-in button vs. the account
 * menu, show/hide moderation controls for admins). Refetches on sign-in /
 * sign-out. This is not the access check — every server action calls
 * requireMember()/requireAdmin() itself, so a stale value here can only
 * hide or show a button, never grant access.
 */
export function useActor(): Actor {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["actor"],
    queryFn: () => getActorFn(),
    staleTime: 60_000,
  });

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      queryClient.invalidateQueries({ queryKey: ["actor"] });
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  return query.data ?? guest;
}
