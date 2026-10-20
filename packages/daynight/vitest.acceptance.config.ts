import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e.acceptance.ts", "test/update.acceptance.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
