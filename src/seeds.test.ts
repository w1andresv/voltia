import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VehicleSchema } from "@/domain/schemas";
import { DEFAULT_VEHICLE_ID, VEHICLE_CATALOG } from "@/domain/vehicles";

const sql = readFileSync(new URL("../seeds/0001_vehicle_catalog.sql", import.meta.url), "utf8");

const rows = [...sql.matchAll(/values \('([^']+)', null, '((?:[^']|'')*)'::jsonb\)/g)].map((m) => ({
  id: m[1]!,
  payload: JSON.parse(m[2]!.replace(/''/g, "'")) as unknown,
}));

describe("seeds/0001_vehicle_catalog.sql", () => {
  it("tiene filas de catálogo y cada una valida con VehicleSchema", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const parsed = VehicleSchema.safeParse(r.payload);
      expect(parsed.success, `payload de ${r.id}`).toBe(true);
    }
  });

  it("el id de la fila coincide con payload.id", () => {
    for (const r of rows) expect((r.payload as { id: string }).id).toBe(r.id);
  });

  it("ids únicos y combinaciones marca-modelo-versión-año únicas (índice único del catálogo)", () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = rows.map((r) => {
      const v = r.payload as { brand: string; model: string; version: string; year: number };
      return [v.brand, v.model, v.version, v.year].map((x) => String(x).toLowerCase()).join("|");
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cada fila hace upsert por id sin pisar vehículos de usuario", () => {
    const inserts = sql.match(/^insert into public\.voltia_vehicles as v /gm) ?? [];
    expect(inserts).toHaveLength(rows.length);
    expect((sql.match(/on conflict \(id\) do update/g) ?? []).length).toBe(rows.length);
    expect((sql.match(/where v\.owner_id is null;/g) ?? []).length).toBe(
      rows.length,
    );
  });

  it("el respaldo en código coincide con su fila del seed", () => {
    for (const v of VEHICLE_CATALOG) {
      const row = rows.find((r) => r.id === v.id);
      expect(row, v.id).toBeDefined();
      expect(row!.payload).toEqual(v);
    }
  });

  it("el vehículo por defecto existe en el seed", () => {
    expect(rows.some((r) => r.id === DEFAULT_VEHICLE_ID)).toBe(true);
  });

  it("cada fila cita al menos una fuente con URL y la fecha de consulta", () => {
    const blocks = sql.split(/^-- (?=[A-Z][^\n]* - consultado)/m).slice(1);
    expect(blocks).toHaveLength(rows.length);
    for (const block of blocks) {
      expect(block).toMatch(/consultado \d{4}-\d{2}-\d{2}/);
      expect(block).toMatch(/--\s+fuente \[(CO|INT|EE\.UU\.)\] https?:\/\//);
    }
  });
});
