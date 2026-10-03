import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/infrastructure/db", () => ({ getSql: async () => ({ query }) }));

import { VEHICLE_CATALOG } from "@/domain/vehicles";
import { loadCatalog, loadCatalogFromDb } from "./catalog-store";

const base = VEHICLE_CATALOG[0]!;
const row = (over: Record<string, unknown> = {}) => ({ payload: { ...base, ...over } });

beforeEach(() => {
  query.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("loadCatalogFromDb", () => {
  it("lee todas las filas, sin filtrar por owner_id", async () => {
    query.mockResolvedValueOnce([row()]);
    await loadCatalogFromDb();
    const sql = String(query.mock.calls[0]![0]);
    expect(sql).not.toMatch(/where\s+owner_id/i);
    expect(sql).toMatch(/from public\.voltia_vehicles/i);
  });

  it("devuelve los vehículos de todos los dueños", async () => {
    query.mockResolvedValueOnce([
      row({ id: "catalogo" }),
      row({ id: "de-un-usuario", model: "Propio", isCustom: true }),
    ]);
    const list = await loadCatalogFromDb();
    expect(list.map((v) => v.id)).toEqual(["catalogo", "de-un-usuario"]);
  });

  it("con el mismo id de vehículo conserva solo la primera fila (la del catálogo va antes)", async () => {
    query.mockResolvedValueOnce([
      row({ id: "mg", version: "catálogo" }),
      row({ id: "mg", version: "edición de un usuario" }),
    ]);
    const list = await loadCatalogFromDb();
    expect(list).toHaveLength(1);
    expect(list[0]!.version).toBe("catálogo");
  });

  it("omite las filas que no cumplen el esquema y conserva el resto", async () => {
    query.mockResolvedValueOnce([row({ id: "ok" }), { payload: { id: "roto" } }]);
    const list = await loadCatalogFromDb();
    expect(list.map((v) => v.id)).toEqual(["ok"]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("sin filas válidas lanza, para que el fallo no se cachee como catálogo", async () => {
    query.mockResolvedValueOnce([]);
    await expect(loadCatalogFromDb()).rejects.toThrow(/vacío/);
  });
});

describe("loadCatalog", () => {
  it("si la base falla, usa el respaldo en código", async () => {
    query.mockRejectedValueOnce(new Error("sin conexión"));
    expect(await loadCatalog()).toEqual(VEHICLE_CATALOG);
  });
});
