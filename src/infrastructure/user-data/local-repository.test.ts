import { describe, expect, it } from "vitest";
import { createGuestStorage, type StorageLike } from "./guest-storage";
import { createLocalRepository } from "./local-repository";
import { SUMMARY, makeRequest, makeVehicle } from "@/domain/user/test-fixtures";

function repo() {
  const data = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
  return createLocalRepository(createGuestStorage({ storage }));
}
const id = "00000000-0000-4000-8000-000000000001";

describe("LocalUserDataRepository", () => {
  it("guarda, lista y borra vehículos", async () => {
    const r = repo();
    await r.saveVehicle(makeVehicle({ id: "a" }));
    expect((await r.listVehicles()).map((v) => v.id)).toEqual(["a"]);
    await r.deleteVehicle("a");
    expect(await r.listVehicles()).toEqual([]);
  });

  it("guarda rutas como no compartidas, con id = clientId, y las lista más recientes primero", async () => {
    const r = repo();
    const saved = await r.saveTrip({ clientId: id, request: makeRequest(), summary: SUMMARY });
    expect(saved).toMatchObject({ id, shared: false, shareId: null });
    await r.saveTrip({
      clientId: "00000000-0000-4000-8000-000000000002",
      request: makeRequest(),
      summary: SUMMARY,
    });
    expect((await r.listTrips()).map((t) => t.id)).toEqual([
      "00000000-0000-4000-8000-000000000002",
      id,
    ]);
    await r.deleteTrip(id);
    expect(await r.listTrips()).toHaveLength(1);
  });
});
