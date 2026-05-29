import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Default environment is `node` for the data/service layer integration tests.
 * Component tests (`*.test.tsx`) opt into jsdom with a top-of-file pragma:
 *   // @vitest-environment jsdom
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "app/**/*.test.{ts,tsx}"],
  },
});
