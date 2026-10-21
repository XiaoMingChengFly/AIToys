import { describe, expect, it } from "vitest";
import { type AutomationRuleDefinition, cond, ruleApplies, triggerMatches } from "../src/index.ts";

describe("automation triggers", () => {
  it("matches the event kind and the optional type and node filters", () => {
    const started = { kind: "nodeStarted", payload: { node: "review" } };
    expect(triggerMatches({ kind: "nodeStarted" }, started, "t1")).toBe(true);
    expect(triggerMatches({ kind: "nodeStarted", node: "review" }, started, "t1")).toBe(true);
    expect(triggerMatches({ kind: "nodeStarted", node: "other" }, started, "t1")).toBe(false);
    expect(triggerMatches({ kind: "nodeStarted", typeId: "t2" }, started, "t1")).toBe(false);
    expect(triggerMatches({ kind: "nodeCompleted" }, started, "t1")).toBe(false);
  });

  it("matches field changes by field key", () => {
    const changed = { kind: "fieldChanged", payload: { fieldKey: "sku", from: null, to: "A" } };
    expect(triggerMatches({ kind: "fieldChanged", field: "sku" }, changed, "t1")).toBe(true);
    expect(triggerMatches({ kind: "fieldChanged", field: "price" }, changed, "t1")).toBe(false);
  });

  it("checks the condition against the work item's fields", () => {
    const rule: AutomationRuleDefinition = {
      trigger: { kind: "workItemCreated" },
      condition: cond.equal("priority", "P0"),
      actions: [],
    };
    const created = { kind: "workItemCreated", payload: {} };
    expect(ruleApplies(rule, created, "t1", { priority: "P0" })).toBe(true);
    expect(ruleApplies(rule, created, "t1", { priority: "P1" })).toBe(false);
    expect(ruleApplies({ ...rule, condition: null }, created, "t1", {})).toBe(true);
  });
});
