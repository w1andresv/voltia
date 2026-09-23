export type ActorRole = "guest" | "member" | "admin";

export type Actor = {
  role: ActorRole;
  id: string | null;
  email: string | null;
};

export type AuthPort = {
  currentActor(): Promise<Actor>;
  /** Magic link: sends a one-time sign-in link to `email`, no password. MVP's only sign-in method. */
  signInWithEmail(email: string, redirectTo: string): Promise<void>;
  /** Left for a later version (needs the Google provider set up in Supabase) — not wired into the UI yet. */
  signInWithGoogle(redirectTo: string): Promise<void>;
  signOut(): Promise<void>;
};
