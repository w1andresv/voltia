"use server";

/**
 * ¿El servidor tiene PLUGSHARE_TOKEN? El navegador ya no maneja ninguna
 * credencial de PlugShare: solo pregunta si hay red que mostrar.
 */
export async function getPlugshareStatusFn(): Promise<{ enabled: boolean }> {
  const { isPlugshareToken } = await import("@/lib/plugshare");
  return { enabled: isPlugshareToken(process.env.PLUGSHARE_TOKEN ?? "") };
}
