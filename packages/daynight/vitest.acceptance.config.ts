import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.acceptance.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
