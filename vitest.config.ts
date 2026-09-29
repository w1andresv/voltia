import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Las pruebas del pipeline importan toda la aplicación en su primera prueba
    // (import dinámico de container, servicio, etc.). Con la cobertura de v8 esa
    // importación en frío pasa de 5 s en CI; la lógica de cada prueba tarda poco.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts"],
      exclude: [
        "src/domain/**/*.test.ts",
        // Catálogo de datos estático (presets de vehículos), no lógica de dominio.
        "src/domain/vehicles.ts",
        // Catálogo v2 congelado, solo para la migración del store (datos, no lógica).
        "src/domain/legacy-catalog.ts",
        // Esquemas Zod y tipos de puertos, no lógica que probar por sí misma
        // (types.ts ya los ejercita al importar VehicleSchema/PlaceSchema/etc.).
        "src/domain/schemas.ts",
        "src/domain/auth/**",
        // Fixtures de pruebas, no lógica.
        "src/domain/**/test-fixtures.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
