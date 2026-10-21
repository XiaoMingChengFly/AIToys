import { describe, expect, it } from "vitest";
import { cond, StatusFlow, type StatusFlowDefinition, validateStatusFlow } from "../src/index.ts";

const bugFlow: StatusFlowDefinition = {
  key: "bug",
  version: 1,
  mode: "state",
  statuses: [
    { key: "open", name: "待处理", category: "todo" },
    { key: "fixing", name: "处理中", category: "doing" },
    { key: "resolved", name: "已解决", category: "done" },
    { key: "closed", name: "已关闭", category: "closed" },
  ],
  transitions: [
    { from: "open", to: "fixing", roles: ["dev"] },
    { from: "fixing", to: "resolved", gate: cond.notEmpty("修复版本") },
    { from: "resolved", to: "fixing" },
    { from: "resolved", to: "closed", roles: ["qa"] },
  ],
};

const dev = { userId: "u1", roles: ["dev"] };
const qa = { userId: "u2", roles: ["qa"] };

describe("StatusFlow", () => {
  const flow = new StatusFlow(bugFlow);

  it("starts in the first status and lists only the transitions the person may take", () => {
    expect(flow.initial.key).toBe("open");
    expect(flow.available("open", dev).map((t) => t.to)).toEqual(["fixing"]);
    expect(flow.available("open", qa)).toEqual([]);
    expect(flow.available("open", { ...qa, isAdmin: true }).map((t) => t.to)).toEqual(["fixing"]);
    expect(flow.available("resolved", qa).map((t) => t.to)).toEqual(["fixing", "closed"]);
  });

  it("refuses a transition that does not exist, that the role may not take, or whose gate is not met", () => {
    expect(() => flow.transition("open", "resolved", dev, {})).toThrow("不能从「待处理」流转到「已解决」");
    expect(() => flow.transition("open", "fixing", qa, {})).toThrow("没有权限");
    expect(() => flow.transition("fixing", "resolved", dev, {})).toThrow("条件还没满足");
  });

  it("completes the work item on entering a final status and reopens it on leaving", () => {
    expect(flow.transition("fixing", "resolved", dev, { 修复版本: "1.2" })).toEqual([
      { type: "statusChanged", from: "fixing", to: "resolved", by: "u1" },
      { type: "workItemCompleted" },
    ]);
    expect(flow.transition("resolved", "closed", qa, {})).toEqual([
      { type: "statusChanged", from: "resolved", to: "closed", by: "u2" },
    ]);
    expect(flow.transition("resolved", "fixing", dev, {})).toContainEqual({ type: "workItemReopened" });
  });
});

describe("validateStatusFlow", () => {
  it("rejects dangling and duplicate transitions, warns about unreachable statuses and no final status", () => {
    expect(validateStatusFlow(bugFlow)).toEqual({ errors: [], warnings: [] });
    const broken = { ...bugFlow, transitions: [...bugFlow.transitions, { from: "open", to: "nowhere" }] };
    expect(validateStatusFlow(broken).errors).toContainEqual(expect.stringContaining("不存在的状态"));
    const lonely: StatusFlowDefinition = {
      ...bugFlow,
      statuses: [...bugFlow.statuses.slice(0, 2), { key: "x", name: "孤岛", category: "todo" }],
      transitions: [{ from: "open", to: "fixing" }],
    };
    expect(validateStatusFlow(lonely).warnings).toEqual([
      "状态「孤岛」从初始状态走不到。",
      "没有“已完成”或“已关闭”类的状态，工作项永远不会结束。",
    ]);
  });
});
