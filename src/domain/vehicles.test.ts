import { describe, expect, it } from "vitest";
import type { Vehicle } from "./types";
import { VEHICLE_CATALOG, vehicleMatches } from "./vehicles";

const mg = VEHICLE_CATALOG[0]!;
const tesla: Vehicle = {
  ...mg,
  id: "t",
  brand: "Tesla",
  model: "Model Y",
  version: "Long Range AWD",
  year: 2026,
};
const volvo: Vehicle = {
  ...mg,
  id: "v",
  brand: "Volvo",
  model: "EX30",
  version: "Single Motor Extended Range",
};

describe("vehicleMatches", () => {
  it("una búsqueda vacía o con espacios coincide con todos", () => {
    expect(vehicleMatches(mg, "")).toBe(true);
    expect(vehicleMatches(mg, "   ")).toBe(true);
  });

  it("busca en marca, modelo, versión y año, sin importar mayúsculas", () => {
    expect(vehicleMatches(tesla, "TESLA")).toBe(true);
    expect(vehicleMatches(tesla, "model y")).toBe(true);
    expect(vehicleMatches(tesla, "awd")).toBe(true);
    expect(vehicleMatches(tesla, "2026")).toBe(true);
    expect(vehicleMatches(volvo, "tesla")).toBe(false);
  });

  it("cada palabra tiene que aparecer, en cualquier orden", () => {
    expect(vehicleMatches(tesla, "long tesla")).toBe(true);
    expect(vehicleMatches(tesla, "tesla ex30")).toBe(false);
  });

  it("ignora las tildes de la búsqueda y del vehículo", () => {
    const custom: Vehicle = {
      ...mg,
      brand: "Renault",
      model: "Mégane E-Tech",
      version: "Eléctrico",
    };
    expect(vehicleMatches(custom, "megane electrico")).toBe(true);
    expect(vehicleMatches(volvo, "éxtended")).toBe(true);
  });
});
