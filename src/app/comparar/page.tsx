import type { Metadata } from "next";
import { Suspense } from "react";
import { VehicleComparison } from "@/components/compare/vehicle-comparison";

export const metadata: Metadata = {
  title: "EV-on-way · Comparar vehículos",
  description: "Tu vehículo y otros uno o dos, lado a lado, en la misma ruta.",
  robots: { index: false, follow: false },
};

/**
 * Comparativa lado a lado (?vehiculos=a,b). La página es estática: los datos
 * salen del plan en el navegador, así que también abre sin conexión (PWA).
 */
export default function ComparePage() {
  return (
    <main className="relative z-20 h-dvh overflow-y-auto bg-bg pt-14">
      <Suspense fallback={null}>
        <VehicleComparison />
      </Suspense>
    </main>
  );
}
