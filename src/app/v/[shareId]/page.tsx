import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { planTripFn } from "@/lib/api/plan";
import { getSharedTripFn } from "@/lib/api/trips";
import { formatKm, formatMinutes } from "@/lib/format";
import { SharedTripView } from "@/components/trips/shared-trip-view";

// Siempre público y sin sesión — cada visita recalcula la ruta con los
// datos vivos de los proveedores, así que no tiene sentido cachearla.
export const dynamic = "force-dynamic";

const loadSharedTrip = cache((shareId: string) => getSharedTripFn({ data: { shareId } }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const trip = await loadSharedTrip(shareId);
  if (!trip) return { title: "Viaje no encontrado — Voltia" };

  const { originLabel, destinationLabel, distanceKm, totalMinutes, stops } = trip.summary;
  const title = `${originLabel} → ${destinationLabel} — Voltia`;
  const description = `${formatKm(distanceKm)} · ${formatMinutes(totalMinutes)} · ${stops} ${
    stops === 1 ? "parada de recarga" : "paradas de recarga"
  }`;
  return { title, description, openGraph: { title, description } };
}

export default async function SharedTripPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const trip = await loadSharedTrip(shareId);
  if (!trip) notFound();

  const response = await planTripFn({ data: trip.request });
  return <SharedTripView request={trip.request} plans={response.plans} selectedId={response.selectedId} />;
}
