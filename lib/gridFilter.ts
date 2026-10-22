import type { TreeNode } from "./queueTree";

// Filters the agent grid's tower tree and decides which queues open by themselves. Pure, so the
// page's render stays a lookup.

/** A search opens its queues only while it matches at most this many... */
export const AUTO_OPEN_QUEUES = 5;
/** ...and they hold at most this many cards in total. Larger results stay closed, showing counts. */
export const AUTO_OPEN_CARDS = 300;

export interface GridFilter {
  /** Lowercased, trimmed search text; "" for none. */
  query: string;
  /** The queue picked in the queue filter; "" for none. */
  queue: string;
  /** Ids passing the state and quick filters; null when none is set. */
  inScope: Set<number> | null;
  /** Ids whose own name or team lead contains the query. */
  queryHits: Set<number>;
}

export interface GridView {
  /** The tree pruned to the filter. */
  nodes: TreeNode[];
  /** Node key → the distinct ids it shows after filtering, in first-seen order. */
  shown: Map<string, number[]>;
  /** Queue nodes left. */
  queueCount: number;
  /** Distinct people left. */
  agentCount: number;
}

export const flatten = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap(n => [n, ...flatten(n.children)]);

/**
 * The queue filter picks a branch of the tree, not agents: someone in several queues shows under each.
 * A search matches a person's name or team lead, or a queue's name; a queue matched by name keeps
 * every member in scope of the other filters.
 */
export function filterTree(tree: TreeNode[], f: GridFilter): GridView {
  const shown = new Map<string, number[]>();
  const people = new Set<number>();
  let queueCount = 0;

  const walk = (n: TreeNode): TreeNode | null => {
    if (f.queue && !n.queues.includes(f.queue)) return null;
    if (n.level === "queue") {
      const named = !!f.query && n.label.toLowerCase().includes(f.query);
      const ids = n.agentIds.filter(id => (!f.inScope || f.inScope.has(id)) && (!f.query || named || f.queryHits.has(id)));
      // An empty queue still shows when it is picked by the queue filter or found by name.
      if (!ids.length && (f.inScope || (f.query && !named))) return null;
      shown.set(n.key, ids);
      ids.forEach(id => people.add(id));
      queueCount++;
      return n;
    }
    const children = n.children.flatMap(c => walk(c) ?? []);
    if (!children.length) return null;
    const ids = new Set<number>();
    for (const c of children) for (const id of shown.get(c.key)!) ids.add(id);
    shown.set(n.key, [...ids]);
    return { ...n, children };
  };

  const nodes = tree.flatMap(n => walk(n) ?? []);
  return { nodes, shown, queueCount, agentCount: people.size };
}

/** The queues a search opens: all it matches while the result is small, otherwise none. */
export function autoOpenQueues(view: GridView, query: string): Set<string> {
  if (!query) return new Set();
  const queues = flatten(view.nodes).filter(n => n.level === "queue");
  const cards = queues.reduce((sum, n) => sum + (view.shown.get(n.key)?.length ?? 0), 0);
  return queues.length <= AUTO_OPEN_QUEUES && cards <= AUTO_OPEN_CARDS ? new Set(queues.map(n => n.key)) : new Set();
}

/** "Expand all" opens towers, sub-towers and LOBs; queues open one at a time. */
export const expandAllKeys = (nodes: TreeNode[]): string[] => flatten(nodes).filter(n => n.level !== "queue").map(n => n.key);
