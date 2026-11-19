import type { EngineState } from "@/lib/engine/escalation";
import { chainAbove } from "@/lib/engine/scope";
import type { Engine } from "@/lib/engine/engine";
import type { FeedSource } from "@/lib/feed/FeedSource";
import { simulateReplies } from "@/lib/feed/SimFeed";
import type { Instance, Perms, Role, RuleId } from "@/lib/types";
import type { Runtime } from "./runtime";

// The demo floor's pieces that do not need the server: who the presenter's cues move, and the
// warm-up that makes the floor look a few hours into a shift.

/** The rule the presenter's cues breach: Overbreak, "a break that runs too long". */
export const CUE_RULE: RuleId = "ovbrk";
/** How far past the limit a cued break already is when the call-out fires. */
export const CUE_OVER = 47;
/** Floor time the warm-up covers: the shift opens at 08:00 and the demo at about 11:00. */
export const WARM_SECONDS = 3 * 3600;
export const SHIFT_START = 8 * 3600;
/** Ticks per chunk of warm-up; the server answers requests between chunks. */
const CHUNK = 20;

/** What the server keeps about a demo floor. */
export interface DemoState {
  /** The agent the cues move, by uid. */
  cueAgent: string | null;
  /** True while the warm-up runs: the floor is not shown as ready and cues are refused. */
  warming: boolean;
}

/**
 * The agent the cues move: on the largest team, the first by name who is working, has no Overbreak
 * strike yet and is not `exclude` (the last cue agent). Null when nobody fits.
 */
export function pickCueAgent(S: Pick<EngineState, "agents">, exclude?: string | null): string | null {
  const size = new Map<string, number>();
  for (const a of S.agents) size.set(a.team, (size.get(a.team) ?? 0) + 1);
  const fits = S.agents
    .filter(a => a.uid !== exclude && a.state !== "off" && !(a.strikes[CUE_RULE] ?? 0))
    .sort((a, b) => (size.get(b.team)! - size.get(a.team)!) || a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  return fits[0]?.uid ?? null;
}

/**
 * The presenter on the demo floor: anyone who may switch the floor (Admin) while it is the demo.
 * With `rec`, only for the cue agent's call-outs: the presenter answers the nudge for them.
 */
export function isDemoPresenter(rt: Runtime, perms: Pick<Perms, "feed">, rec?: Pick<Instance, "agentId"> | null): boolean {
  const demo = (rt as Runtime & { demo?: DemoState }).demo;
  if (!demo || rt.feed.kind !== "demo" || !perms.feed) return false;
  return !rec || (!!demo.cueAgent && rec.agentId === demo.cueAgent);
}

/**
 * Who may press the cue keys on the demo floor: an Admin, or anyone while "View as" is on (they can
 * switch to Admin anyway), so the presenter keeps the keys after switching to an agent or a leader.
 */
export function canCue(rt: Runtime, perms: Pick<Perms, "feed">, viewAs: boolean): boolean {
  return rt.feed.kind === "demo" && (perms.feed || viewAs);
}

/**
 * On the demo floor, whom a "View as" role switch lands on when no person was picked: the cue agent
 * for Agent, their Team Lead for Team Lead, their Manager for Manager, so each step of the walk shows
 * the same story. Null for other roles, off the demo floor, or before there is a cue agent.
 */
export function demoViewWho(rt: Runtime, role: Role): string | null {
  const cue = (rt as Runtime & { demo?: DemoState }).demo?.cueAgent;
  if (rt.feed.kind !== "demo" || !cue) return null;
  if (role === "agent") return cue;
  const chain = chainAbove(rt.engine.S.people, cue);
  return (role === "tl" ? chain[0] : role === "mgr" ? chain[1] : null) ?? null;
}

/** The cue agent's name, for the presenter. */
export const cueAgentName = (rt: Runtime): string | null => {
  const uid = (rt as Runtime & { demo?: DemoState }).demo?.cueAgent;
  return (uid && rt.engine.S.agents.find(a => a.uid === uid)?.name) || null;
};

/** Leaders acknowledge about this share of earlier call-outs during the warm-up. */
const ACK_SHARE = 0.6;

/**
 * Run `seconds` of floor time quietly, in chunks, so the floor carries a shift's history: call-outs
 * (most acknowledged), agents' reasons and incidents. Stops early once `isStopped()` is true.
 * The floor shows as loading until it is done.
 */
export async function warmInChunks(rt: { engine: Engine; feed: FeedSource }, seconds: number, isStopped: () => boolean, rnd: () => number = Math.random): Promise<void> {
  const { engine, feed } = rt;
  const S = engine.S;
  S.quiet = true;
  S.agentsLoading = true;
  const acked = (rows: Instance[], seen: number) => {
    for (const r of rows) {
      if (r.n <= seen) break;
      if (rnd() < ACK_SHARE) { r.status = "acked"; r.ackT = r.t + 8 + Math.floor(rnd() * 70); }
    }
  };
  try {
    for (let done = 0; done < seconds && !isStopped();) {
      for (const end = Math.min(seconds, done + CHUNK); done < end; done++) {
        const seen = S.seq;
        feed.tick?.(S.t + 1);
        engine.tick();
        simulateReplies(S, engine.comment, rnd);
        acked(S.ledger, seen);
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  } finally {
    S.quiet = false;
    S.agentsLoading = false;
    engine.rearm();
  }
}
