import type { Charger } from "@/lib/domain/types";
import {
  CHARGER_SOURCE_LABEL,
  CONNECTOR_LABEL,
  STATION_AVAIL_LABEL,
  STATION_STATUS_LABEL,
  isVerifiedForPlanning,
} from "@/lib/domain/types";
import { formatKw, formatPrice, formatUpdatedAt } from "@/lib/format";
import { stationPhotoUrl } from "@/lib/storage/station-photos";
import { Badge } from "@/components/ui/badge";

export function ChargerFacts({ charger, compact = false }: { charger: Charger; compact?: boolean }) {
  const maxKw = charger.sockets.reduce((m, s) => Math.max(m, s.powerKw), 0);
  const plugs = charger.sockets.reduce((n, s) => n + s.count, 0);
  const status = charger.status;
  const avail = charger.availability ?? "unknown";
  const coords = `${charger.lat.toFixed(5)}, ${charger.lon.toFixed(5)}`;
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