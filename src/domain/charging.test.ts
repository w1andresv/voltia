import { describe, expect, it } from "vitest";
import {
  adapterRequirement,
  chargeCurveSeries,
  chargeTimeMinutes,
  DEFAULT_CURVE,
  effectiveChargeKw,
  isDc,
  isDcSocket,
  routePlugs,
  routeSocket,
  lerpFactor,
  powerKwAtSoc,
  socketCurrent,
  usableAdapters,
} from "./charging";
import type { Charger, ChargerSocket, Vehicle } from "./types";

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    brand: "Test",
    model: "EV",
    year: 2024,
    version: "base",
    batteryKwh: 60,
    rangeKm: 400,
    consumptionKwhPer100km: null,
    weightKg: 1800,
    motorKw: 150,
    acMaxKw: 11,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    ...overrides,
  };
}

function charger(overrides: Partial<Charger> = {}): Charger {
  return {
    id: "c1",
    name: "Estación de prueba",
    lat: 4.6,
    lon: -74.08,
    sockets: [{ connector: "ccs2", powerKw: 150, count: 2 }],
    source: "osm",
    ...overrides,
  };
}

describe("isDc / socketCurrent", () => {
  it("CCS2/CCS1/CHAdeMO/NACS son DC y Tipo 2 es AC", () => {
    expect(isDc("ccs2")).toBe(true);
    expect(isDc("chademo")).toBe(true);
    expect(isDc("nacs")).toBe(true);
    expect(isDc("type2")).toBe(false);
    expect(socketCurrent({ connector: "type1", powerKw: 7, count: 1 })).toBe("AC");
  });

  it("GB/T existe en AC y DC: sin dato reportado no se asume ninguna (C4)", () => {
    expect(isDc("gb_t")).toBe(false);
    expect(socketCurrent({ connector: "gb_t", powerKw: 50, count: 1 })).toBeNull();
    expect(socketCurrent({ connector: "gb_t", powerKw: 50, count: 1, current: "DC", currentOrigin: "standard" })).toBeNull();
    expect(socketCurrent({ connector: "gb_t", powerKw: 50, count: 1, current: "DC", currentOrigin: "reported" })).toBe("DC");
    expect(socketCurrent({ connector: "gb_t", powerKw: 7, count: 1, current: "AC", currentOrigin: "reported" })).toBe("AC");
  });

  it("la corriente reportada de la toma manda sobre el estándar", () => {
    expect(isDcSocket({ connector: "type2", powerKw: 43, count: 1, current: "AC" })).toBe(false);
    expect(isDcSocket({ connector: "ccs2", powerKw: 150, count: 1 })).toBe(true);
  });
});

describe("lerpFactor", () => {
  it("usa la curva por defecto cuando la del vehículo está vacía", () => {
    expect(lerpFactor([], 15)).toBeCloseTo(1, 6);
  });

  it("da el primer punto para SOC por debajo del rango", () => {
    expect(lerpFactor(DEFAULT_CURVE, -10)).toBeCloseTo(DEFAULT_CURVE[0]!.powerFactor, 6);
  });

  it("da el último punto para SOC 100", () => {
    expect(lerpFactor(DEFAULT_CURVE, 100)).toBeCloseTo(DEFAULT_CURVE[DEFAULT_CURVE.length - 1]!.powerFactor, 6);
  });

  it("interpola linealmente entre dos puntos de la curva", () => {
    // Entre soc=15 (factor 1) y soc=40 (factor 1): a mitad de camino sigue en 1.
    expect(lerpFactor(DEFAULT_CURVE, 27.5)).toBeCloseTo(1, 6);
  });
});

describe("chargeTimeMinutes", () => {
  it("es 0 cuando el destino ya está alcanzado", () => {
    expect(chargeTimeMinutes(60, 50, 50.1, 120, 150, DEFAULT_CURVE)).toBe(0);
  });

  it("un cargador AC (limitado por acMaxKw en el caller) tarda más que uno DC potente", () => {
    const dcMinutes = chargeTimeMinutes(60, 10, 80, 120, 150, DEFAULT_CURVE);
    const acMinutes = chargeTimeMinutes(60, 10, 80, 120, 11, DEFAULT_CURVE);
    expect(acMinutes).toBeGreaterThan(dcMinutes);
  });

  it("un cargador más lento que la curva del auto entrega su potencia completa (C3)", () => {
    // MG S5: 47,1 kWh, 120 kW. De 20 a 80 % la curva no baja de 0,42 × 120 = 50,4 kW,
    // así que en un cargador de 50 kW todo el tramo va a 50 kW: 47,1 × 0,6 / 50 h.
    const minutes = chargeTimeMinutes(47.1, 20, 80, 120, 50, DEFAULT_CURVE, undefined, { withOverhead: false });
    expect(minutes).toBeCloseTo(((47.1 * 0.6) / 50) * 60, 6);
  });

  it("cada parada suma sus minutos fijos (estacionar, conectar, desconectar)", () => {
    const bare = chargeTimeMinutes(47.1, 20, 80, 120, 50, DEFAULT_CURVE, undefined, { withOverhead: false });
    expect(chargeTimeMinutes(47.1, 20, 80, 120, 50, DEFAULT_CURVE)).toBeCloseTo(bare + 5, 9);
  });

  it("con un cargador más potente que el auto manda la curva del auto", () => {
    const fast = chargeTimeMinutes(60, 10, 80, 120, 350, DEFAULT_CURVE);
    const exact = chargeTimeMinutes(60, 10, 80, 120, 120, DEFAULT_CURVE);
    expect(fast).toBeCloseTo(exact, 6);
  });

  it("cargar del 10 al 80% toma un tiempo positivo y finito", () => {
    const minutes = chargeTimeMinutes(60, 10, 80, 120, 150, DEFAULT_CURVE);
    expect(minutes).toBeGreaterThan(0);
    expect(Number.isFinite(minutes)).toBe(true);
  });
});

const GBT_DC = { connector: "gb_t", powerKw: 50, count: 1, current: "DC", currentOrigin: "reported" } as const;
const CARRIED = [
  { from: "gb_t", to: "ccs2" },
  { from: "ccs1", to: "ccs2" },
] as const;

describe("usableAdapters", () => {
  it("solo los que el usuario lleva, de la lista verificada y hacia un conector del vehículo", () => {
    const v = vehicle({
      connectors: ["ccs2"],
      adapters: [
        { from: "gb_t", to: "ccs2" },
        { from: "chademo", to: "ccs2" },
        { from: "ccs1", to: "nacs" },
      ],
    });
    expect(usableAdapters(v)).toEqual([{ from: "gb_t", to: "ccs2" }]);
    expect(usableAdapters(vehicle())).toEqual([]);
  });
});

describe("routePlugs", () => {
  it("sin adaptadores declarados, no propone GB/T ni CCS1 (C4)", () => {
    const c = charger({ sockets: [GBT_DC, { connector: "ccs1", powerKw: 40, count: 1 }] });
    expect(routePlugs(c, vehicle({ connectors: ["ccs2"] }))).toEqual([]);
  });

  it("con los adaptadores que el usuario lleva, ofrece GB/T y CCS1 hacia CCS2, y no inventa CHAdeMO", () => {
    const c = charger({
      sockets: [GBT_DC, { connector: "ccs1", powerKw: 40, count: 1 }, { connector: "chademo", powerKw: 50, count: 1 }],
    });
    const v = vehicle({ connectors: ["ccs2"], adapters: [...CARRIED] });
    const plugs = routePlugs(c, v);
    expect(plugs.map((p) => p.socket.connector)).toEqual(["gb_t", "ccs1"]);
    expect(plugs.map((p) => p.adapter)).toEqual([...CARRIED]);
    expect(routeSocket(c, v)?.socket.powerKw).toBe(50);
  });

  it("un GB/T sin corriente conocida no se usa con adaptador DC", () => {
    const c = charger({ sockets: [{ connector: "gb_t", powerKw: 50, count: 1 }] });
    expect(routePlugs(c, vehicle({ connectors: ["ccs2"], adapters: [...CARRIED] }))).toEqual([]);
  });

  it("el adaptador limita la potencia", () => {
    const c = charger({ sockets: [{ ...GBT_DC, powerKw: 120 }] });
    const plug = routeSocket(c, vehicle({ connectors: ["ccs2"], adapters: [{ from: "gb_t", to: "ccs2", maxPowerKw: 60 }] }));
    expect(plug?.powerKw).toBe(60);
    expect(plug?.limitedBy).toBe("adapter");
  });

  it("indica qué limita la potencia y si la potencia de la toma es asumida (C7)", () => {
    const reported = routeSocket(
      charger({ sockets: [{ connector: "ccs2", powerKw: 350, count: 1, powerOrigin: "reported" }] }),
      vehicle({ dcMaxKw: 120 }),
    );
    expect(reported).toMatchObject({ powerKw: 120, limitedBy: "vehicle", powerSource: "reported", dc: true });
    const assumed = routeSocket(charger({ sockets: [{ connector: "ccs2", powerKw: 50, count: 1 }] }), vehicle());
    expect(assumed).toMatchObject({ powerKw: 50, limitedBy: "station", powerSource: "assumed" });
  });

  it("suma el CCS2 directo, el adaptador y la mejor toma AC", () => {
    const c = charger({
      sockets: [
        { connector: "ccs2", powerKw: 150, count: 1 },
        GBT_DC,
        { connector: "type2", powerKw: 7, count: 1 },
        { connector: "type2", powerKw: 11, count: 1 },
      ],
    });
    const plugs = routePlugs(c, vehicle({ connectors: ["ccs2", "type2"], adapters: [...CARRIED] }));
    expect(plugs.map((p) => [p.socket.connector, p.adapter?.from ?? "direct", p.powerKw, p.dc])).toEqual([
      ["ccs2", "direct", 120, true],
      ["gb_t", "gb_t", 50, true],
      ["type2", "direct", 11, false],
    ]);
  });

  it("sin opción definida, la estación no sirve", () => {
    const c = charger({ sockets: [{ connector: "chademo", powerKw: 50, count: 1 }] });
    expect(routePlugs(c, vehicle({ connectors: ["ccs2"] }))).toEqual([]);
    expect(routeSocket(c, vehicle({ connectors: ["ccs2"] }))).toBeNull();
  });
});

describe("adapterRequirement", () => {
  const ccs2Car = (adapters: Vehicle["adapters"] = []) =>
    vehicle({ connectors: ["ccs2", "type2"], adapters });

  it("si algún conector de la estación es del vehículo, no requiere adaptador", () => {
    expect(
      adapterRequirement(
        charger({ sockets: [{ connector: "ccs2", powerKw: 60, count: 1 }, GBT_DC] }),
        ccs2Car(),
      ),
    ).toBeNull();
    expect(adapterRequirement(charger({ sockets: [] }), ccs2Car())).toBeNull();
  });

  it("GB/T DC con un vehículo CCS2 que no lleva el adaptador: lo requiere y serviría", () => {
    expect(adapterRequirement(charger({ sockets: [GBT_DC] }), ccs2Car())).toEqual({
      station: ["gb_t"],
      adapter: { from: "gb_t", to: "ccs2" },
      carried: false,
      fastCharge: true,
    });
  });

  it("con el adaptador marcado, el plan la usa", () => {
    const r = adapterRequirement(
      charger({ sockets: [GBT_DC] }),
      ccs2Car([{ from: "gb_t", to: "ccs2" }]),
    );
    expect(r).toMatchObject({ carried: true, fastCharge: true });
  });

  it("GB/T sin corriente reportada: requiere adaptador pero no se confirma carga rápida (C4)", () => {
    const r = adapterRequirement(
      charger({ sockets: [{ connector: "gb_t", powerKw: 60, count: 1 }] }),
      ccs2Car([{ from: "gb_t", to: "ccs2" }]),
    );
    expect(r).toMatchObject({
      adapter: { from: "gb_t", to: "ccs2" },
      carried: true,
      fastCharge: false,
    });
  });

  it("prefiere el adaptador que sirve: CCS1 antes que un GB/T sin corriente", () => {
    const r = adapterRequirement(
      charger({
        sockets: [
          { connector: "gb_t", powerKw: 60, count: 1 },
          { connector: "ccs1", powerKw: 50, count: 1 },
        ],
      }),
      ccs2Car(),
    );
    expect(r?.adapter).toEqual({ from: "ccs1", to: "ccs2" });
    expect(r?.fastCharge).toBe(true);
  });

  it("sin adaptador verificado (CHAdeMO, Tipo 1): lo requiere igual, sin proponer uno", () => {
    expect(
      adapterRequirement(
        charger({ sockets: [{ connector: "chademo", powerKw: 50, count: 1 }] }),
        ccs2Car(),
      ),
    ).toEqual({
      station: ["chademo"],
      adapter: null,
      carried: false,
      fastCharge: false,
    });
    expect(
      adapterRequirement(
        charger({ sockets: [{ connector: "type1", powerKw: 7, count: 1 }] }),
        ccs2Car(),
      ),
    ).toMatchObject({
      station: ["type1"],
      adapter: null,
    });
  });
});

describe("effectiveChargeKw", () => {
  it("limita la potencia del socket DC al dcMaxKw del vehículo", () => {
    const socket: ChargerSocket = { connector: "ccs2", powerKw: 350, count: 1 };
    expect(effectiveChargeKw(socket, vehicle({ dcMaxKw: 120 }))).toBe(120);
  });

  it("limita la potencia del socket AC al acMaxKw del vehículo", () => {
    const socket: ChargerSocket = { connector: "type2", powerKw: 22, count: 1 };
    expect(effectiveChargeKw(socket, vehicle({ acMaxKw: 11 }))).toBe(11);
  });
});

describe("powerKwAtSoc / chargeCurveSeries", () => {
  it("la potencia nunca es negativa", () => {
    expect(powerKwAtSoc(vehicle(), 100)).toBeGreaterThanOrEqual(0);
  });

  it("genera una serie del 0 al 100% con el paso pedido", () => {
    const series = chargeCurveSeries(vehicle(), 25);
    expect(series.map((p) => p.soc)).toEqual([0, 25, 50, 75, 100]);
  });
});
