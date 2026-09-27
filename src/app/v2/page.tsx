import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlannerApp } from "@/components/planner/planner-app";
import { plannerHref } from "@/lib/planner-routes";
import { plannerEngineFor } from "@/server/planner-route";

export const metadata: Metadata = {
  title: "EV-on-way · Planificador v2",
  description:
    "Planificador de viajes en eléctrico con el motor v2: paradas por programación dinámica y electrolineras de Blaze.",
};

export default async function PlannerV2Page() {
  const engine = await plannerEngineFor("v2");
  if (engine !== "v2") redirect(plannerHref(engine));
  return <PlannerApp engine="v2" />;
}
