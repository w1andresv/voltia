import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlannerApp } from "@/components/planner/planner-app";
import { plannerHref } from "@/lib/planner-routes";
import { plannerEngineFor } from "@/server/planner-route";

export const metadata: Metadata = {
  title: "Voltia · Planificador v1",
  description: "Planificador de viajes en eléctrico con el motor v1: paradas elegidas por puntaje.",
};

export default async function PlannerV1Page() {
  const engine = await plannerEngineFor("v1");
  if (engine !== "v1") redirect(plannerHref(engine));
  return <PlannerApp engine="v1" />;
}
