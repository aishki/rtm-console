import { defaultRules } from "@/lib/engine/rules";
import type { Store } from "./store";

/** Keeps nothing beyond the process: development without a database, unit tests and CSV replays. */
export function memoryStore(): Store {
  return {
    kind: "memory",
    loadRules: async () => defaultRules(),
    ruleChanged() {},
    flush: async () => {},
    close: async () => {},
  };
}
