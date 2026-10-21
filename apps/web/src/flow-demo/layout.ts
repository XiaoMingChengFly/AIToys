import type { FlowGraph } from "@fp/engine";

export const COLUMN_WIDTH = 240;
export const ROW_HEIGHT = 64;

/** 简单分层布局：列 = 从起点出发的最长路径深度，行 = 同列内的出现顺序。 */
export function layoutByDepth(graph: FlowGraph): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const visit = (key: string): number => {
    const cached = depth.get(key);
    if (cached !== undefined) return cached;
    const preds = graph.predecessors(key);
    const d = preds.length === 0 ? 0 : Math.max(...preds.map(visit)) + 1;
    depth.set(key, d);
    return d;
  };
  for (const node of graph.nodes) visit(node.key);

  const rowsUsed = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    const column = depth.get(node.key) ?? 0;
    const row = rowsUsed.get(column) ?? 0;
    rowsUsed.set(column, row + 1);
    positions.set(node.key, { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT });
  }
  return positions;
}
