"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActorState } from "@/infrastructure/auth/use-actor";
import { plannerHref } from "@/lib/planner-routes";
import { canSeeStationsMenu } from "@/lib/stations-access";
import { usePlanner } from "@/lib/store";
import { StationsApp } from "./stations-app";

export function StationsGate() {
  const { actor, isLoading } = useActorState();
  const router = useRouter();
  const allowed = canSeeStationsMenu(actor.email);

  useEffect(() => {
    if (!isLoading && !allowed) router.replace(plannerHref(usePlanner.getState().engineChoice));
  }, [allowed, isLoading, router]);

  if (isLoading || !allowed) return null;
  return <StationsApp />;
}
