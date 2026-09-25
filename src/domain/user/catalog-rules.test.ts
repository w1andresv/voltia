import { describe, expect, it } from "vitest";
import {
  differsFromCatalog,
  extractOwnVehicles,
  isCatalogEdit,
  mergeVehicles,
} from "./catalog-rules";
import { makeVehicle } from "./test-fixtures";

const catalog = [
  makeVehicle({ id: "cat-1", brand: "MG", model: "S5" }),
  makeVehicle({ id: "cat-2", brand: "BYD", model: "Dolphin" }),
];

describe("mergeVehicles", () => {
  it("sin vehículos propios devuelve el catálogo", () => {
    expect(mergeVehicles(catalog, undefined)).toEqual(catalog);
  });

  it("una edición con el id del catálogo reemplaza al modelo y conserva su id", () => {
    const edited = makeVehicle({ id: "cat-1", brand: "MG", model: "S5", batteryKwh: 70 });
    const merged = mergeVehicles(catalog, [edited]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.batteryKwh).toBe(70);
    expect(merged[0]!.id).toBe("cat-1");
  });

  it("consumo de fábrica si la edición no lo fijó a mano; el manual se respeta", () => {
    const auto = mergeVehicles(catalog, [
      makeVehicle({ id: "cat-1", consumptionKwhPer100km: 99, consumptionManual: false }),
    ]);
    expect(auto[0]!.consumptionKwhPer100km).toBeNull();
    const manual = mergeVehicles(catalog, [
      makeVehicle({ id: "cat-1", consumptionKwhPer100km: 17, consumptionManual: true }),
    ]);
    expect(manual[0]!.consumptionKwhPer100km).toBe(17);
  });

  it("agrega los personalizados al final, sin repetir ids", () => {
    const custom = makeVehicle({ id: "custom-9", isCustom: true });
    const merged = mergeVehicles(catalog, [custom, custom]);
    expect(merged.map((v) => v.id)).toEqual(["cat-1", "cat-2", "custom-9"]);
  });
});

describe("differsFromCatalog / extractOwnVehicles", () => {
  it("un vehículo idéntico al de catálogo no difiere", () => {
    expect(differsFromCatalog(catalog[0]!, catalog)).toBe(false);
  });

  it("un cambio de ficha o de conectores sí", () => {
    expect(differsFromCatalog({ ...catalog[0]!, rangeKm: 999 }, catalog)).toBe(true);
    expect(differsFromCatalog({ ...catalog[0]!, connectors: ["chademo"] }, catalog)).toBe(true);
  });

  it("un id fuera del catálogo es personalizado", () => {
    expect(differsFromCatalog(makeVehicle({ id: "custom-1" }), catalog)).toBe(true);
  });

  it("extractOwnVehicles descarta el catálogo sin cambios y conserva ediciones y personalizados", () => {
    const edited = { ...catalog[1]!, dcMaxKw: 200 };
    const custom = makeVehicle({ id: "custom-1" });
    expect(extractOwnVehicles([catalog[0]!, edited, custom], catalog)).toEqual([edited, custom]);
  });

  it("isCatalogEdit", () => {
    expect(isCatalogEdit(makeVehicle({ id: "cat-2" }), catalog)).toBe(true);
    expect(isCatalogEdit(makeVehicle({ id: "x" }), catalog)).toBe(false);
  });
});
