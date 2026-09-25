import { useMutation } from "@tanstack/react-query";
import { MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { searchPlacesFn } from "@/server/actions/plan";
import type { Place } from "@/domain/types";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { suppressMapClicks } from "./map-click";

/** El toque que elige un resultado también genera un click fantasma en lo que quede debajo (p.ej. "Mi ubicación"); lo absorbemos. */
function swallowGhostClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", swallow, true), 400);
}

export function PlaceSearch({
  value,
  onChange,
  placeholder,
  icon,
  inputRef,
}: {
  value: Place | null;
  onChange: (p: Place | null) => void;
  placeholder: string;
  icon?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [q, setQ] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const setPlaceSearchOpen = usePlanner((s) => s.setPlaceSearchOpen);

  useEffect(() => {
    setQ(value?.label ?? "");
  }, [value]);

  const search = useMutation({
    mutationFn: (query: string) => searchPlacesFn({ data: { q: query } }),
    onError: (error) => console.error("[place-search]", error),
  });

  useEffect(() => {
    if (q.trim().length < 2 || (value && q === value.label)) {
      setOpen(false);
      return;
    }
    const t = setTimeout(() => {
      search.mutate(q);
      setOpen(true);
    }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const results = search.data ?? [];
  const showList = open && q.trim().length >= 2 && !(value && q === value.label);

  useEffect(() => {
    setHi(0);
  }, [search.data]);

  useEffect(() => {
    if (!showList) return;
    setPlaceSearchOpen(true);
    return () => setPlaceSearchOpen(false);
  }, [showList, setPlaceSearchOpen]);

  useEffect(() => {
    if (!showList) return;
    const onDown = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      suppressMapClicks(900);
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [showList]);

  function pick(p: Place) {
    suppressMapClicks(900);
    swallowGhostClick();
    onChange(p);
    setQ(p.label);
    setOpen(false);
  }

  return (
    <div ref={box} className={cn("relative", showList && "z-40")} onPointerDown={() => suppressMapClicks(900)}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          {icon ?? <MapPin className="size-4" />}
        </span>
        <Input
          ref={inputRef}
          value={q}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          suppressHydrationWarning
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          className="pl-9 pr-9"
          onFocus={() => {
            suppressMapClicks(900);
            if (q.trim().length >= 2 && !(value && q === value.label)) setOpen(true);
          }}
          onChange={(e) => {
            setQ(e.target.value);
            if (value) onChange(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && results.length) {
              e.preventDefault();
              setOpen(true);
              setHi((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp" && results.length) {
              e.preventDefault();
              setHi((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              const chosen = results[hi] ?? results[0];
              if (chosen) {
                e.preventDefault();
                pick(chosen);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {q ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-fg"
            onPointerDown={(e) => {
              e.preventDefault();
              suppressMapClicks(900);
            }}
            onClick={() => {
              setQ("");
              onChange(null);
              setOpen(false);
            }}
            aria-label="Limpiar"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {showList ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface-2 shadow-float"
        >
          {search.isPending && results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted">Buscando…</div>
          ) : search.isError ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-warn">
              <span>No se pudo buscar lugares. Revisa tu conexión.</span>
              <button
                type="button"
                className="rounded-md px-2 py-1.5 font-medium text-fg hover:bg-surface"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  search.mutate(q);
                }}
              >
                Reintentar
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted">Sin resultados</div>
          ) : (
            <ul>
              {results.map((p, i) => (
                <li key={`${p.lat}-${p.lon}-${p.label}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === hi}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left",
                      i === hi ? "bg-accent-dim/50" : "hover:bg-surface",
                    )}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      pick(p);
                    }}
                  >
                    <span className="text-sm text-fg">{p.label}</span>
                    {p.context ? <span className="text-xs text-muted">{p.context}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
