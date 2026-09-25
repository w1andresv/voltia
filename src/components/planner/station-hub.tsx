"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { MapPinPlus, Zap } from "lucide-react";
import { toast } from "sonner";
import { reviewStationFn } from "@/server/actions/stations";
import { useActor } from "@/infrastructure/auth/use-actor";
import type { Charger, StationStatus } from "@/domain/types";
import { CATALOG_CHARGERS } from "@/infrastructure/providers/chargers.catalog";
import { usePlugshareEnabled } from "./use-plugshare";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChargerFacts } from "./charger-facts";
import { StationEditor } from "./station-editor";
import { useCommunityStations } from "./use-stations";

export function StationHub() {
  const open = usePlanner((s) => s.stationsOpen);
  const setOpen = usePlanner((s) => s.setStationsOpen);
  const setArmed = usePlanner((s) => s.setMapClickArmed);
  const setSeed = usePlanner((s) => s.setStationSeed);
  const router = useRouter();
  const { data: community = [], isLoading } = useCommunityStations();
  const plugshareOn = usePlugshareEnabled();
  const actor = useActor();
  const isAdmin = actor.role === "admin";
  const pending = community.filter((c) => c.status === "pending");
  const approved = community.filter((c) => c.status === "approved");
  const rejected = community.filter((c) => c.status === "rejected");

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(100%-1.5rem,640px)]">
          <DialogHeader>
            <DialogTitle>Electrolineras públicas</DialogTitle>
            <DialogDescription>
              Misma red que el planificador: PlugShare, OpenStreetMap, catálogo del operador y aportes confirmados. Las pendientes se ven en el mapa pero no se usan para recargar.
            </DialogDescription>
          </DialogHeader>
          <div className="mb-3 flex gap-2">
            <Button
              size="sm"
              className="h-11"
              onClick={() => {
                setOpen(false);
                setArmed("station");
                void router.push("/electrolineras");
              }}
            >
              <MapPinPlus className="size-4" />
              Ubicar en el mapa
            </Button>
          </div>
          <Tabs defaultValue={isAdmin ? "pending" : "network"}>
            <TabsList className={isAdmin ? "grid w-full grid-cols-3" : "grid w-full grid-cols-1"}>
              {isAdmin ? (
                <TabsTrigger value="pending">Pendientes {pending.length ? `(${pending.length})` : ""}</TabsTrigger>
              ) : null}
              <TabsTrigger value="network">Red</TabsTrigger>
              {isAdmin ? <TabsTrigger value="rejected">Rechazadas</TabsTrigger> : null}
            </TabsList>
            {isAdmin ? (
              <TabsContent value="pending">
                {isLoading ? (
                  <p className="text-sm text-muted">Cargando aportes…</p>
                ) : pending.length ? (
                  <ul className="space-y-3">
                    {pending.map((c) => (
                      <StationReviewRow
                        key={c.id}
                        charger={c}
                        onEdit={() => {
                          setSeed({ lat: c.lat, lon: c.lon, address: c.address, editId: c.id });
                        }}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No hay estaciones esperando validación.</p>
                )}
              </TabsContent>
            ) : null}
            <TabsContent value="network">
              <p className="mb-3 text-xs text-muted">
                {approved.length} confirmadas por la comunidad · {CATALOG_CHARGERS.length} en catálogo verificado del operador
                {plugshareOn ? " · PlugShare activo en el mapa" : ""}.
              </p>
              <ul className="max-h-80 space-y-3 overflow-y-auto">
                {approved.map((c) => (
                  <li key={c.id} className="rounded-lg bg-bg-elevated p-3">
                    <ChargerFacts charger={c} />
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-11"
                      onClick={() => setSeed({ lat: c.lat, lon: c.lon, address: c.address, editId: c.id })}
                    >
                      Editar ficha
                    </Button>
                  </li>
                ))}
              </ul>
            </TabsContent>
            {isAdmin ? (
              <TabsContent value="rejected">
                {rejected.length ? (
                  <ul className="space-y-3">
                    {rejected.map((c) => (
                      <li key={c.id} className="rounded-lg bg-bg-elevated p-3">
                        <ChargerFacts charger={c} />
                        {c.reviewNote ? <p className="mt-1 text-xs text-danger">{c.reviewNote}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Ninguna estación rechazada.</p>
                )}
              </TabsContent>
            ) : null}
          </Tabs>
        </DialogContent>
      </Dialog>
      <StationEditor stations={community} />
    </>
  );
}

function StationReviewRow({ charger, onEdit }: { charger: Charger; onEdit: () => void }) {
  const qc = useQueryClient();
  const inject = usePlanner((s) => s.injectCharger);
  const review = useMutation({
    mutationFn: reviewStationFn,
    onSuccess: (row) => {
      toast.success(row.status === "approved" ? "Estación confirmada. Ya cuenta para planificar." : "Estación retirada de la red");
      inject(row);
      void qc.invalidateQueries({ queryKey: ["stations"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo validar"),
  });

  return (
    <li className="rounded-lg bg-bg-elevated p-3">
      <ChargerFacts charger={charger} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          className="h-11"
          onClick={() => review.mutate({ data: { id: charger.id, status: "approved" as StationStatus } })}
          disabled={review.isPending}
        >
          Aprobar
        </Button>
        <Button size="sm" variant="outline" className="h-11" onClick={onEdit}>
          Modificar
        </Button>
        <Button
          size="sm"
          variant="danger"
          className="h-11"
          onClick={() =>
            review.mutate({
              data: { id: charger.id, status: "rejected", reviewNote: "Información insuficiente o duplicada" },
            })
          }
          disabled={review.isPending}
        >
          Rechazar
        </Button>
      </div>
    </li>
  );
}

export function StationsButton() {
  const open = usePlanner((s) => s.setStationsOpen);
  const { data } = useCommunityStations();
  const pending = data?.filter((c) => c.status === "pending").length ?? 0;
  return (
    <Button variant="ghost" size="icon" onClick={() => open(true)} aria-label="Electrolineras públicas">
      <span className="relative">
        <Zap className="size-5" />
        {pending ? <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-warn" /> : null}
      </span>
    </Button>
  );
}
