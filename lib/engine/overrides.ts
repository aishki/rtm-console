import type { QueueMapRow } from "@/lib/import/queueMap";
import { queueKey } from "@/lib/queueStats";
import type { Place, Rule, RuleOverride, RuleSettings } from "@/lib/types";

// Rule overrides by Tower, Sub-Tower and LOB. For each setting separately the most specific one
// that is set wins: the LOB's, else the Sub-Tower's, else the Tower's, else the rule's default.

export type PlaceLevel = "tower" | "subTower" | "lob";

export const levelOf = (p: Place): PlaceLevel => (p.lob ? "lob" : p.subTower ? "subTower" : "tower");
export const placeKey = (p: Place): string => `${p.tower}\u0000${p.subTower}\u0000${p.lob}`;
export const samePlace = (a: Place, b: Place): boolean => a.tower === b.tower && a.subTower === b.subTower && a.lob === b.lob;
/** "Provider › Claims › Local", or less for a Tower or Sub-Tower. */
export const placeLabel = (p: Place): string => [p.tower, p.subTower, p.lob].filter(Boolean).join(" › ");

/** True when an override set for `o` reaches `p`: the same place, or a Tower or Sub-Tower above it. */
function covers(o: Place, p: Place): boolean {
  if (o.tower !== p.tower) return false;
  if (!o.subTower) return true;
  if (o.subTower !== p.subTower) return false;
  return !o.lob || o.lob === p.lob;
}

const DEPTH: Record<PlaceLevel, number> = { tower: 0, subTower: 1, lob: 2 };
const SETTINGS = ["thr", "sev", "route", "on"] as const;

/** The rule as it applies at `place`: its default settings, with the overrides that reach the place laid over them. */
export function ruleFor(r: Rule, place: Place | null | undefined): Rule {
  if (!place || !r.overrides?.length) return r;
  const reaching = r.overrides.filter(o => covers(o, place));
  if (!reaching.length) return r;
  const out: Rule = { ...r };
  const set = out as unknown as Record<string, unknown>;
  for (const o of reaching.sort((a, b) => DEPTH[levelOf(a)] - DEPTH[levelOf(b)])) {
    for (const k of SETTINGS) if (o[k] !== undefined) set[k] = o[k];
  }
  return out;
}

/** Every rule as it applies at `place`. */
export const rulesAt = (rules: Rule[], place: Place | null | undefined): Rule[] => (place ? rules.map(r => ruleFor(r, place)) : rules);

export const hasSettings = (o: Partial<RuleSettings>): boolean => SETTINGS.some(k => o[k] !== undefined);

/** A change to the override at `place`: a value sets it, null takes it back to the level above. */
export type OverridePatch = { [K in keyof RuleSettings]?: RuleSettings[K] | null };

/** Apply `patch` to the rule's override at `place`. Returns the override as it now is, or null once it sets nothing. */
export function patchOverride(r: Rule, place: Place, patch: OverridePatch): RuleOverride | null {
  const list = (r.overrides ??= []);
  const at = list.findIndex(o => samePlace(o, place));
  const next: RuleOverride = at >= 0 ? { ...list[at] } : { tower: place.tower, subTower: place.subTower, lob: place.lob };
  const set = next as unknown as Record<string, unknown>;
  for (const k of SETTINGS) {
    if (patch[k] === null) delete set[k];
    else if (patch[k] !== undefined) set[k] = patch[k];
  }
  const keep = hasSettings(next);
  if (at >= 0) { if (keep) list[at] = next; else list.splice(at, 1); } else if (keep) list.push(next);
  if (!list.length) delete r.overrides;
  return keep ? next : null;
}

/** The places the mapping names: every Tower, Sub-Tower and LOB, in that order within each. */
export function placesIn(rows: QueueMapRow[]): Place[] {
  const out = new Map<string, Place>();
  const add = (p: Place) => { if (!out.has(placeKey(p))) out.set(placeKey(p), p); };
  for (const r of rows) {
    add({ tower: r.tower, subTower: "", lob: "" });
    add({ tower: r.tower, subTower: r.subTower, lob: "" });
    add({ tower: r.tower, subTower: r.subTower, lob: r.lob });
  }
  return [...out.values()];
}

/** The queue names in the mapping under `place`, as the mapping spells them, keyed for lookup. */
export function queueKeysUnder(rows: QueueMapRow[], place: Place): Set<string> {
  return new Set(rows.filter(r => covers(place, { tower: r.tower, subTower: r.subTower, lob: r.lob })).map(r => queueKey(r.queue)));
}

export interface Placement {
  /** Each placed agent's LOB, by engine id. */
  places: Map<number, Place>;
  /** Agents whose queues span more than one LOB, by engine id, with those LOBs, most queues first: they get the first. */
  severalLobs: { id: number; lobs: Place[] }[];
}

/**
 * Each agent's LOB from the mapping: the LOB with most of their queues, ties by LOB name (as the
 * database works it out). `members` is queue name to agent ids; an agent with no mapped queue has no place.
 */
export function placeAgents(rows: QueueMapRow[], members: Record<string, number[]>): Placement {
  const lobOf = new Map<string, Place>();
  for (const r of rows) if (!lobOf.has(queueKey(r.queue))) lobOf.set(queueKey(r.queue), { tower: r.tower, subTower: r.subTower, lob: r.lob });
  const counts = new Map<number, Map<string, { place: Place; n: number }>>();
  for (const [queue, ids] of Object.entries(members)) {
    const place = lobOf.get(queueKey(queue));
    if (!place) continue;
    const k = placeKey(place);
    for (const id of ids) {
      let byLob = counts.get(id);
      if (!byLob) counts.set(id, (byLob = new Map()));
      const c = byLob.get(k);
      if (c) c.n++; else byLob.set(k, { place, n: 1 });
    }
  }
  const places = new Map<number, Place>();
  const severalLobs: Placement["severalLobs"] = [];
  for (const [id, byLob] of counts) {
    const ranked = [...byLob.values()].sort((a, b) => b.n - a.n || a.place.lob.localeCompare(b.place.lob) || placeKey(a.place).localeCompare(placeKey(b.place)));
    places.set(id, ranked[0].place);
    if (ranked.length > 1) severalLobs.push({ id, lobs: ranked.map(c => c.place) });
  }
  return { places, severalLobs };
}
