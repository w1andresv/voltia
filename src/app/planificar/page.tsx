import { redirect } from "next/navigation";

// src/app/page.tsx ya renderiza <PlannerApp /> en "/" — esta ruta existía
// duplicada (mismo contenido en dos URLs). En vez de borrarla —el drawer y
// varias pantallas (Mis viajes, viaje compartido) navegan aquí como "volver
// al planificador"— redirige a la home real para no partir esos enlaces.
export default function PlanPage(): never {
  redirect("/");
}
