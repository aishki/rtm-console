import type { Incident, Instance, InvAction, Place, RuleId, View } from "@/lib/types";

// What the engine tells whoever keeps its records (the store, for a Genesys floor). The engine
// calls these as things happen and never waits on them; a floor without a recorder keeps nothing.

/** How a call-out was acknowledged: in the console, from a desktop alert, or by Acknowledge all. */
export type AckVia = "console" | "push" | "ack_all";

export interface Recorder {
  /**
   * A call-out was raised. `thr` is the threshold that applied; `overrideAt` the place of the most
   * specific override that applied, null for the rule's defaults; `incident` the one it opened.
   */
  fired(rec: Instance, x: { thr: number; overrideAt: Place | null; incident: Incident | null }): void;
  /** Call-outs were acknowledged by `by`: who and as what role (null when nobody is known). */
  acked(recs: Instance[], by: View | null, via: AckVia): void;
  /** The agent attached a reason. */
  commented(rec: Instance): void;
  /** An investigation moved: started, sent back to Open, a disposition recorded, or closed. */
  incidentMoved(i: Incident, action: InvAction, by: View | null): void;
  /** The queue and system rules in breach changed (see firedKeys). */
  floorFired(keys: string[]): void;
}

/** An agent's calls today, rebuilt from the day's raw events after a restart. */
export interface DayCalls {
  calls: number;
  transfers: number;
  /** Short calls: today's short-call call-outs. */
  shortCalls: number;
  /** Average length of today's calls in seconds, to start AHT from until Genesys's own figure arrives; null without lengths. */
  aht: number | null;
}

/** A floor's records as they were saved, to carry on from after a restart. */
export interface SavedFloor {
  /** The floor date (Eastern) the strikes and the rules in breach are for. */
  date: string;
  /** Today's call-outs and every open one from earlier days, newest first. */
  ledger: Instance[];
  /** Today's incidents and every one not closed, newest first. */
  incidents: Incident[];
  /** Today's strikes, by agent uid. */
  strikes: Record<string, Partial<Record<RuleId, number>>>;
  /** The queue and system rules in breach (see firedKeys). */
  floorFired: string[];
  /** Today's calls, by agent uid (from source_event_stream). */
  calls?: Record<string, DayCalls>;
}

/**
 * The queue and system rules in breach, as text that can be saved: "cq" for the whole floor, or
 * "cq@" and the group as JSON, ["Tower","Sub-Tower","LOB"].
 */
export function firedKeys(floor: Partial<Record<RuleId, boolean>>, group: Record<string, boolean>): string[] {
  const out = Object.entries(floor).filter(([, on]) => on).map(([id]) => id);
  // A group's key is the rule id, "|" and placeKey(): the place's three names joined by NUL, which text columns refuse.
  for (const [key, on] of Object.entries(group)) {
    if (!on) continue;
    const bar = key.indexOf("|");
    out.push(`${key.slice(0, bar)}@${JSON.stringify(key.slice(bar + 1).split("\u0000"))}`);
  }
  return out.sort();
}

/** firedKeys read back: the floor's rules, and each group's as rule id and place. */
export function readFiredKeys(keys: string[]): { floor: RuleId[]; groups: { id: RuleId; place: Place }[] } {
  const floor: RuleId[] = [], groups: { id: RuleId; place: Place }[] = [];
  for (const k of keys) {
    const at = k.indexOf("@");
    if (at < 0) { floor.push(k as RuleId); continue; }
    try {
      const [tower, subTower, lob] = JSON.parse(k.slice(at + 1)) as string[];
      if (typeof tower === "string") groups.push({ id: k.slice(0, at) as RuleId, place: { tower, subTower: subTower ?? "", lob: lob ?? "" } });
    } catch { /* not ours: skip */ }
  }
  return { floor, groups };
}
