export type NodeState =
  | "notStarted"
  | "inProgress"
  | "completed"
  /** 出现条件不满足，被流程裁剪。汇聚时视为已通过。 */
  | "skipped";

export type WorkItemStatus = "inProgress" | "completed";

export interface NodeRuntime {
  state: NodeState;
  owners: string[];
  confirmations: string[];
}

/** 一个工作项在流程上的运行状态。由 FlowEngine 原地修改，可以直接 JSON 序列化存库。 */
export interface WorkItemState {
  status: WorkItemStatus;
  stage: string | null;
  nodes: Record<string, NodeRuntime>;
}

export type FlowEvent =
  | { type: "nodeStarted"; node: string }
  | { type: "nodeCompleted"; node: string; by: string | null }
  | { type: "nodeSkipped"; node: string }
  | { type: "nodeRestored"; node: string }
  | { type: "nodeConfirmed"; node: string; by: string }
  | { type: "nodeRolledBack"; node: string; by: string }
  | { type: "stageChanged"; node: string; from: string | null; to: string }
  | { type: "workItemCompleted" }
  | { type: "workItemReopened" };

export interface Actor {
  userId: string;
  isSuperAdmin?: boolean;
}

export class FlowError extends Error {
  override name = "FlowError";
}
