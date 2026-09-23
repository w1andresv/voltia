export type ActorRole = "guest" | "member" | "admin";

export type Actor = {
  role: ActorRole;
  id: string | null;
  email: string | null;
};

export type AuthPort = {
  currentActor(): Promise<Actor>;
  signInWithGoogle(redirectTo: string): Promise<void>;
  signOut(): Promise<void>;
};
