import type { Metadata } from "next";
import { AppProviders } from "@/components/providers";
import { MapHost } from "@/components/map/map-host";
import { AppShell } from "@/components/shell/app-shell";
import "@/styles.css";

export const metadata: Metadata = {
  title: "Voltia",
  description: "Planificación energética de viajes en vehículo eléctrico: autonomía, elevación y recargas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("voltia-theme");var dark=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",dark);r.classList.toggle("light",!dark);r.style.colorScheme=dark?"dark":"light";}catch(e){}})();`,
          }}
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://api.mapbox.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700&display=swap"
        />
        <meta name="theme-color" content="#0c0f12" />
      </head>
      <body className="h-full bg-bg text-fg">
        <AppProviders>
          <MapHost />
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
