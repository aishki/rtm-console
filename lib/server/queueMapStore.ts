import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { QueueMapRow } from "@/lib/import/queueMap";

// The WFM queue-to-LOB mapping an admin uploaded, kept on this machine in .rtm/ (gitignored).
// The rows are cached on globalThis so a dev reload keeps them. `dir` points the store
// somewhere else (tests) and bypasses that cache.

interface Store { rows?: QueueMapRow[]; rev: number }
const g = globalThis as typeof globalThis & { __rtmQueueMap?: Store };
const store: Store = (g.__rtmQueueMap ??= { rev: 1 });

const DEFAULT_DIR = () => path.join(process.cwd(), ".rtm");
const fileIn = (dir: string) => path.join(dir, "queue-map.json");

function readRows(dir: string): QueueMapRow[] {
  try {
    const x: unknown = JSON.parse(readFileSync(fileIn(dir), "utf8"));
    return Array.isArray(x) ? (x as QueueMapRow[]) : [];
  } catch { return []; }
}

export function loadQueueMap(dir?: string): QueueMapRow[] {
  if (dir) return readRows(dir);
  return (store.rows ??= readRows(DEFAULT_DIR()));
}

export function saveQueueMap(rows: QueueMapRow[], dir?: string): void {
  const target = dir ?? DEFAULT_DIR();
  mkdirSync(target, { recursive: true });
  writeFileSync(fileIn(target), JSON.stringify(rows));
  if (!dir) store.rows = rows;
  store.rev++;
}

/** Starts at 1 and goes up on every save, so readers can tell when the mapping changed. */
export const queueMapRev = (): number => store.rev;
