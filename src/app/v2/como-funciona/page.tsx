import type { Metadata } from "next";
import { GUIDE_V2 } from "@/components/guide/content";
import { EngineGuide } from "@/components/guide/engine-guide";

export const metadata: Metadata = {
  title: "Voltia · Cómo funciona v2",
  description:
    "Cómo planifica Voltia con el motor v2: endpoints, entradas de cada algoritmo, programación dinámica y una demo interactiva.",
};

export default function GuideV2Page() {
  return <EngineGuide content={GUIDE_V2} />;
}
