import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/native/**/*.native.ts"],
    fileParallelism: false,
    // Vitest timeouts do not cancel helpers; each owner enforces its deadline and finishes cleanup.
    testTimeout: 0,
    hookTimeout: 0,
  },
});
