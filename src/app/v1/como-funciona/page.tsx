import type { Metadata } from "next";
import { GUIDE_V1 } from "@/components/guide/content";
import { EngineGuide } from "@/components/guide/engine-guide";

export const metadata: Metadata = {
  title: "Voltia · Cómo funciona v1",
  description:
    "Cómo planifica Voltia con el motor v1: endpoints, entradas de cada algoritmo, paradas por puntaje y una demo interactiva.",
};

export default function GuideV1Page() {
  return <EngineGuide content={GUIDE_V1} />;
}
