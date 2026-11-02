import type { Rule } from "@/lib/types";

// Where the console keeps what must outlive a restart. The engine stays in charge, in memory; it
// hands each record to the store, which keeps it without making the engine wait.
// PERSISTENCE_MODE picks the store: postgres, or memory (development and test only).
// Phase 0 keeps the rules. Later phases add people, call-outs, incidents and the day's events.

export interface Store {
  readonly kind: "memory" | "postgres";
  /** The rules at their current versions, in the console's order. */
  loadRules(): Promise<Rule[]>;
  /** A rule's settings changed. Saved shortly after, as a new version; edits in quick succession become one. */
  ruleChanged(rule: Rule, by?: string | null): void;
  /** Write whatever is waiting. */
  flush(): Promise<void>;
  /** Write what is waiting, then let go of the database. */
  close(): Promise<void>;
}
