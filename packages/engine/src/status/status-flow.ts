import { type Condition, evaluate, type Fields } from "../flow/condition.ts";
import type { FlowDefinition } from "../flow/definition.ts";
import { FlowError } from "../flow/state.ts";

/** 状态的类别：决定工作项算不算完成。“已完成”和“已关闭”都算结束。 */
export type StatusCategory = "todo" | "doing" | "done" | "closed";

export interface StatusDefinition {
  key: string;
  name: string;
  category: StatusCategory;
}

/** 一条流转：从一个状态到另一个状态。 */
export interface TransitionDefinition {
  from: string;
  to: string;
  /** 能操作这条流转的角色；为空表示空间成员都能操作。空间管理员总是可以。 */
  roles?: string[];
  /** 流转条件：满足后才能流转。 */
  gate?: Condition;
}

/**
 * 状态流定义（缺陷、任务这类工作项用）。第一个状态是初始状态。
 * 和节点流一样存在流程模板的版本里，发布后不可修改。
 */
export interface StatusFlowDefinition {
  key: string;
  version: number;
  mode: "state";
  statuses: StatusDefinition[];
  transitions: TransitionDefinition[];
}

export function isStatusFlow(definition: unknown): definition is StatusFlowDefinition {
  return typeof definition === "object" && definition !== null && (definition as { mode?: unknown }).mode === "state";
}

/** 状态是否表示工作项已经结束。 */
export const isFinal = (category: StatusCategory) => category === "done" || category === "closed";

export interface StatusActor {
  userId: string;
  /** 操作人在这个工作项上担任的角色。 */
  roles: readonly string[];
  isAdmin?: boolean;
}

export type StatusEvent =
  | { type: "statusChanged"; from: string; to: string; by: string }
  | { type: "workItemCompleted" }
  | { type: "workItemReopened" };

/** 状态流引擎：查可用的流转、执行流转。纯函数，服务端和浏览器共用。 */
export class StatusFlow {
  readonly definition: StatusFlowDefinition;

  constructor(definition: StatusFlowDefinition) {
    this.definition = definition;
  }

  get initial(): StatusDefinition {
    const first = this.definition.statuses[0];
    if (!first) throw new FlowError("状态流里没有状态。");
    return first;
  }

  status(key: string): StatusDefinition {
    const status = this.definition.statuses.find((s) => s.key === key);
    if (!status) throw new FlowError(`状态流里没有状态 ${key}`);
    return status;
  }

  /** 从当前状态出发、这个人有权限操作的流转（不看条件，条件不满足的也列出来，界面上提示原因）。 */
  available(current: string, actor: StatusActor): TransitionDefinition[] {
    return this.definition.transitions.filter((t) => t.from === current && this.allowed(t, actor));
  }

  private allowed(t: TransitionDefinition, actor: StatusActor): boolean {
    return actor.isAdmin === true || !t.roles?.length || t.roles.some((r) => actor.roles.includes(r));
  }

  /** 流转到 to。返回事件；工作项进入或离开结束状态时带上完成、重新打开事件。 */
  transition(current: string, to: string, actor: StatusActor, fields: Fields): StatusEvent[] {
    const target = this.status(to);
    const t = this.definition.transitions.find((x) => x.from === current && x.to === to);
    if (!t) throw new FlowError(`不能从「${this.status(current).name}」流转到「${target.name}」。`);
    if (!this.allowed(t, actor)) throw new FlowError(`你没有权限流转到「${target.name}」。`);
    if (t.gate && !evaluate(t.gate, fields)) throw new FlowError(`流转到「${target.name}」的条件还没满足。`);

    const events: StatusEvent[] = [{ type: "statusChanged", from: current, to, by: actor.userId }];
    const wasFinal = isFinal(this.status(current).category);
    const nowFinal = isFinal(target.category);
    if (!wasFinal && nowFinal) events.push({ type: "workItemCompleted" });
    if (wasFinal && !nowFinal) events.push({ type: "workItemReopened" });
    return events;
  }
}

/** 状态流发布前的校验。 */
export function validateStatusFlow(definition: StatusFlowDefinition): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const s of definition.statuses) {
    if (keys.has(s.key)) errors.push(`状态键重复：${s.key}`);
    if (names.has(s.name)) errors.push(`状态名称重复：${s.name}`);
    if (!s.name.trim()) errors.push("有状态没有名称。");
    keys.add(s.key);
    names.add(s.name);
  }
  if (definition.statuses.length === 0) errors.push("状态流至少要有一个状态。");
  const seen = new Set<string>();
  for (const t of definition.transitions) {
    if (!keys.has(t.from) || !keys.has(t.to)) errors.push(`流转引用了不存在的状态：${t.from} → ${t.to}`);
    if (t.from === t.to) errors.push("流转的起点和终点不能是同一个状态。");
    const id = `${t.from}→${t.to}`;
    if (seen.has(id)) errors.push(`流转重复：${id}`);
    seen.add(id);
  }
  if (errors.length > 0) return { errors, warnings };

  // 从初始状态走不到的状态，工作项永远到不了
  const reached = new Set([definition.statuses[0]?.key]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of definition.transitions)
      if (reached.has(t.from) && !reached.has(t.to)) {
        reached.add(t.to);
        changed = true;
      }
  }
  for (const s of definition.statuses) if (!reached.has(s.key)) warnings.push(`状态「${s.name}」从初始状态走不到。`);
  if (!definition.statuses.some((s) => isFinal(s.category)))
    warnings.push("没有“已完成”或“已关闭”类的状态，工作项永远不会结束。");
  return { errors, warnings };
}

/** 流程版本里存的定义是节点流时返回它，状态流或没有时返回 null。 */
export function nodeFlowOf(definition: unknown): FlowDefinition | null {
  return definition && !isStatusFlow(definition) ? (definition as FlowDefinition) : null;
}

/** 流程版本里存的定义是状态流时返回它。 */
export function statusFlowOf(definition: unknown): StatusFlowDefinition | null {
  return isStatusFlow(definition) ? definition : null;
}
