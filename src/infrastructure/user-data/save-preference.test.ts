import { describe, expect, it } from "vitest";
import { SUMMARY, makeRequest } from "@/domain/user/test-fixtures";
import {
  PENDING_SAVE_KEY,
  PENDING_SAVE_TTL_MS,
  SAVE_CHOICE_DAYS,
  SAVE_CHOICE_KEY,
  claimPendingSave,
  clearGuestSaveChoice,
  clearPendingSave,
  hasGuestSaveChoice,
  isPendingSaveDone,
  markPendingSaveDone,
  readPendingSave,
  rememberGuestSaveChoice,
  restorePendingSave,
  writePendingSave,
} from "./save-preference";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    storage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  };
}

const broken = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const T0 = new Date("2026-09-23T12:00:00Z");
const DAY = 86_400_000;
const CLIENT = "00000000-0000-4000-8000-000000000010";
const OTHER = "00000000-0000-4000-8000-000000000011";

describe("elección 'guardar sin iniciar sesión'", () => {
  it("se recuerda durante 180 días y luego caduca (y se limpia)", () => {
    const { storage, data } = memory();
    expect(hasGuestSaveChoice(T0, storage)).toBe(false);
    rememberGuestSaveChoice(T0, storage);
    expect(hasGuestSaveChoice(new Date(T0.getTime() + (SAVE_CHOICE_DAYS - 1) * DAY), storage)).toBe(
      true,
    );
    expect(hasGuestSaveChoice(new Date(T0.getTime() + SAVE_CHOICE_DAYS * DAY), storage)).toBe(
      false,
    );
    expect(data.has(SAVE_CHOICE_KEY)).toBe(false);
  });

  it("un valor corrupto cuenta como sin elección", () => {
    const { storage, data } = memory();
    data.set(SAVE_CHOICE_KEY, "{no json");
    expect(hasGuestSaveChoice(T0, storage)).toBe(false);
  });

  it("se puede borrar", () => {
    const { storage } = memory();
    rememberGuestSaveChoice(T0, storage);
    clearGuestSaveChoice(storage);
    expect(hasGuestSaveChoice(T0, storage)).toBe(false);
  });

  it("un navegador sin almacenamiento no rompe (siempre pregunta)", () => {
    expect(() => rememberGuestSaveChoice(T0, broken)).not.toThrow();
    expect(hasGuestSaveChoice(T0, broken)).toBe(false);
  });
});

describe("guardado pendiente de iniciar sesión", () => {
  const trip = { clientId: CLIENT, request: makeRequest(), summary: SUMMARY };

  it("se escribe, se lee y se reclama una sola vez", () => {
    const { storage } = memory();
    expect(writePendingSave(trip, T0, storage)).toBe(true);
    expect(readPendingSave(T0, storage)?.clientId).toBe(CLIENT);
    expect(claimPendingSave(T0, storage)?.clientId).toBe(CLIENT);
    expect(claimPendingSave(T0, storage)).toBeNull();
  });

  it("caduca a las 24 horas", () => {
    const { storage, data } = memory();
    writePendingSave(trip, T0, storage);
    expect(readPendingSave(new Date(T0.getTime() + PENDING_SAVE_TTL_MS), storage)).toBeNull();
    expect(data.has(PENDING_SAVE_KEY)).toBe(false);
  });

  it("rechaza datos inválidos", () => {
    const { storage, data } = memory();
    data.set(PENDING_SAVE_KEY, JSON.stringify({ clientId: "x", createdAt: T0.toISOString() }));
    expect(readPendingSave(T0, storage)).toBeNull();
  });

  it("restaurar tras un fallo conserva la fecha original", () => {
    const { storage } = memory();
    writePendingSave(trip, T0, storage);
    const claimed = claimPendingSave(T0, storage)!;
    restorePendingSave(claimed, storage);
    expect(readPendingSave(T0, storage)?.createdAt).toBe(T0.toISOString());
  });

  it("Cancelar con clientId solo borra su propio pendiente", () => {
    const { storage } = memory();
    writePendingSave(trip, T0, storage);
    clearPendingSave(OTHER, storage);
    expect(readPendingSave(T0, storage)).not.toBeNull();
    clearPendingSave(CLIENT, storage);
    expect(readPendingSave(T0, storage)).toBeNull();
  });

  it("marca de completado compartida entre pestañas", () => {
    const { storage } = memory();
    expect(isPendingSaveDone(CLIENT, storage)).toBe(false);
    markPendingSaveDone(CLIENT, storage);
    expect(isPendingSaveDone(CLIENT, storage)).toBe(true);
    expect(isPendingSaveDone(OTHER, storage)).toBe(false);
  });

  it("sin almacenamiento, writePendingSave avisa con false", () => {
    expect(writePendingSave(trip, T0, broken)).toBe(false);
    expect(readPendingSave(T0, broken)).toBeNull();
  });
});
