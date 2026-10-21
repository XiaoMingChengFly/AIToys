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
