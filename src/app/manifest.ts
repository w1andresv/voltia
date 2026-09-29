import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/components/brand/brand";

/**
 * Manifest de la PWA: se puede instalar en el celular y abre el planificador.
 * Íconos en public/icons (npm run icons los regenera desde favicon.svg).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/planificar",
    name: `${BRAND_NAME} · Rutas para vehículos eléctricos`,
    short_name: BRAND_NAME,
    description:
      "Planificación energética de viajes en vehículo eléctrico: autonomía, elevación y recargas.",
    lang: "es-CO",
    start_url: "/planificar",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0f12",
    theme_color: "#0c0f12",
    categories: ["navigation", "travel", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
