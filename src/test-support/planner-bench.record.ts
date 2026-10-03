import { it } from "vitest";
import { buildPlan } from "@/domain/planner";
import type { PlannerRunStats } from "@/domain/plan/shared";
import { energyProfileForRoute } from "@/domain/ev/energy-v2";
import { catalogVehicle } from "./scenarios";
import {
  BENCH_CONDITIONS,
  BENCH_DESTINATION,
  BENCH_ORIGIN,
  benchChargers,
  benchRoute,
} from "./planner-scenarios";

/**
 * Banco del planificador (M1, ADR-0020): milisegundos por ruta con N estaciones,
 * repartidas y agrupadas. Sin red ni base: `npm run bench:planner`. Los milisegundos
 * dependen de la máquina; lo que se compara entre cambios son los contadores.
 */
it("banco del planificador v2", () => {
  const raw = benchRoute();
  const vehicle = catalogVehicle("mg-s5-ev-comfort");
  const rows: string[] = [
    "estaciones | forma      | energía v2 | plan v2 (ms) | plan v1 (ms) | paradas | corridas DP | expansiones | llegadas | etiquetas",
  ];
  for (const clustered of [false, true]) {
    for (const n of [20, 40, 80, 120]) {
      const chargers = benchChargers(raw, n, clustered);
      const args = {
        raw,
        vehicle,
        conditions: BENCH_CONDITIONS,
        chargers,
        weather: null,
        origin: BENCH_ORIGIN,
        destination: BENCH_DESTINATION,
      };
      const v2 = { ...args, engine: "v2" as const, energyEngine: "v2" as const };
      buildPlan(v2); // calentar
      const R = 5;
      let t = performance.now();
      for (let r = 0; r < R; r++) energyProfileForRoute(raw, vehicle, BENCH_CONDITIONS, null);
      const tEnergy = (performance.now() - t) / R;
      const stats: PlannerRunStats = { stations: 0, runs: 0, expansions: 0, arrivals: 0, labelWrites: 0 };
      t = performance.now();
      let plan = buildPlan({ ...v2, stats });
      const tV2 = performance.now() - t;
      for (let r = 1; r < R; r++) plan = buildPlan(v2);
      const tV2avg = (performance.now() - t) / R;
      t = performance.now();
      for (let r = 0; r < R; r++) buildPlan({ ...args, engine: "legacy", energyEngine: "legacy" });
      const tV1 = (performance.now() - t) / R;
      void tV2;
      rows.push(
        `${String(n).padStart(10)} | ${(clustered ? "agrupadas" : "repartidas").padEnd(10)} | ${tEnergy.toFixed(1).padStart(10)} | ${tV2avg.toFixed(0).padStart(12)} | ${tV1.toFixed(1).padStart(12)} | ${String(plan.stops.length).padStart(7)} | ${String(stats.runs).padStart(11)} | ${String(stats.expansions).padStart(11)} | ${String(stats.arrivals).padStart(8)} | ${String(stats.labelWrites).padStart(9)}`,
      );
    }
  }
  console.log(`\n${rows.join("\n")}\n`);
});
