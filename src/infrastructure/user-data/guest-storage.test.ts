import { describe, expect, it, vi } from "vitest";
import {
  GUEST_CORRUPT_KEY,
  GUEST_KEY,
  GuestLimitError,
  MAX_GUEST_TRIPS,
  MAX_GUEST_VEHICLES,
  createGuestStorage,
  type StorageLike,
} from "./guest-storage";
import { SUMMARY, makeRequest, makeVehicle } from "@/domain/user/test-fixtures";

function fakeStorage(
  initial: Record<string, string> = {},
  opts: { failWrites?: "quota" | "other" } = {},
) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.failWrites) {
        const e = new Error("full");
        e.name = opts.failWrites === "quota" ? "QuotaExceededError" : "SecurityError";
        throw e;
      }
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
  return { storage, data };
}

const T0 = new Date("2026-09-23T12:00:00Z");
const daysAfter = (d: number) => new Date(T0.getTime() + d * 86_400_000);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("createGuestStorage", () => {
  it("crea un invitado nuevo en la primera visita y lo persiste", () => {
    const { storage, data } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    const d = g.load();
    expect(d.guestId).toBeTruthy();
    expect(d.vehicles).toEqual([]);
    expect(JSON.parse(data.get(GUEST_KEY)!).guestId).toBe(d.guestId);
  });

  it("recarga lo guardado con el mismo guestId", () => {
    const { storage } = fakeStorage();
    const a = createGuestStorage({ storage, now: () => T0 });
    const id = a.load().guestId;
    a.addVehicle(makeVehicle());
    const b = createGuestStorage({ storage, now: () => T0 });
    expect(b.load().guestId).toBe(id);
    expect(b.load().vehicles).toHaveLength(1);
  });

  it("expira a los 180 días y crea un invitado nuevo", () => {
    const { storage } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    const first = g.load();
    g.addVehicle(makeVehicle());
    const later = createGuestStorage({ storage, now: () => daysAfter(181) });
    const d = later.load();
    expect(d.guestId).not.toBe(first.guestId);
    expect(d.vehicles).toEqual([]);
  });

  it("antes de los 180 días conserva los datos", () => {
    const { storage } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    g.addVehicle(makeVehicle());
    const later = createGuestStorage({ storage, now: () => daysAfter(179) });
    expect(later.load().vehicles).toHaveLength(1);
  });

  it("lastActiveAt se actualiza como mucho una vez al día", () => {
    const { storage, data } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    g.load();
    const stamp = JSON.parse(data.get(GUEST_KEY)!).lastActiveAt;
    createGuestStorage({ storage, now: () => new Date(T0.getTime() + 3_600_000) }).load();
    expect(JSON.parse(data.get(GUEST_KEY)!).lastActiveAt).toBe(stamp);
    createGuestStorage({ storage, now: () => daysAfter(2) }).load();
    expect(JSON.parse(data.get(GUEST_KEY)!).lastActiveAt).not.toBe(stamp);
  });

  it("datos corruptos se guardan en voltia-guest-corrupt y se empieza limpio", () => {
    const { storage, data } = fakeStorage({ [GUEST_KEY]: "{no es json" });
    const d = createGuestStorage({ storage, now: () => T0 }).load();
    expect(d.vehicles).toEqual([]);
    expect(data.get(GUEST_CORRUPT_KEY)).toBe("{no es json");
  });

  it("una versión desconocida cuenta como corrupta", () => {
    const raw = JSON.stringify({ v: 99, guestId: "x", vehicles: [], trips: [] });
    const { storage, data } = fakeStorage({ [GUEST_KEY]: raw });
    createGuestStorage({ storage, now: () => T0 }).load();
    expect(data.get(GUEST_CORRUPT_KEY)).toBe(raw);
  });

  it("QuotaExceededError: sigue en memoria y avisa una sola vez", () => {
    const { storage } = fakeStorage({}, { failWrites: "quota" });
    const onWriteFailed = vi.fn();
    const g = createGuestStorage({ storage, now: () => T0, onWriteFailed });
    g.addVehicle(makeVehicle({ id: "a" }));
    g.addVehicle(makeVehicle({ id: "b" }));
    expect(onWriteFailed).toHaveBeenCalledTimes(1);
    expect(onWriteFailed).toHaveBeenCalledWith("quota");
    expect(g.load().vehicles.map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("sin localStorage (modo privado / SSR) funciona en memoria", () => {
    const onWriteFailed = vi.fn();
    const g = createGuestStorage({ storage: null, now: () => T0, onWriteFailed });
    g.addVehicle(makeVehicle());
    expect(g.load().vehicles).toHaveLength(1);
    expect(onWriteFailed).toHaveBeenCalledWith("unavailable");
  });

  it("límite de vehículos: rechaza el 21 sin borrar nada, pero permite editar uno existente", () => {
    const { storage } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    for (let i = 0; i < MAX_GUEST_VEHICLES; i++) g.addVehicle(makeVehicle({ id: `v${i}` }));
    expect(() => g.addVehicle(makeVehicle({ id: "extra" }))).toThrow(GuestLimitError);
    expect(g.load().vehicles).toHaveLength(MAX_GUEST_VEHICLES);
    g.addVehicle(makeVehicle({ id: "v0", model: "editado" }));
    expect(g.load().vehicles[0]!.model).toBe("editado");
  });

  it("límite de rutas: rechaza la 51 sin borrar nada", () => {
    const { storage } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    for (let i = 0; i < MAX_GUEST_TRIPS; i++)
      g.addTrip({ clientId: uuid(i), request: makeRequest(), summary: SUMMARY });
    expect(() =>
      g.addTrip({ clientId: uuid(999), request: makeRequest(), summary: SUMMARY }),
    ).toThrow(GuestLimitError);
    expect(g.load().trips).toHaveLength(MAX_GUEST_TRIPS);
  });

  it("addTrip es idempotente por clientId", () => {
    const { storage } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    g.addTrip({ clientId: uuid(1), request: makeRequest(), summary: SUMMARY });
    g.addTrip({ clientId: uuid(1), request: makeRequest(), summary: SUMMARY });
    expect(g.load().trips).toHaveLength(1);
  });

  it("clear borra voltia-guest; el siguiente load crea un invitado nuevo", () => {
    const { storage, data } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    const id = g.load().guestId;
    g.addVehicle(makeVehicle());
    g.clear();
    expect(data.has(GUEST_KEY)).toBe(false);
    const d = g.load();
    expect(d.guestId).not.toBe(id);
    expect(d.vehicles).toEqual([]);
  });

  it("removeVehicle y removeTrip", () => {
    const { storage } = fakeStorage();
    const g = createGuestStorage({ storage, now: () => T0 });
    g.addVehicle(makeVehicle({ id: "a" }));
    g.addTrip({ clientId: uuid(1), request: makeRequest(), summary: SUMMARY });
    g.removeVehicle("a");
    g.removeTrip(uuid(1));
    expect(g.load().vehicles).toEqual([]);
    expect(g.load().trips).toEqual([]);
  });
});
