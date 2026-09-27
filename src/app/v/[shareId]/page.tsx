import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { computePlansFromSnapshot } from "@/domain/ev/compute-plan";
import type { TripConditions, Vehicle } from "@/domain/types";
import { planTripFn } from "@/server/actions/plan";
import { getSharedTripFn } from "@/server/actions/trips";
import { formatKm, formatMinutes } from "@/lib/format";
import { SharedTripView } from "@/components/trips/shared-trip-view";

// Siempre público y sin sesión. Con snapshot guardado (F8) el plan se
// recalcula con esos datos, sin consultar proveedores; con ?actualizar=1, o
// en viajes guardados antes, con los datos de hoy.
export const dynamic = "force-dynamic";

const loadSharedTrip = cache((shareId: string) => getSharedTripFn({ data: { shareId } }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const trip = await loadSharedTrip(shareId);
  if (!trip) return { title: "Viaje no encontrado — EV-on-way" };

  const { originLabel, destinationLabel, distanceKm, totalMinutes, stops } = trip.summary;
  const title = `${originLabel} → ${destinationLabel} — EV-on-way`;
  const description = `${formatKm(distanceKm)} · ${formatMinutes(totalMinutes)} · ${stops} ${
    stops === 1 ? "parada de recarga" : "paradas de recarga"
  }`;
  return { title, description, openGraph: { title, description } };
}

export default async function SharedTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { shareId } = await params;
  const live = (await searchParams).actualizar === "1";
  const trip = await loadSharedTrip(shareId);
  if (!trip) notFound();

  const { request, snapshot } = trip;
  if (snapshot && !live) {
    const { plans, selectedId } = computePlansFromSnapshot(
      snapshot,
      { origin: request.origin, destination: request.destination },
      request.vehicle as Vehicle,
      request.conditions as TripConditions,
    );
    return (
      <SharedTripView
        request={request}
        plans={plans}
        selectedId={selectedId}
        computedFrom={{
          createdAt: snapshot.createdAt,
          modelVersion: snapshot.modelVersion,
          shareId,
        }}
      />
    );
  }
  const response = await planTripFn({ data: request });
  return (
    <SharedTripView request={request} plans={response.plans} selectedId={response.selectedId} />
  );
}
