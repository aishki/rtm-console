/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** What one conversation event changed for one agent. */
export interface CallChange {
  userId: string;
  /** The agent's call ended (connected -> disconnected). `durationSec` is connect to disconnect, hold included. */
  ended?: { transferred: boolean; durationSec?: number };
  /** Hold started or ended on the agent's call. `since` is when it started (epoch ms). */
  hold?: { on: boolean; since?: number };
  /** The agent's calls after this event: any call connected, and when the oldest pending after-call work began. */
  onCall: boolean;
  acwSince: number | null;
  /** The call was first seen in this event, so what it shows may have begun before the console connected. */
  first: boolean;
}

interface Leg { state?: string; held: boolean; acwSince: number | null; userId: string; at: number }

const ms = (s: unknown): number | undefined => {
  const v = typeof s === "string" ? Date.parse(s) : NaN;
  return Number.isFinite(v) ? v : undefined;
};

const ENDED = new Set(["disconnected", "terminated"]);
const PRUNE_AFTER_MS = 4 * 3600_000;

/**
 * Reads `v2.routing.queues.{id}.conversations` events. Each event is the whole conversation, sent
 * again on every change and once per watched queue it touches, so changes come from comparing
 * each agent's call (leg) with how it was last seen; a copy from a second queue changes nothing.
 *
 * Seen on the live floor (8 Oct 2026): a call goes alerting -> connected -> disconnected ->
 * terminated. `disconnectType` says who ended it (`peer`, `client`, `transfer`, `error`).
 * `held` flips with `startHoldTime`. After-call work is `afterCallWork.state` on the call:
 * `pending` from the disconnect (with `startTime`) until the wrap-up is in, then `complete`;
 * transfers mostly `skipped`. Routing status stays INTERACTING throughout, so ACW is only
 * visible here.
 */
export class CallTracker {
  private legs = new Map<string, Leg>();
  private events = 0;

  update(body: Json, now = Date.now()): CallChange[] {
    if (++this.events % 500 === 0) this.prune(now);
    const out: CallChange[] = [];
    const legChanges = new Map<string, Omit<CallChange, "onCall" | "acwSince">>();
    for (const p of (body?.participants ?? []) as Json[]) {
      if (p?.purpose !== "agent" || !p.userId) continue;
      const call: Json = (p.calls ?? []).at(-1);
      if (!call) continue;
      const key = `${body.id}/${p.id}`;
      const prev = this.legs.get(key);
      const state: string | undefined = call.state;
      // A call first seen already over happened before the console connected: nothing to learn.
      if (!prev && state === "terminated") continue;
      const held = state === "connected" && call.held === true;
      const acwSince = call.afterCallWork?.state === "pending" ? ms(call.afterCallWork.startTime) ?? now : null;
      const change: Omit<CallChange, "onCall" | "acwSince"> = { userId: p.userId, first: !prev };
      if (prev?.state === "connected" && state && ENDED.has(state)) {
        const conn = ms(call.connectedTime), disc = ms(call.disconnectedTime);
        change.ended = {
          transferred: call.disconnectType === "transfer",
          durationSec: conn !== undefined && disc !== undefined && disc >= conn ? (disc - conn) / 1000 : undefined,
        };
      }
      if (held !== (prev?.held ?? false)) change.hold = { on: held, since: held ? ms(call.startHoldTime) : undefined };
      const changed = !prev || change.ended || change.hold || prev.state !== state || prev.acwSince !== acwSince;
      if (state === "terminated") this.legs.delete(key);
      else this.legs.set(key, { state, held, acwSince, userId: p.userId, at: now });
      if (changed) legChanges.set(key, change);
    }
    for (const c of legChanges.values()) out.push({ ...c, ...this.summary(c.userId) });
    return out;
  }

  /** Every call the user has open right now. */
  summary(userId: string): { onCall: boolean; acwSince: number | null } {
    let onCall = false, acwSince: number | null = null;
    for (const l of this.legs.values()) {
      if (l.userId !== userId) continue;
      if (l.state === "connected") onCall = true;
      if (l.acwSince !== null && (acwSince === null || l.acwSince < acwSince)) acwSince = l.acwSince;
    }
    return { onCall, acwSince };
  }

  /** Legs that never reached terminated (a missed event) stop counting after a few hours. */
  private prune(now: number): void {
    for (const [k, l] of this.legs) if (now - l.at > PRUNE_AFTER_MS) this.legs.delete(k);
  }
}
