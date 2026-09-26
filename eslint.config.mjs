import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

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
  // El dominio es TypeScript puro: no depende de capas externas ni del framework
  // (docs/arquitectura-ev/02-plan-arquitectura-modular.md, sección 2.2).
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/infrastructure/*", "@/application/*", "@/server/*", "@/lib/*", "@/components/*"],
              message: "El dominio no depende de capas externas.",
            },
            {
              group: ["next", "next/*", "react", "react-dom", "server-only"],
              message: "El dominio es TypeScript puro.",
            },
          ],
        },
      ],
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
