import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Marca EV-on-way: el pin con el rayo del logo (public/brand/ev-on-way-logo.png)
 * y el nombre. El logo completo tiene fondo blanco y texto azul marino; en la
 * app se usan estas piezas para que se lean en tema claro y oscuro.
 * Colores del logo: verde #4AD152, azul petróleo #0287A7, azul marino #062E55.
 */
export const BRAND_NAME = "EV-on-way";

export function BrandMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#4AD152" />
          <stop offset="1" stopColor="#0287A7" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M32 62C32 62 10 39 10 25a22 22 0 0 1 44 0c0 14-22 37-22 37Z" />
      <circle cx="32" cy="25" r="13.5" fill="#FFFFFF" />
      <path fill="#1BC46A" d="M34.5 13.5 24.5 27h6.5l-2.5 10.5L39.5 23H33Z" />
    </svg>
  );
}

/** "EV" con el degradado del logo y "-on-way" en el color del texto del tema. */
export function BrandName({ className }: { className?: string }) {
  return (
    <span className={cn("whitespace-nowrap font-extrabold italic tracking-tight", className)}>
      <span className="bg-gradient-to-br from-[#4AD152] to-[#0287A7] bg-clip-text pr-[0.06em] text-transparent">
        EV
      </span>
      <span className="text-fg">-on-way</span>
    </span>
  );
}
