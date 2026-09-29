import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throttle } from "./throttle";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
afterEach(() => vi.useRealTimers());

describe("throttle", () => {
  it("la primera llamada corre enseguida", () => {
    const fn = vi.fn();
    throttle(fn, 150).run();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("mientras se arrastra, a lo sumo una vez por plazo y la última siempre corre", () => {
    const fn = vi.fn();
    const t = throttle(fn, 150);
    for (let i = 0; i < 10; i++) {
      t.run();
      vi.advanceTimersByTime(20);
    }
    // 200 ms: la inmediata y la de los 150 ms.
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("cancel descarta la pendiente", () => {
    const fn = vi.fn();
    const t = throttle(fn, 150);
    t.run();
    t.run();
    t.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
