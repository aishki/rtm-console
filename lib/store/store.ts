import type { QueueMapRow } from "@/lib/import/queueMap";
import type { OrgId } from "@/lib/orgs";
import type { OrgPerson, Role, Rule, RuleId, RuleOverride, Team } from "@/lib/types";

// Where the console keeps what must outlive a restart. The engine stays in charge, in memory; it
// hands each record to the store, which keeps it without making the engine wait.
// PERSISTENCE_MODE picks the store: postgres, or memory (development and test only).
// Phase 0 keeps the rules; Phase 1 the queue map, people, queues, desktop-alert subscriptions and
// the rules' overrides by Tower, Sub-Tower and LOB.
// Later phases add call-outs, incidents and the day's events.

/** An org's last roster. `uid` is missing from files saved before agents were keyed by Genesys ID, and `members` then holds names. */
export interface RosterNames {
  org: Team[]; agents: { uid?: string; name: string; team: string; lastLogin?: string }[];
  /** Queue name to the uids of everyone in it. */
  members?: Record<string, string[]>;
  people?: OrgPerson[];
  /** The watched queues with their Genesys IDs, in roster order. */
  queues?: { id: string; name: string; division?: string }[];
}

/** A browser registered for desktop alerts, and who it is signed in as. */
export interface SavedSubscription {
  sub: { endpoint: string; keys: { p256dh: string; auth: string } };
  view: { role: Role; who: string | null };
  /** The browser, as its User-Agent header names it. */
  userAgent?: string;
}

/** Everything the store hands the app at start-up. */
export interface BootData {
  rules: Rule[];
  queueMap: QueueMapRow[];
  rosters: Partial<Record<OrgId, RosterNames | null>>;
  subscriptions: SavedSubscription[];
  /** The org the floor showed last; undefined when none was saved. */
  activeOrg?: OrgId;
}

export interface Store {
  readonly kind: "memory" | "postgres";
  /** The rules at their current versions, in the console's order, each with its current overrides. */
  loadRules(): Promise<Rule[]>;
  /** A rule's settings changed. Saved shortly after, as a new version; edits in quick succession become one. */
  ruleChanged(rule: Rule, by?: string | null): void;
  /**
   * A rule's override for one Tower, Sub-Tower or LOB changed. Saved shortly after, as a new version;
   * edits in quick succession become one. An override with no settings left removes it.
   */
  overrideChanged(ruleId: RuleId, override: RuleOverride, by?: string | null): void;

  /** Everything else the app needs at start-up. */
  loadBoot(): Promise<Omit<BootData, "rules">>;
  /** Replace the whole queue map. Resolves once it is kept, so the upload can say so. */
  saveQueueMap(rows: QueueMapRow[], by: string | null): Promise<void>;
  /** An org's roster or reporting lines changed. Saved shortly after; only the latest per org is written. */
  rosterChanged(org: OrgId, roster: RosterNames): void;
  /** A browser registered for desktop alerts, or moved to another person. */
  subscriptionSaved(s: SavedSubscription): void;
  /** The push service accepted an alert for this browser. */
  subscriptionDelivered(endpoint: string): void;
  /** A browser turned alerts off, or its push service said it is gone. */
  subscriptionRemoved(endpoint: string): void;
  /** The floor now shows this org. */
  activeOrgChanged(org: OrgId): void;

  /** Write whatever is waiting. */
  flush(): Promise<void>;
  /** Write what is waiting, then let go of the database. */
  close(): Promise<void>;
}
