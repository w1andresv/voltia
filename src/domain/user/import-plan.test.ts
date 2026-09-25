import { describe, expect, it } from "vitest";
import { planImport, type GuestTripInput } from "./import-plan";
import { SUMMARY, makeRequest, makeVehicle } from "./test-fixtures";

const catalog = [makeVehicle({ id: "cat-1", brand: "MG", model: "S5", isCustom: undefined })];
const emptyAccount = { vehicles: [], trips: [] };

const trip = (clientId: string, request = makeRequest()): GuestTripInput => ({
  clientId,
  request,
  summary: SUMMARY,
});

describe("planImport — vehículos", () => {
  it("1. catálogo sin cambios: no se sube", () => {
    const plan = planImport({
      guestVehicles: [catalog[0]!],
      guestTrips: [],
      account: emptyAccount,
      catalog,
    });
    expect(plan.vehicles).toEqual([
      { localId: "cat-1", action: "skip", reason: "catalog-unchanged" },
    ]);
  });

  it("2. edición de catálogo y la cuenta no tiene: se guarda como edición", () => {
    const edited = { ...catalog[0]!, rangeKm: 999 };
    const plan = planImport({
      guestVehicles: [edited],
      guestTrips: [],
      account: emptyAccount,
      catalog,
    });
    expect(plan.vehicles).toEqual([{ localId: "cat-1", action: "insert", payload: edited }]);
  });

  it("3. edición de catálogo y la cuenta ya tiene una: gana la cuenta y se informa", () => {
    const edited = { ...catalog[0]!, rangeKm: 999 };
    const accountEdit = { ...catalog[0]!, rangeKm: 500 };
    const plan = planImport({
      guestVehicles: [edited],
      guestTrips: [],
      account: { vehicles: [accountEdit], trips: [] },
      catalog,
    });
    expect(plan.vehicles).toEqual([
      { localId: "cat-1", action: "skip", reason: "account-has-edit" },
    ]);
    expect(plan.discardedEdits).toEqual(["cat-1"]);
  });

  it("4. personalizado equivalente en la cuenta: no se duplica y se mapea su id", () => {
    const local = makeVehicle({ id: "custom-local" });
    const remote = makeVehicle({ id: "custom-remote" });
    const plan = planImport({
      guestVehicles: [local],
      guestTrips: [],
      account: { vehicles: [remote], trips: [] },
      catalog,
    });
    expect(plan.vehicles).toEqual([
      { localId: "custom-local", action: "skip", reason: "equivalent-in-account" },
    ]);
    expect(plan.idMap).toEqual({ "custom-local": "custom-remote" });
  });

  it("5. personalizado sin equivalente: se inserta con su id", () => {
    const local = makeVehicle({ id: "custom-local", model: "Nuevo" });
    const plan = planImport({
      guestVehicles: [local],
      guestTrips: [],
      account: emptyAccount,
      catalog,
    });
    expect(plan.vehicles).toEqual([{ localId: "custom-local", action: "insert", payload: local }]);
    expect(plan.idMap).toEqual({});
  });

  it("6. personalizado cuyo id choca con otro distinto: recibe un id nuevo", () => {
    const local = makeVehicle({ id: "custom-1", model: "Local" });
    const remote = makeVehicle({ id: "custom-1", model: "Remoto" });
    const plan = planImport({
      guestVehicles: [local],
      guestTrips: [],
      account: { vehicles: [remote], trips: [] },
      catalog,
    });
    const outcome = plan.vehicles[0]!;
    expect(outcome.action).toBe("insert");
    if (outcome.action === "insert") {
      expect(outcome.payload.id).not.toBe("custom-1");
      expect(plan.idMap["custom-1"]).toBe(outcome.payload.id);
    }
  });
});

describe("planImport — rutas", () => {
  it("7. mismo clientId ya importado: se omite (reintento seguro)", () => {
    const req = makeRequest();
    const plan = planImport({
      guestVehicles: [],
      guestTrips: [trip("c1", req)],
      account: {
        vehicles: [],
        trips: [
          { clientId: "c1", request: makeRequest({ origin: { label: "otro", lat: 1, lon: 1 } }) },
        ],
      },
      catalog,
    });
    expect(plan.trips).toEqual([{ clientId: "c1", action: "skip", reason: "already-imported" }]);
  });

  it("8. misma huella que una ruta de la cuenta: se omite como duplicada", () => {
    const plan = planImport({
      guestVehicles: [],
      guestTrips: [trip("c1")],
      account: { vehicles: [], trips: [{ clientId: null, request: makeRequest() }] },
      catalog,
    });
    expect(plan.trips).toEqual([{ clientId: "c1", action: "skip", reason: "duplicate" }]);
  });

  it("9. ruta nueva: se inserta con el vehículo embebido ya remapeado", () => {
    const local = makeVehicle({ id: "custom-1", model: "Local" });
    const remote = makeVehicle({ id: "custom-1", model: "Remoto" });
    const req = makeRequest({ vehicle: local });
    const plan = planImport({
      guestVehicles: [local],
      guestTrips: [trip("c1", req)],
      account: { vehicles: [remote], trips: [] },
      catalog,
    });
    const t = plan.trips[0]!;
    expect(t.action).toBe("insert");
    if (t.action === "insert") expect(t.payload.request.vehicle.id).toBe(plan.idMap["custom-1"]);
  });

  it("dos rutas iguales del invitado en la misma importación: solo entra una", () => {
    const plan = planImport({
      guestVehicles: [],
      guestTrips: [trip("c1"), trip("c2")],
      account: emptyAccount,
      catalog,
    });
    expect(plan.trips.map((t) => t.action)).toEqual(["insert", "skip"]);
  });
});
