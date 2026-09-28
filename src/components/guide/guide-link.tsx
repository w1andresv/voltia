"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActor } from "@/infrastructure/auth/use-actor";
import { canSeeGuides } from "@/lib/guide-access";

/**
 * Enlace a una guía "Cómo funciona", visible solo para la cuenta que puede
 * abrirlas. Es solo la UI: la página vuelve a comprobarlo en el servidor.
 */
export function GuideLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const actor = useActor();
  if (!canSeeGuides(actor.email)) return null;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
