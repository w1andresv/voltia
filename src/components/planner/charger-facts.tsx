import type { Charger, Vehicle } from "@/domain/types";
import {
  CHARGER_SOURCE_LABEL,
  CONNECTOR_LABEL,
  STATION_AVAIL_LABEL,
  STATION_STATUS_LABEL,
  isVerifiedForPlanning,
} from "@/domain/types";
import { formatKw, formatPrice, formatUpdatedAt } from "@/lib/format";
import { stationPhotoUrl } from "@/infrastructure/storage/station-photos";
import { Badge } from "@/components/ui/badge";
import { adapterRequirement } from "@/domain/ev/engines/compatibility/engine";
import { vehicleLabel } from "@/domain/vehicles";
import { adapterRequirementNote } from "@/lib/adapter-note";
import { usePlanner } from "@/lib/store";
import { LiveChargerStatus } from "./live-charger-status";

/** Si el conector de la estación no coincide con el del vehículo: qué adaptador requiere. */
function adapterMessage(charger: Charger, vehicle: Vehicle): string | null {
  const requirement = adapterRequirement(charger, vehicle);
  return requirement
    ? adapterRequirementNote(requirement, { name: vehicleLabel(vehicle), connectors: vehicle.connectors })
    : null;
}

export function ChargerFacts({ charger, compact = false }: { charger: Charger; compact?: boolean }) {
  const maxKw = charger.sockets.reduce((m, s) => Math.max(m, s.powerKw), 0);
  const plugs = charger.sockets.reduce((n, s) => n + s.count, 0);
  const status = charger.status;
  const avail = charger.availability ?? "unknown";
  const coords = `${charger.lat.toFixed(5)}, ${charger.lon.toFixed(5)}`;
  const vehicle = usePlanner((s) => s.selectedVehicle());
  const issues = charger.planningIssues ?? [];
  const adapter = adapterMessage(charger, vehicle);
  const verified = isVerifiedForPlanning(charger);

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className="font-medium text-fg">{charger.name}</div>
      <div className="text-xs text-muted">
        {charger.operator || "Operador no indicado"}
        {charger.address ? ` · ${charger.address}` : ""}
      </div>
      <div className="text-xs text-muted">Coordenadas {coords}</div>
      <div className="flex flex-wrap gap-1">
        <Badge variant={verified ? "ok" : "warn"}>{verified ? "Verificada" : "No verificada"}</Badge>
        {status && charger.source === "community" ? (
          <Badge variant={status === "approved" ? "ok" : status === "rejected" ? "danger" : "warn"}>
            {STATION_STATUS_LABEL[status]}
          </Badge>
        ) : (
          <Badge variant={charger.source === "plugshare" ? "accent" : "default"}>
            {CHARGER_SOURCE_LABEL[charger.source]}
          </Badge>
        )}
        <Badge variant={avail === "available" ? "ok" : avail === "offline" ? "danger" : "default"}>
          {STATION_AVAIL_LABEL[avail]}
        </Badge>
      </div>
      {issues.length ? (
        <div className="text-xs text-warn">No se usa para planificar: {issues.join(" · ")}.</div>
      ) : null}
      {adapter ? <div className="text-xs text-warn">{adapter}</div> : null}
      {charger.unknownConnectors?.length ? (
        <div className="text-xs text-muted">
          Conector sin reconocer: {charger.unknownConnectors.join(", ")} (no se tiene en cuenta).
        </div>
      ) : null}
      {!verified && charger.source === "community" ? (
        <div className="text-xs text-warn">No se usa para planificar hasta que la comunidad la confirme.</div>
      ) : null}
      <div className="text-xs text-muted">
        {charger.sockets.map((s) => `${CONNECTOR_LABEL[s.connector]} ${formatKw(s.powerKw)} ×${s.count}`).join(" · ")}
      </div>
      <div className="text-xs text-muted">
        Máx. {formatKw(maxKw)} · {plugs} conector{plugs === 1 ? "" : "es"}
        {charger.pricePerKwh
          ? ` · ${formatPrice(charger.pricePerKwh.amount, charger.pricePerKwh.currency)}/kWh`
          : ""}
      </div>
      {!compact && charger.source === "blaze" ? <LiveChargerStatus stationId={charger.id} /> : null}
      <div className="text-xs text-muted">
        Fuente {CHARGER_SOURCE_LABEL[charger.source]} · Actualización {formatUpdatedAt(charger.updatedAt)}
      </div>
      {charger.openingHours ? <div className="text-xs text-muted">Horario {charger.openingHours}</div> : null}
      {!compact && charger.notes ? <p className="text-xs leading-relaxed text-muted">{charger.notes}</p> : null}
      {charger.url ? (
        <a
          href={charger.url}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-accent underline-offset-2 hover:underline"
        >
          {charger.source === "plugshare" ? "Ver en PlugShare" : "Ver ficha"}
        </a>
      ) : null}
      {!compact && charger.photos?.length ? (
        <div className="flex gap-2">
          {charger.photos.map((src, i) => (
            <img
              key={i}
              src={stationPhotoUrl(src)}
              alt=""
              className="h-16 w-24 rounded-md object-cover"
              crossOrigin="anonymous"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}