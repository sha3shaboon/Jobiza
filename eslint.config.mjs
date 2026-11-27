import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Desktop app: its own dependencies and generated bundles.
    "desktop/node_modules/**",
    "desktop/build/**",
    "desktop/dist/**",
    // Android app: its own dependencies, the native project and generated bundles.
    "mobile/node_modules/**",
    "mobile/build/**",
    "mobile/android/**",
  ]),
  // The Electron shell runs as plain CommonJS.
  { files: ["desktop/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
]);

export default eslintConfig;
