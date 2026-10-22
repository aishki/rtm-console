import type { QueueMapRow } from "./import/queueMap";
import { queueKey } from "./queueStats";

export type TreeLevel = "tower" | "subTower" | "lob" | "queue";

export interface TreeNode {
  key: string;
  level: TreeLevel;
  label: string;
  /** Every queue name under the node, with the feed's spelling. */
  queues: string[];
  /** The distinct agent ids under the node, in first-seen order. */
  agentIds: number[];
  children: TreeNode[];
}

export const UNMAPPED = "Unmapped";

const PREFIX: Record<TreeLevel, string> = { tower: "t", subTower: "s", lob: "l", queue: "q" };
const MAPPED: TreeLevel[] = ["tower", "subTower", "lob", "queue"];
const FLAT: TreeLevel[] = ["tower", "queue"];

const newNode = (parentKey: string, level: TreeLevel, label: string): TreeNode => ({
  key: `${parentKey}${parentKey ? "/" : ""}${PREFIX[level]}:${label}`,
  level,
  label,
  queues: [],
  agentIds: [],
  children: [],
});

/** Adds a queue under `path` (labels from the tower down), creating nodes as needed. `ids` holds each node's agentIds as a set. */
function place(roots: TreeNode[], path: string[], levels: TreeLevel[], queueName: string, agents: number[], ids: Map<TreeNode, Set<number>>): void {
  let siblings = roots;
  let parentKey = "";
  path.forEach((label, depth) => {
    let node = siblings.find(n => n.label === label);
    if (!node) {
      node = newNode(parentKey, levels[depth], label);
      siblings.push(node);
      ids.set(node, new Set());
    }
    node.queues.push(queueName);
    const has = ids.get(node)!;
    for (const id of agents) if (!has.has(id)) { has.add(id); node.agentIds.push(id); }
    siblings = node.children;
    parentKey = node.key;
  });
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => a.label.localeCompare(b.label));
  nodes.forEach(n => {
    n.queues.sort((a, b) => a.localeCompare(b));
    sortTree(n.children);
  });
}

export function buildTree(queueNames: string[], map: QueueMapRow[], members: Record<string, number[]>): TreeNode[] {
  const firstRow = new Map<string, QueueMapRow>();
  for (const r of map) if (!firstRow.has(queueKey(r.queue))) firstRow.set(queueKey(r.queue), r);

  const seen = new Set<string>();
  const mapped: TreeNode[] = [];
  const unmapped: TreeNode[] = [];
  const ids = new Map<TreeNode, Set<number>>();
  for (const name of queueNames) {
    const k = queueKey(name);
    if (seen.has(k)) continue;
    seen.add(k);
    const agents = members[name] ?? [];
    const r = firstRow.get(k);
    if (r) place(mapped, [r.tower, r.subTower, r.lob, name], MAPPED, name, agents, ids);
    else place(unmapped, [UNMAPPED, name], FLAT, name, agents, ids);
  }

  sortTree(mapped);
  sortTree(unmapped);
  return [...mapped, ...unmapped];
}
