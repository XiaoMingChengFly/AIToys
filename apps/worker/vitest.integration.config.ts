import { defineConfig } from "vitest/config";

/** 需要真实 Postgres 和 Temporal（docker compose up -d postgres temporal）。 */
export default defineConfig({
  test: { include: ["test/**/*.int.test.ts"], testTimeout: 60_000, hookTimeout: 120_000 },
});
