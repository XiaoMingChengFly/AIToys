import { describe, expect, it } from "vitest";
import {
  type CompletionMode,
  type Condition,
  cond,
  type FlowDefinition,
  FlowEngine,
  validateFlow,
} from "../src/index.ts";

const noFields = {};
const u1 = { userId: "u1" };

type Spec = [key: string, preds: string[], mode?: CompletionMode, visible?: Condition];

function flow(...specs: Spec[]): FlowDefinition {
  return {
    key: "t",
    version: 1,
    nodes: specs.map(([key, , mode, visible]) => ({
      key,
      name: key,
      completion: mode ?? "singleConfirm",
      ownerRoles: ["owner"],
      ...(visible && { visibility: visible }),
    })),
    edges: specs.flatMap(([key, preds]) => preds.map((from) => ({ from, to: key }))),
  };
}

const ownersOf = (f: FlowDefinition) => Object.fromEntries(f.nodes.map((n) => [n.key, ["u1"]]));

describe("FlowEngine", () => {
  it("starts the first node", () => {
    const f = flow(["a", []], ["b", ["a"]]);
    const { state, events } = new FlowEngine(f).start(noFields, ownersOf(f));
    expect(state.nodes.a?.state).toBe("inProgress");
    expect(state.nodes.b?.state).toBe("notStarted");
    expect(events).toContainEqual({ type: "nodeStarted", node: "a" });
  });

  it("waits for every predecessor at a join", () => {
    const f = flow(["a", []], ["b", ["a"]], ["c", ["a"]], ["d", ["b", "c"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));

    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.b?.state).toBe("inProgress");
    expect(state.nodes.c?.state).toBe("inProgress");

    engine.confirm(state, "b", u1, noFields);
    expect(state.nodes.d?.state).toBe("notStarted");

    engine.confirm(state, "c", u1, noFields);
    expect(state.nodes.d?.state).toBe("inProgress");
  });

  it("does not let a skipped node in a chain start its successor early", () => {
    const f = flow(["a", []], ["b", ["a"], "singleConfirm", cond.equal("x", "是")], ["c", ["b"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    expect(state.nodes.b?.state).toBe("skipped");
    expect(state.nodes.c?.state).toBe("notStarted");

    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.c?.state).toBe("inProgress");
  });

  it("restores a skipped node when its condition becomes true", () => {
    const f = flow(["a", []], ["b", ["a"], "singleConfirm", cond.equal("x", "是")]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.b?.state).toBe("skipped");

    engine.onFieldsChanged(state, { x: "是" });
    expect(state.nodes.b?.state).toBe("inProgress");
  });

  it("needs every owner for an all-confirm node", () => {
    const f = flow(["a", [], "allConfirm"], ["b", ["a"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, { a: ["u1", "u2"], b: ["u1"] });

    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.a?.state).toBe("inProgress");
    engine.confirm(state, "a", { userId: "u2" }, noFields);
    expect(state.nodes.a?.state).toBe("completed");
  });

  it("rejects a confirm from someone who is not an owner", () => {
    const f = flow(["a", []]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    expect(() => engine.confirm(state, "a", { userId: "someone-else" }, noFields)).toThrow("负责人");
  });

  it("rolls back downstream nodes and reopens the work item", () => {
    const f = flow(["a", []], ["b", ["a"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    engine.confirm(state, "a", u1, noFields);
    engine.confirm(state, "b", u1, noFields);
    expect(state.status).toBe("completed");

    engine.rollback(state, "a", u1, noFields);
    expect(state.nodes.a?.state).toBe("inProgress");
    expect(state.nodes.b?.state).toBe("notStarted");
    expect(state.status).toBe("inProgress");
  });
});

describe("validateFlow", () => {
  it("rejects cycles and dangling edges", () => {
    const cyclic = flow(["a", []], ["b", ["a", "c"]], ["c", ["b"]]);
    expect(validateFlow(cyclic).errors).toContainEqual(expect.stringContaining("环"));

    const dangling: FlowDefinition = { ...flow(["a", []]), edges: [{ from: "a", to: "zzz" }] };
    expect(validateFlow(dangling).errors).not.toHaveLength(0);
  });
});
