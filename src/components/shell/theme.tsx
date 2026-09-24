"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

import type { ColorScheme } from "@/lib/map-colors";

export type { ColorScheme };

const STORAGE_KEY = "voltia-theme";

function currentScheme(): ColorScheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, currentScheme, () => "dark");
}

export function applyColorScheme(scheme: ColorScheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", scheme === "dark");
  root.classList.toggle("light", scheme === "light");
  root.style.colorScheme = scheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", scheme === "dark" ? "#0c0f12" : "#f4f6f8");
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* private mode */
  }
}

export function ThemeToggle() {
  const scheme = useColorScheme();
  const next = scheme === "dark" ? "light" : "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={scheme === "dark" ? "Usar tema claro" : "Usar tema oscuro"}
      onClick={() => applyColorScheme(next)}
    >
      {scheme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}
