import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GUIDE_V2 } from "@/components/guide/content";
import { EngineGuide } from "@/components/guide/engine-guide";
import { canOpenGuides } from "@/server/guide-route";

export const metadata: Metadata = {
  title: "EV-on-way · Cómo funciona v2",
  description:
    "Cómo planifica EV-on-way con el motor v2: endpoints, entradas de cada algoritmo, programación dinámica y una demo interactiva.",
  robots: { index: false, follow: false },
};

// Solo para la cuenta del dueño; a los demás la ruta no existe.
export default async function GuideV2Page() {
  if (!(await canOpenGuides())) notFound();
  return <EngineGuide content={GUIDE_V2} />;
}
