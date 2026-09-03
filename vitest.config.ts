import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit-test runner. Tests cover the three layers that decide whether the app
 * serves trustworthy numbers: the repository (filtering / timezone / status),
 * the provider registry (switching + loud configuration errors) and the
 * banker engine (market whitelist + anti-correlation + odds target).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
