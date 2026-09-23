import { type FormEvent, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isMapboxPublicToken } from "@/lib/mapbox";
import { usePlanner } from "@/lib/store";

export function MapboxTokenGate() {
  const token = usePlanner((s) => s.mapboxToken);
  const setToken = usePlanner((s) => s.setMapboxToken);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (token) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (!isMapboxPublicToken(next)) {
      setError("El token público de Mapbox empieza por pk.");
      return;
    }
    setError(null);
    setToken(next);
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 grid place-items-center bg-bg/75 p-5">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-panel">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-accent/15 text-accent">
            <MapIcon className="size-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-fg">Mapa Mapbox</h2>
            <p className="text-sm text-muted">Fondo Navigation Night, sin cuenta en Voltia.</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Mapbox pide un token público. Créalo en{" "}
          <a
            href="https://account.mapbox.com/access-tokens/"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            account.mapbox.com
          </a>{" "}
          (plan gratuito) y pégalo aquí. Empieza por <span className="font-mono text-fg">pk.</span>
        </p>
        <div className="mt-4 grid gap-2">
          <Label htmlFor="mapbox-token">Token público</Label>
          <Input
            id="mapbox-token"
            name="mapbox-token"
            autoComplete="off"
            spellCheck={false}
            placeholder="pk.eyJ1Ijoi…"
            value={draft}
            suppressHydrationWarning
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
          />
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
        <Button type="submit" className="mt-4 w-full">
          Usar Mapbox
        </Button>
      </form>
    </div>
  );
}
