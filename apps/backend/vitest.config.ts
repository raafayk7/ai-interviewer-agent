import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // DB integration tests share a single Postgres instance.
    // Running test files in parallel causes TRUNCATE deadlocks across workers.
    fileParallelism: false,
  },
});
