import { defineConfig } from "vitest/config";

/** 需要真实 Postgres（docker compose up -d postgres）。 */
export default defineConfig({
  test: { include: ["test/**/*.int.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
