import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "./deadline";

afterEach(() => vi.useRealTimers());

describe("withDeadline", () => {
  it("devuelve el resultado si llega a tiempo", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000, () => -1)).resolves.toBe(7);
  });

  it("devuelve el valor de respaldo si se pasa del plazo", async () => {
    vi.useFakeTimers();
    const pending = withDeadline(new Promise<number>(() => {}), 50, () => -1);
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toBe(-1);
  });

  it("propaga el error de la tarea si ocurre antes del plazo", async () => {
    await expect(withDeadline(Promise.reject(new Error("falló")), 1000, () => 0)).rejects.toThrow(
      "falló",
    );
  });

  it("un rechazo posterior al plazo no queda sin atender", async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const task = new Promise<number>((_, reject) => (fail = reject));
    const out = withDeadline(task, 10, () => 5);
    await vi.advanceTimersByTimeAsync(20);
    await expect(out).resolves.toBe(5);
    fail(new Error("tarde"));
    await vi.advanceTimersByTimeAsync(1);
  });
});
