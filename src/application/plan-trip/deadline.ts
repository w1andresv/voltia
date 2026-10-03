/**
 * Plazo para una tarea que no se puede cancelar (las consultas a proveedores siguen su
 * curso y su resultado se descarta): si `promise` no termina en `ms`, se devuelve
 * `onTimeout()`. Un error de la tarea se propaga igual que sin plazo.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    const first = await Promise.race([promise, expired]);
    return first === "timeout" ? onTimeout() : first;
  } finally {
    clearTimeout(timer);
    // Si la tarea sigue y falla después del plazo, que no sea un rechazo sin atender.
    promise.catch(() => undefined);
  }
}
