import { oemV289 } from "@fp/engine";
import { describe, expect, it } from "vitest";
import { app } from "./app.ts";

describe("api", () => {
  it("validates the OEM flow", async () => {
    const res = await app.request("/api/flows/validate", { method: "POST", body: JSON.stringify(oemV289.oemFlow) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: string[]; warnings: string[] };
    expect(body.errors).toEqual([]);
    expect(body.warnings.some((w) => w.includes("配方成本初步核算"))).toBe(true);
  });

  it("rejects a body that is not a flow", async () => {
    const res = await app.request("/api/flows/validate", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
  });
});
