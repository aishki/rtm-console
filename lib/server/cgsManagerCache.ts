import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ManagerCache } from "@/lib/directory/cgsManagers";

// The CGS directory's answers (Domain ID to the manager's Domain ID), kept on this machine so a
// restart does not ask about the whole floor again. Domain IDs only, nothing else from the record.
// The folder is gitignored: these are real people.

// turbopackIgnore: read at run time only. The build must not trace .rtm/, whose files can be unreadable to the user who builds.
const FILE = () => path.join(/* turbopackIgnore: true */ process.cwd(), ".rtm", "cgs-managers.json");
/** Written after this many new answers, and when the caller flushes. */
const WRITE_EVERY = 25;

type Saved = Record<string, { m: string | null; at: number }>;

export function fileManagerCache(file: string = FILE()): ManagerCache & { flush(): void } {
  let data: Saved = {};
  try {
    const x = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (x && typeof x === "object") data = x as Saved;
  } catch { /* none yet */ }
  let unsaved = 0;
  const flush = () => {
    if (!unsaved) return;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data));
      unsaved = 0;
    } catch { /* a convenience: without it the directory is asked again after a restart */ }
  };
  return {
    get(domainId) {
      const e = data[domainId];
      return e && typeof e.at === "number" ? { manager: typeof e.m === "string" ? e.m : null, at: e.at } : undefined;
    },
    set(domainId, manager, at) {
      data[domainId] = { m: manager, at };
      if (++unsaved >= WRITE_EVERY) flush();
    },
    flush,
  };
}
