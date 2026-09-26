import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Lo que el dominio no puede importar: capas externas ni el framework. */
const OUTSIDE_DOMAIN = [
  {
    group: ["@/infrastructure/*", "@/application/*", "@/server/*", "@/lib/*", "@/components/*"],
    message: "El dominio no depende de capas externas.",
  },
  {
    group: ["next", "next/*", "react", "react-dom", "server-only"],
    message: "El dominio es TypeScript puro.",
  },
];

/** Flat ESLint config for the Voltia Next.js app. */
export default tseslint.config(
  {
    ignores: ["node_modules/**", ".next/**", "next-env.d.ts", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Reglas de dependencia del motor v2 (docs/arquitectura-ev/02-plan-arquitectura-modular.md, §2.2).
  // En la configuración plana el último bloque que coincide reemplaza la regla, por eso
  // los bloques más específicos repiten los patrones del dominio.
  {
    files: ["src/domain/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: OUTSIDE_DOMAIN }] },
  },
  {
    files: ["src/domain/ev/engines/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...OUTSIDE_DOMAIN,
            // Dentro de un engine: "./archivo" para lo propio y "@/domain/ev/contracts|core/…" para lo compartido.
            {
              group: ["../*", "@/domain/ev/engines/*"],
              message: "Un engine no importa otro engine: los compone compute-plan.ts.",
            },
            { group: ["@/domain/ports/*"], message: "Los engines no conocen proveedores." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/application/**/*.ts"],
    ignores: ["src/application/container.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/infrastructure/*"],
              message: "La aplicación usa puertos; solo application/container.ts conoce la infraestructura.",
            },
            { group: ["react", "react-dom", "@/components/*"], message: "La aplicación no depende de la UI." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.ts", "src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // chargers.catalog es un listado estático de datos, no un proveedor externo.
              group: ["@/infrastructure/providers/*", "!@/infrastructure/providers/chargers.catalog"],
              message: "Los proveedores se usan a través de application/ (container.ts).",
            },
          ],
        },
      ],
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
