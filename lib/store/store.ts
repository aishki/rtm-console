import type { QueueMapRow } from "@/lib/import/queueMap";
import type { OrgId } from "@/lib/orgs";
import type { FloorSource, Incident, Instance, InvAction, OrgPerson, Place, Role, Rule, RuleId, RuleOverride, Team, View } from "@/lib/types";
import type { IncidentSeq } from "@/lib/engine/escalation";
import type { AckVia, SavedFloor } from "@/lib/engine/record";

// Where the console keeps what must outlive a restart. The engine stays in charge, in memory; it
// hands each record to the store, which keeps it without making the engine wait.
// PERSISTENCE_MODE picks the store: postgres, or memory (development and test only).
// Phase 0 keeps the rules; Phase 1 the queue map, people, queues, desktop-alert subscriptions and
// the rules' overrides by Tower, Sub-Tower and LOB.
// Phase 2 the Genesys floors' shifts, call-outs, incidents, strikes and desktop-alert deliveries.
// Phase 3 adds the day's events.

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
  /** Each Genesys org's saved floor, to carry on from. Missing for an org with none, and with the memory store. */
  floors: Partial<Record<OrgId, SavedFloor>>;
  /** The highest call-out number saved: new ones carry on from it. */
  lastInstance: number;
  /** The incident counter as saved, for the latest year; null when none was. */
  incidentSeq: IncidentSeq | null;
}

/** What a call-out was raised with, besides what the ledger shows. */
export interface FiredInfo {
  /** The threshold that applied. */
  thr: number;
  /** The place of the most specific override that applied; null for the rule's defaults. */
  overrideAt: Place | null;
  /** The incident it opened (strike 3 and later). */
  incident: Incident | null;
  at: Date;
}

/** One desktop alert to one browser. */
export interface NotificationSent {
  /** The call-out it is about. */
  n: number | null;
  /** Who the browser is signed in as (a uid), and as what role. */
  who: string | null; role: Role;
  level: "nudge" | "lead" | "ops" | "info";
  endpoint: string;
  /** sent: the push service took it; gone: the browser unsubscribed; failed: anything else. */
  status: "sent" | "gone" | "failed";
  at: Date;
}

/** One update a Genesys floor's feed delivered, for source_event_stream. */
export interface SourceEvent {
  org: OrgId;
  at: Date;
  entityType: "agent" | "queue" | "system";
  /** The agent's uid, the queue's name, or "floor". */
  entityId: string;
  /** "state", "call.end", "aht", "counts" (one queue) or "queue" (the floor's numbers). */
  metric: string;
  value: string | null;
  /** The update as the feed delivered it. */
  payload?: unknown;
}

/** What the floor shows: a Genesys org's feed, or the simulator. */
export interface FloorChoice { source: FloorSource; org: OrgId }

// Every audited change takes `by`: who made it (a uid; null for an Admin or Senior Leader, who
// have no person) and as what role. It becomes audit_event.actor_id and actor_role.

export interface Store {
  readonly kind: "memory" | "postgres";
  /** The rules at their current versions, in the console's order, each with its current overrides. */
  loadRules(): Promise<Rule[]>;
  /** A rule's settings changed. Saved shortly after, as a new version; edits in quick succession become one. */
  ruleChanged(rule: Rule, by?: View | null): void;
  /**
   * A rule's override for one Tower, Sub-Tower or LOB changed. Saved shortly after, as a new version;
   * edits in quick succession become one. An override with no settings left removes it.
   */
  overrideChanged(ruleId: RuleId, override: RuleOverride, by?: View | null): void;

  /** Everything else the app needs at start-up. */
  loadBoot(): Promise<Omit<BootData, "rules">>;
  /** Replace the whole queue map. Resolves once it is kept, so the upload can say so. */
  saveQueueMap(rows: QueueMapRow[], by: View | null): Promise<void>;
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
  /** Someone switched the floor between orgs or to and from the simulator: an audit entry. */
  feedSwitched(from: FloorChoice, to: FloorChoice, by: View | null, at: Date): void;

  // A Genesys org's floor. `date` is the floor date (Eastern, YYYY-MM-DD) a record belongs to.
  /** The org's floor is on `date`: its shift starts, and the one before ends. */
  shiftStarted(org: OrgId, date: string): void;
  /** A call-out was raised, with the strike it counted and the incident it opened. */
  instanceFired(org: OrgId, date: string, rec: Instance, x: FiredInfo): void;
  /** Call-outs were acknowledged. Acknowledge all also leaves an audit entry. */
  instancesAcked(ns: number[], by: View | null, via: AckVia, at: Date): void;
  /** The agent attached a reason to a call-out. */
  instanceCommented(n: number, text: string, at: Date): void;
  /** An investigation moved, with an audit entry. */
  incidentMoved(i: Incident, action: InvAction, by: View | null, at: Date): void;
  /** The queue and system rules in breach changed (firedKeys() in lib/engine/record.ts). */
  floorFiredChanged(org: OrgId, date: string, keys: string[]): void;
  /** A desktop alert went to a browser. These gather and are written a few at a time. */
  notificationSent(e: NotificationSent): void;
  /** Updates a Genesys floor's feed delivered. They gather and are written about once a second. */
  eventsReceived(events: SourceEvent[]): void;
  /** A new floor day began at `since` (its midnight): the events from before it are emptied, for every org. */
  eventsCleared(since: Date): void;

  /** Write whatever is waiting. */
  flush(): Promise<void>;
  /** Write what is waiting, then let go of the database. */
  close(): Promise<void>;
}
