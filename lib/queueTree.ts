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

/** Adds a queue under `path` (labels from the tower down), creating nodes as needed. */
function place(roots: TreeNode[], path: string[], levels: TreeLevel[], queueName: string, agents: number[]): void {
  let siblings = roots;
  let parentKey = "";
  path.forEach((label, depth) => {
    let node = siblings.find(n => n.label === label);
    if (!node) {
      node = newNode(parentKey, levels[depth], label);
      siblings.push(node);
    }
    node.queues.push(queueName);
    for (const id of agents) if (!node.agentIds.includes(id)) node.agentIds.push(id);
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
  for (const name of queueNames) {
    const k = queueKey(name);
    if (seen.has(k)) continue;
    seen.add(k);
    const agents = members[name] ?? [];
    const r = firstRow.get(k);
    if (r) place(mapped, [r.tower, r.subTower, r.lob, name], MAPPED, name, agents);
    else place(unmapped, [UNMAPPED, name], FLAT, name, agents);
  }

  sortTree(mapped);
  sortTree(unmapped);
  return [...mapped, ...unmapped];
}
