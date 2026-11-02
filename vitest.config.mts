import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
    // Unit tests run with no database: the memory store, as in development without one.
    env: { APP_ENV: "test", PERSISTENCE_MODE: "memory" },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
});
