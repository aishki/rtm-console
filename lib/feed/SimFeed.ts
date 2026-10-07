import type { AgentState, AgentStateEvent, Queue, RuleId, Team } from "@/lib/types";
import type { FeedHandlers, FeedSource } from "./FeedSource";

// Stand-in for the Gencloud feed so the console moves without a live floor: organic state
// changes, a drifting queue, a few repeat offenders and one feed outage. It runs, in dev and
// production builds alike, at start with NEXT_PUBLIC_FEED=sim or when an admin switches the
// floor's data source to the simulation.

const FIRST = ["Amara", "Joshua", "Bea", "Miguel", "Katrina", "Paolo", "Lara", "Chris", "Ivy", "Dan", "Mika", "Ryan", "Cess", "Leo", "Trish", "Arvin", "Nina", "Jomar", "Ella", "Marc", "Faye", "Ken", "Rhea", "Toby", "Andrea", "Carlo", "Denise", "Enzo", "Gab", "Hazel", "Iris", "Jun", "Kim", "Liza", "Mae", "Noel", "Pia", "Raf", "Sam", "Tess"];
const LAST = ["Reyes", "Lim", "Santos", "Cruz", "Uy", "Dizon", "Mendoza", "Bautista", "Ramos", "Villanueva", "Torres", "Gomez", "Aquino", "Navarro", "Ocampo", "Salazar", "Castro", "Flores", "Domingo", "Rivera", "Soriano", "Padilla", "Velasco", "Manalo", "Garcia", "Tan", "Lopez", "Chua", "Morales", "Pascual"];
// Production-scale sample: 10 teams of 15–25 agents (199 total), 4 managers, 4 LOBs.
const ORG_DEFAULT: (Team & { size: number })[] = [
  { team: "Team Alpha", tl: "Rina Velasco", mgr: "Ava Santiago", lob: "PAP Intake", size: 22 },
  { team: "Team Bravo", tl: "Marco Tan", mgr: "Ava Santiago", lob: "PAP Intake", size: 18 },
  { team: "Team Charlie", tl: "Dess Aquino", mgr: "Ava Santiago", lob: "PAP Intake", size: 25 },
  { team: "Team Delta", tl: "Jon Rivera", mgr: "Leo Fernandez", lob: "Member Care", size: 16 },
  { team: "Team Echo", tl: "Grace Lim", mgr: "Leo Fernandez", lob: "Member Care", size: 20 },
  { team: "Team Foxtrot", tl: "Paulo Reyes", mgr: "Leo Fernandez", lob: "Member Care", size: 24 },
  { team: "Team Golf", tl: "Mia Cortez", mgr: "Carmela Diaz", lob: "Claims", size: 15 },
  { team: "Team Hotel", tl: "Ben Ocampo", mgr: "Carmela Diaz", lob: "Claims", size: 19 },
  { team: "Team India", tl: "Lea Soriano", mgr: "Ramon Villar", lob: "Provider Services", size: 23 },
  { team: "Team Juliet", tl: "Vic Mercado", mgr: "Ramon Villar", lob: "Provider Services", size: 17 },
];
function makeNames(n: number): string[] {
  const out: string[] = [], used = new Set<string>();
  for (let i = 0; out.length < n; i++) {
    const nm = FIRST[i % FIRST.length] + " " + LAST[(i * 7 + Math.floor(i / FIRST.length) * 3) % LAST.length];
    if (!used.has(nm)) { used.add(nm); out.push(nm); }
  }
  return out;
}

/** Who sits on the simulated floor. `real`: the names were borrowed from the Gencloud roster. */
export interface SimSeed { org: Team[]; seats: { name: string; team: string }[]; real: boolean }

function sampleSeed(): SimSeed {
  const seats = ORG_DEFAULT.flatMap(t => Array.from({ length: t.size }, () => t.team));
  const names = makeNames(seats.length);
  return { org: ORG_DEFAULT.map(({ team, tl, mgr, lob }) => ({ team, tl, mgr, lob })), seats: seats.map((team, i) => ({ name: names[i], team })), real: false };
}

/**
 * A floor of the simulator's usual shape (its ten team slots and their sizes) under real
 * names: the largest teams of the roster and the first agents of each. Where the roster has
 * no lead, manager or LOB for a team, the sample one stays. Null when the roster has nobody.
 */
export function seedFromRoster(roster: { org: Team[]; agents: { name: string; team: string }[] } | null): SimSeed | null {
  if (!roster) return null;
  const byTeam = new Map<string, string[]>(), used = new Set<string>();
  for (const a of roster.agents) {
    // The engine tells agents apart by name.
    if (used.has(a.name)) continue;
    used.add(a.name);
    byTeam.set(a.team, [...(byTeam.get(a.team) ?? []), a.name]);
  }
  const teams = roster.org.filter(t => byTeam.has(t.team)).sort((a, b) => byTeam.get(b.team)!.length - byTeam.get(a.team)!.length).slice(0, ORG_DEFAULT.length);
  if (!teams.length) return null;
  return {
    org: teams.map((t, i) => ({ team: t.team, tl: t.tl || ORG_DEFAULT[i].tl, mgr: t.mgr || ORG_DEFAULT[i].mgr, lob: t.lob && t.lob !== t.team ? t.lob : ORG_DEFAULT[i].lob })),
    seats: teams.flatMap((t, i) => byTeam.get(t.team)!.slice(0, ORG_DEFAULT[i].size).map(name => ({ name, team: t.team }))),
    real: true,
  };
}

type Rogue = "acw" | "aux" | "break" | "short" | "off" | "hold";
const ROGUE_STATE: Partial<Record<Rogue, AgentState>> = { acw: "acw", aux: "auxp", break: "auxb", off: "off" };
const ROGUE_RULE: Partial<Record<Rogue, RuleId>> = { short: "short", hold: "hold", acw: "acw" };

interface SimAgent { name: string; team: string; state: AgentState; stTime: number; onHold: boolean; holdTime: number; rogue: Rogue | null }

/** What the simulator reads back from the engine: live thresholds and strike counts. */
export interface SimProbe {
  thr(id: RuleId): number;
  strikes(agent: string, id: RuleId): number;
}

export class SimFeed implements FeedSource {
  readonly kind = "sim" as const;
  private h: FeedHandlers | null = null;
  private agents: SimAgent[] = [];
  private queue: Queue = { cq: 3, sl: 92, asa: 18, ab: 2 };
  private outage = 0;
  /** Engine second at which the feed goes silent for a while. */
  outageAt = -1;

  constructor(private readonly probe: SimProbe, private readonly rnd: () => number = Math.random, readonly seed: SimSeed = sampleSeed()) {}

  subscribe(handlers: FeedHandlers): () => void {
    this.h = handlers;
    const { org, seats } = this.seed;
    const roster = seats.map(({ name, team }, i) => ({
      name, team,
      state: (i % 12 === 11 ? "off" : this.rnd() < 0.55 ? "oncall" : "avail") as AgentState,
      stTime: Math.floor(this.rnd() * 200), aht: 380 + Math.floor(this.rnd() * 160),
      calls: Math.floor(this.rnd() * 8), adh: 93 + Math.floor(this.rnd() * 7),
    }));
    this.agents = roster.map(a => ({ name: a.name, team: a.team, state: a.state, stTime: a.stTime, onHold: false, holdTime: 0, rogue: null }));
    handlers.onRoster({ org, agents: roster });
    return () => { this.h = null; };
  }

  tick(t: number): void {
    if (!this.h) return;
    if (this.outage === 0 && t === this.outageAt) this.outage = 44;
    if (this.outage > 0) { this.outage--; return; } // silent: no events, no heartbeat
    for (const a of this.agents) this.tickAgent(a);
    this.tickQueue();
    this.maybeRogue(t);
    this.h.onQueue({ ...this.queue });
    this.h.onHeartbeat();
  }

  private emit(e: AgentStateEvent) { this.h?.onAgentState(e); }
  private toState(a: SimAgent, s: AgentState, callEnded?: AgentStateEvent["callEnded"]) {
    if (a.state === s && !callEnded) return;
    if (a.state === "oncall" && s !== "oncall") { a.onHold = false; a.holdTime = 0; }
    a.state = s; a.stTime = 0;
    this.emit({ agent: a.name, state: s, callEnded });
  }
  private setHold(a: SimAgent, on: boolean) {
    a.onHold = on; a.holdTime = 0;
    this.emit({ agent: a.name, state: a.state, onHold: on });
  }
  private endCall(a: SimAgent) { this.toState(a, "acw", { transferred: this.rnd() < 0.1 }); }

  private tickAgent(a: SimAgent) {
    const thr = this.probe.thr;
    a.stTime++;
    const r = this.rnd();
    switch (a.state) {
      case "avail": if (r < (this.queue.cq > 6 ? 0.2 : 0.06)) this.toState(a, "oncall"); break;
      case "oncall":
        if (a.onHold) {
          a.holdTime++;
          const done = a.rogue === "hold" ? (a.holdTime > thr("hold") * 1.6 && r < 0.05) : (a.holdTime > 25 && r < 0.08);
          if (done) this.setHold(a, false);
        } else if (r < (a.rogue === "hold" ? 0.012 : 0.0015)) this.setHold(a, true);
        if (a.rogue === "short") { if (a.stTime > 8 && r < 0.14) this.endCall(a); }
        else if (a.stTime > 120 && r < 0.012 && !a.onHold) this.endCall(a);
        else if (!a.rogue && a.stTime > 15 && r < 0.0018) this.endCall(a);
        break;
      case "outb": if (a.stTime > 120 && r < 0.02) this.endCall(a); break;
      case "acw":
        if (a.rogue === "acw") { if (a.stTime > thr("acw") * 1.8 && r < 0.05) this.toState(a, "avail"); }
        else if (a.stTime > 25 && r < 0.09) this.toState(a, "avail");
        break;
      case "auxb":
        if (a.rogue === "break") { if (a.stTime > thr("ovbrk") * 1.5 && r < 0.04) { this.toState(a, "avail"); a.rogue = null; } }
        else if (a.stTime > 300 && r < 0.05) this.toState(a, "avail");
        break;
      case "auxp":
        if (a.rogue === "aux") { if (a.stTime > thr("auxp") * 1.7 && r < 0.04) { this.toState(a, "avail"); a.rogue = null; } }
        else if (a.stTime > 140 && r < 0.06) this.toState(a, "avail");
        break;
      case "off":
        if (a.rogue === "off") { if (a.stTime > thr("offl") * 1.6 && r < 0.03) { this.toState(a, "avail"); a.rogue = null; } }
        else if (r < 0.004) this.toState(a, "avail");
        break;
    }
    if (a.state !== "off") {
      if (r > 0.9988) this.toState(a, "auxb");
      if (a.state === "avail" && !a.rogue && r > 0.9979) this.toState(a, "auxp");
      if (a.state === "avail" && !a.rogue && r > 0.99965) this.toState(a, "off");
      if (a.state === "avail" && !a.rogue && this.rnd() < 0.0009) this.toState(a, "outb");
    }
    if (a.rogue && a.state === "avail" && r < 0.05) {
      if (a.rogue === "hold") { this.toState(a, "oncall"); this.setHold(a, true); }
      else if (a.rogue !== "short") this.toState(a, ROGUE_STATE[a.rogue]!);
    }
    // short/hold/acw rogues have no natural exit; retire them after a few strikes
    const rr = a.rogue ? ROGUE_RULE[a.rogue] : undefined;
    if (rr && this.probe.strikes(a.name, rr) >= 4) a.rogue = null;
  }

  private tickQueue() {
    const q = this.queue, rnd = this.rnd;
    q.cq = Math.max(0, Math.round((q.cq + (rnd() - 0.5) * 1.4 - (q.cq > 5 ? 0.35 : 0)) * 10) / 10);
    if (rnd() < 0.004) q.cq += 7;
    q.sl = Math.max(45, Math.min(99, q.sl + (q.cq > this.probe.thr("cq") ? -0.5 : 0.25) * (rnd() + 0.4)));
    q.asa = Math.max(5, Math.round(q.asa + (q.cq > 5 ? 1.4 : -0.8) * rnd()));
    q.ab = Math.max(0, Math.min(25, q.ab + (q.cq > 6 ? 0.3 : -0.18) * (rnd() + 0.3)));
  }

  /** Organic repeat behaviour so the escalation ladder shows up without any demo controls. */
  private maybeRogue(t: number) {
    if (t % 60 !== 0) return;
    const c = this.agents.filter(a => !a.rogue && a.state !== "off");
    if (!c.length || this.agents.filter(a => a.rogue).length >= 4) return;
    const a = c[Math.floor(this.rnd() * c.length)];
    const kind = (["acw", "aux", "break", "short", "off", "hold"] as Rogue[])[Math.floor(this.rnd() * 6)];
    a.rogue = kind;
    if (kind === "short") this.toState(a, "oncall");
    else if (kind === "hold") { this.toState(a, "oncall"); this.setHold(a, true); }
    else this.toState(a, ROGUE_STATE[kind]!);
  }
}
