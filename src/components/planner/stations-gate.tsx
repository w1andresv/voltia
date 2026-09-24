"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActorState } from "@/infrastructure/auth/use-actor";
import { canSeeStationsMenu } from "@/lib/stations-access";
import { StationsApp } from "./stations-app";

export function StationsGate() {
  const { actor, isLoading } = useActorState();
  const router = useRouter();
  const allowed = canSeeStationsMenu(actor.email);

  useEffect(() => {
    if (!isLoading && !allowed) router.replace("/planificar");
  }, [allowed, isLoading, router]);

  if (isLoading || !allowed) return null;
  return <StationsApp />;
}
