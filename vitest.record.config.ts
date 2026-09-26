import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Solo para `npm run snapshot:record`: usa red y lee la base, por eso no entra en `npm test`. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/test-support/*.record.ts"],
    testTimeout: 180_000,
  },
});
