import type { Condition } from "./condition.ts";

export type CompletionMode =
  /** 任一负责人确认即完成。 */
  | "singleConfirm"
  /** 会签：全部负责人确认才完成。 */
  | "allConfirm"
  /** 卡点条件满足后自动完成；只有超管可以手动完成。 */
  | "auto"
  /** 关联的子工作项走到结束时完成。 */
  | "subItemDriven";

export interface NodeDefinition {
  key: string;
  name: string;
  completion: CompletionMode;
  ownerRoles: string[];
  /** 出现条件。不满足时节点被裁剪（跳过）。 */
  visibility?: Condition;
  /** 卡点：节点完成前必须满足的条件。 */
  gate?: Condition;
  /** 节点到达时把工作项阶段改成这个值。 */
  stageOnArrival?: string;
  /** 预估工期（工作日）。不填时需要人确认的节点按 1 天，自动节点按 0 天（里程碑）。 */
  duration?: number;
  /** 编辑器里的画布坐标。引擎不使用；没有时按层级自动布局。 */
  position?: { x: number; y: number };
}

export interface EdgeDefinition {
  from: string;
  to: string;
}

/** 一个流程模板版本的完整定义。发布后不可修改，改动只能发布新版本。可以直接 JSON 序列化。 */
export interface FlowDefinition {
  key: string;
  version: number;
  nodes: NodeDefinition[];
  edges: EdgeDefinition[];
}

/** 流程图的只读索引：按键查节点、前序、后续、末端节点。 */
export class FlowGraph {
  private readonly byKey: Map<string, NodeDefinition>;
  private readonly preds = new Map<string, string[]>();
  private readonly succs = new Map<string, string[]>();

  readonly definition: FlowDefinition;

  constructor(definition: FlowDefinition) {
    this.definition = definition;
    this.byKey = new Map(definition.nodes.map((n) => [n.key, n]));
    for (const { from, to } of definition.edges) {
      push(this.succs, from, to);
      push(this.preds, to, from);
    }
  }

  get nodes(): readonly NodeDefinition[] {
    return this.definition.nodes;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  node(key: string): NodeDefinition {
    const node = this.byKey.get(key);
    if (!node) throw new Error(`流程里没有节点 ${key}`);
    return node;
  }

  predecessors(key: string): readonly string[] {
    return this.preds.get(key) ?? [];
  }

  successors(key: string): readonly string[] {
    return this.succs.get(key) ?? [];
  }

  /** 没有后续节点的节点。工作项完成的判定看这些节点。 */
  get leaves(): NodeDefinition[] {
    return this.nodes.filter((n) => this.successors(n.key).length === 0);
  }

  /** 拓扑序：每个节点都排在它的所有前序之后。有环时环上的节点不在结果里。 */
  topologicalOrder(): string[] {
    const inDegree = new Map(this.nodes.map((n) => [n.key, this.predecessors(n.key).length]));
    const queue = this.nodes.filter((n) => inDegree.get(n.key) === 0).map((n) => n.key);
    const order: string[] = [];
    while (queue.length > 0) {
      const key = queue.shift() as string;
      order.push(key);
      for (const next of this.successors(key)) {
        const left = (inDegree.get(next) ?? 0) - 1;
        inDegree.set(next, left);
        if (left === 0) queue.push(next);
      }
    }
    return order;
  }

  /** 某节点之后能到达的所有节点。 */
  descendants(key: string): Set<string> {
    const seen = new Set<string>();
    const queue = [...this.successors(key)];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...this.successors(next));
    }
    return seen;
  }
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** 按节点的负责角色，把工作项上各角色的成员展开成每个节点的负责人。 */
export function resolveOwners(
  definition: FlowDefinition,
  membersByRole: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(
    definition.nodes.map((n) => [n.key, [...new Set(n.ownerRoles.flatMap((role) => membersByRole[role] ?? []))]]),
  );
}
