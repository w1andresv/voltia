import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LoaderCircle, MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import type { Place } from "@/domain/types";
import { fetchPlaces, placeQueryKey } from "@/lib/places";
import { usePlanner } from "@/lib/store";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { suppressMapClicks } from "./map-click";

/** Espera tras la última letra antes de buscar. */
const SEARCH_DEBOUNCE_MS = 200;

/** Celular: la lista se abre bajo el campo y el teclado tapa buena parte de la pantalla. */
function isNarrow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
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
  /** Enter antes de que lleguen los resultados del texto actual: elige el primero al llegar. */
  const enterPending = useRef(false);

  useEffect(() => {
    setQ(value?.label ?? "");
  }, [value]);

  const typing = q.trim().length >= 2 && !(value && q === value.label);
  const term = useDebouncedValue(typing ? placeQueryKey(q) : "", SEARCH_DEBOUNCE_MS);
  // Una consulta por texto: la caché responde al instante si se vuelve a escribir
  // (o se borra una letra), y React Query cancela la búsqueda que ya no sirve.
  const search = useQuery({
    queryKey: ["places", term],
    queryFn: ({ signal }) => fetchPlaces(term, signal),
    enabled: term.length >= 2,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    retry: false,
    // Mientras busca, deja la lista anterior en vez de "Buscando…".
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (search.error) console.error("[place-search]", search.error);
  }, [search.error]);

  const results = search.data ?? [];
  /** Los resultados son del texto que se ve, no de uno anterior. */
  const fresh =
    typing && term === placeQueryKey(q) && search.isSuccess && !search.isPlaceholderData;
  const loading = typing && !fresh && !search.isError;
  const showList = open && typing;

  useEffect(() => {
    setHi(0);
  }, [search.data]);

  useEffect(() => {
    if (!fresh || !enterPending.current) return;
    enterPending.current = false;
    if (results[0]) pick(results[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, results]);

  useEffect(() => {
    if (!showList) return;
    setPlaceSearchOpen(true);
    return () => setPlaceSearchOpen(false);
  }, [showList, setPlaceSearchOpen]);

  // Fuera de la lista: apoyar el dedo solo bloquea el mapa; la lista se cierra con un
  // toque completo (click). Así deslizar la página para ver más resultados no la cierra.
  useEffect(() => {
    if (!showList) return;
    const outside = (e: Event) => !box.current?.contains(e.target as Node);
    const onDown = (e: PointerEvent) => {
      if (outside(e)) suppressMapClicks(900);
    };
    const onClick = (e: MouseEvent) => {
      if (outside(e)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [showList]);

  function pick(p: Place) {
    enterPending.current = false;
    suppressMapClicks(900);
    onChange(p);
    setQ(p.label);
    setOpen(false);
  }

  return (
    <div
      ref={box}
      className={cn("relative scroll-mt-16", showList && "z-40")}
      onPointerDown={() => suppressMapClicks(900)}
    >
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          {showList && loading ? (
            <LoaderCircle className="size-4 animate-spin" aria-label="Buscando" />
          ) : (
            (icon ?? <MapPin className="size-4" />)
          )}
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
            // En celular, sube el campo al tope para que la lista quepa sobre el teclado.
            if (isNarrow()) {
              setTimeout(() => box.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
            }
            if (typing) setOpen(true);
          }}
          onChange={(e) => {
            setQ(e.target.value);
            enterPending.current = false;
            setOpen(e.target.value.trim().length >= 2);
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
              if (!typing) return;
              e.preventDefault();
              // Con la lista de un texto anterior, Enter elegiría otro lugar: espera la buena.
              const chosen = fresh ? (results[hi] ?? results[0]) : undefined;
              if (chosen) pick(chosen);
              else if (loading) enterPending.current = true;
            } else if (e.key === "Escape") {
              enterPending.current = false;
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
          {loading && results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted">Buscando…</div>
          ) : search.isError && !loading ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-warn">
              <span>No se pudo buscar lugares. Revisa tu conexión.</span>
              <button
                type="button"
                className="rounded-md px-2 py-1.5 font-medium text-fg hover:bg-surface"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void search.refetch();
                }}
              >
                Reintentar
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted">Sin resultados</div>
          ) : (
            <ul className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
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
                    // Se elige con el toque completo (click), no al apoyar el dedo: así se
                    // puede deslizar la lista sin elegir. Con mouse, evita que el campo
                    // pierda el foco antes del click.
                    onPointerDown={(e) => {
                      if (e.pointerType === "mouse") e.preventDefault();
                    }}
                    onClick={(e) => {
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
