import { type FormEvent, useEffect, useState } from "react";
import { PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isPlugshareToken, PLUGSHARE_ACCESS_URL } from "@/lib/plugshare";
import { usePlanner } from "@/lib/store";

export function PlugshareSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const token = usePlanner((s) => s.plugshareToken);
  const setToken = usePlanner((s) => s.setPlugshareToken);
  const [draft, setDraft] = useState(token);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(token);
      setError(null);
    }
  }, [open, token]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (next && !isPlugshareToken(next)) {
      setError("La clave es demasiado corta. Pega el token que te dio PlugShare.");
      return;
    }
    setError(null);
    setToken(next);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-md bg-accent/15 text-accent">
              <PlugZap className="size-4" />
            </span>
            PlugShare
          </DialogTitle>
          <DialogDescription>
            Red de electrolineras de PlugShare para el mapa y las paradas de carga. Es opcional: sin clave seguimos
            con OpenStreetMap, el catálogo verificado del operador y los aportes confirmados.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <p className="text-sm leading-relaxed text-muted">
            PlugShare solo licencia su API a empresas. Si tienes una clave, pégala aquí (Bearer, Basic o el valor
            crudo). No uses las credenciales internas de plugshare.com.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="plugshare-token">Clave de API</Label>
            <Input
              id="plugshare-token"
              name="plugshare-token"
              autoComplete="off"
              spellCheck={false}
              placeholder="Bearer eyJ… o tu API key"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
            />
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            {token ? (
              <p className="text-xs text-ok">Conectado. Las estaciones PlugShare entran al mapa y al planificador.</p>
            ) : (
              <p className="text-xs text-muted">
                Sin clave ahora. Solicítala en{" "}
                <a
                  href={PLUGSHARE_ACCESS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  developer.plugshare.com
                </a>
                .
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11 flex-1">
              {draft.trim() ? "Guardar clave" : "Seguir sin PlugShare"}
            </Button>
            {token ? (
              <Button
                type="button"
                variant="secondary"
                className="h-11"
                onClick={() => {
                  setDraft("");
                  setToken("");
                  onOpenChange(false);
                }}
              >
                Quitar
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
