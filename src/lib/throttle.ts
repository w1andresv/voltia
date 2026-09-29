/**
 * Llama a `fn` enseguida si no se llamó en los últimos `ms`; si no, una sola vez
 * al cumplirse el plazo (la última llamada siempre corre). Sirve para recalcular
 * mientras se arrastra un control: responde al primer cambio y luego a lo sumo
 * cada `ms`. `cancel` descarta la llamada pendiente.
 */
export function throttle(fn: () => void, ms: number): { run: () => void; cancel: () => void } {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    last = Date.now();
    fn();
  };
  return {
    run: () => {
      if (timer) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
