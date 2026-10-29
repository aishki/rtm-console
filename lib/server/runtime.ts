import type { FloorSource, NudgeEvent, Rule, ToastEvent } from "@/lib/types";
import type { ReplayEvent } from "@/lib/csv/parse";
import { type Engine, type EngineOptions, createEngine } from "@/lib/engine/engine";
import { type IncidentCounter, type IncidentSeq, incidentCounter } from "@/lib/engine/escalation";
import { defaultRules } from "@/lib/engine/rules";
import type { FeedSource } from "@/lib/feed/FeedSource";
import { CsvReplayFeed, REPLAY_SPEED, type ReplayExtras } from "@/lib/feed/CsvReplayFeed";
import { type GencloudConfig, GencloudFeed } from "@/lib/feed/GencloudFeed";
import { type SimSeed, SimFeed, seedFromRoster, simulateReplies } from "@/lib/feed/SimFeed";
import { pushBatch } from "./push";
import { loadRoster, saveRoster } from "./rosterCache";
import { loadQueueMap } from "./queueMapStore";
import { genesysToken, loadActiveOrg, saveActiveOrg } from "./tokenStore";
import { type OrgId, orgOf, queueNamesFor } from "@/lib/orgs";
import { floorDate, floorSeconds } from "@/lib/floorTime";

// Server-side home of the rules engine. One live runtime serves the whole floor; a CSV
// replay gets its own runtime per session so reviewing history never disturbs the live feed.
// An Admin can switch the floor between the Gencloud feed and the simulator.
// State is in memory, so this needs a single long-lived Node process (not serverless).

/** Notifications raised since the last publish. */
export interface Batch { toasts: ToastEvent[]; nudges: NudgeEvent[] }
type Listener = (batch: Batch) => void;

export interface Runtime {
  readonly kind: "live" | "replay";
  readonly engine: Engine;
  readonly feed: FeedSource;
  subscribe(fn: Listener): () => void;
  /** Push the current state to every subscriber now (call after a mutation). */
  publish(): void;
  /** The agent's latest nudge while it is still unacknowledged: shown again when they open the console. */
  pendingNudge(agent: string): NudgeEvent | null;
  /** Drop the feed's connection and open a fresh one. The engine's floor, ledger and strikes are kept. */
  restartFeed(): void;
  /** The Genesys org a Gencloud floor watches. */
  readonly genesysOrg?: OrgId;
  stop(): void;
}

const WARM_SECONDS = 900;
const MAX_REPLAYS = 8;

function createRuntime(kind: Runtime["kind"], rules: Rule[], speed: number, engineOpts: Omit<EngineOptions, "rules">, makeFeed: (engine: Engine) => FeedSource, prepare: (engine: Engine, feed: FeedSource) => void, afterTick?: (engine: Engine) => void): Runtime {
  const listeners = new Set<Listener>();
  const lastNudge = new Map<string, NudgeEvent>();
  let batch: Batch = { toasts: [], nudges: [] };
  const engine = createEngine({ toast: e => batch.toasts.push(e), nudge: e => batch.nudges.push(e) }, { rules, ...engineOpts });
  const feed = makeFeed(engine);
  prepare(engine, feed);
  let unsubscribe = feed.subscribe(engine.ingest);

  const publish = () => {
    const out = batch;
    batch = { toasts: [], nudges: [] };
    for (const e of out.nudges) lastNudge.set(e.agent, e);
    for (const fn of listeners) fn(out);
  };
  const step = () => {
    for (let i = 0; i < speed; i++) { feed.tick?.(engine.S.t + 1); engine.tick(); afterTick?.(engine); }
    publish();
    if (engine.S.replay?.done) clearInterval(timer);
  };
  const timer = setInterval(step, 1000);
  timer.unref?.();

  return {
    kind, engine, feed, publish,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    pendingNudge(agent) {
      const e = lastNudge.get(agent);
      return e && engine.S.ledger.some(r => r.n === e.n && r.agent === agent && r.status === "open") ? e : null;
    },
    restartFeed() { unsubscribe(); unsubscribe = feed.subscribe(engine.ingest); },
    stop() { clearInterval(timer); unsubscribe(); listeners.clear(); },
  };
}

/** Keeps the org's real roster on disk, so its floor starts from it next time and the simulator can use its names. */
const remembering = (feed: FeedSource, org: OrgId): FeedSource => ({
  kind: feed.kind,
  subscribe: h => feed.subscribe({ ...h, onRoster(r) { saveRoster(r, org); h.onRoster(r); } }),
});

/** Where an org's API is. GENCLOUD_API_BASE can still move Commercial's. */
export const orgApiBase = (org: OrgId): string => (org === "commercial" && process.env.GENCLOUD_API_BASE) || orgOf(org).apiBase;

/**
 * How an org's live feed reaches Genesys. The token check on /admin/token uses it too. The saved
 * view (RTM_VIEW_CONFIG_ID) is a Commercial view, the fallback while its queue map is empty.
 */
export const gencloudConfig = (org: OrgId): GencloudConfig => ({
  apiBase: orgApiBase(org), getToken: () => genesysToken(org),
  viewConfigId: org === "commercial" ? process.env.RTM_VIEW_CONFIG_ID : "",
  getQueueNames: () => queueNamesFor(loadQueueMap(), org),
  clientId: process.env.GENCLOUD_CLIENT_ID, clientSecret: process.env.GENCLOUD_CLIENT_SECRET,
});

function createGencloud(rules: Rule[], org: OrgId, incidents: IncidentCounter): Runtime {
  // The shift clock reads the floor's time (US Eastern), not the server's.
  const t = floorSeconds(new Date());
  let day = floorDate(new Date());
  // At midnight Eastern a new day starts: strikes and the day's counters go back to zero; call-outs and incidents stay.
  const rollover = (engine: Engine) => {
    const now = new Date();
    const today = floorDate(now);
    if (today !== day) { day = today; engine.newDay(floorSeconds(now)); }
  };
  const rt = createRuntime("live", rules, 1, { incidents }, () => remembering(new GencloudFeed(gencloudConfig(org)), org), engine => {
    engine.reset({ t });
    // Loading the roster takes minutes for hundreds of queues: start from the one saved last
    // time, everyone Offline until their state arrives. The feed marks the floor as loading.
    const saved = loadRoster(org);
    if (saved) engine.ingest.onRoster({ org: saved.org, agents: saved.agents.map(a => ({ ...a, state: "off" })), members: saved.members });
  }, rollover);
  return { ...rt, genesysOrg: org };
}

function createSim(rules: Rule[], seed: SimSeed | undefined): Runtime {
  const rt = createRuntime("live", rules, 1, { deriveAdh: true },
    engine => new SimFeed({ thr: engine.thr, strikes: (name, id) => engine.S.agents.find(a => a.name === name)?.strikes[id] ?? 0 }, Math.random, seed),
    engine => engine.reset({ t: 8 * 3600 }), // 08:00 shift start
    engine => simulateReplies(engine.S, engine.comment),
  );
  warm(rt);
  return rt;
}

/** Simulator only: start mid-shift so dashboards carry history on first paint. */
function warm({ engine, feed }: Runtime) {
  const S = engine.S;
  S.quiet = true;
  for (let i = 0; i < WARM_SECONDS; i++) {
    const seen = S.seq;
    feed.tick?.(S.t + 1);
    engine.tick();
    simulateReplies(S, engine.comment);
    // Leaders acknowledged most of the earlier call-outs.
    for (const r of S.ledger) {
      if (r.n <= seen) break;
      if (Math.random() < 0.6) { r.status = "acked"; r.ackT = r.t + 8 + Math.floor(Math.random() * 70); }
    }
  }
  S.quiet = false;
  engine.rearm();
  (feed as SimFeed).outageAt = S.t + 240;
}

interface Registry {
  rules: Rule[];
  /** Which floor everyone is looking at: a Genesys org's, or the simulator. */
  source: FloorSource;
  /** The org Gencloud shows. Kept while the simulator is on. */
  org: OrgId;
  /** The simulator, while it is on. */
  floors: { sim?: Runtime };
  /** Each org's floor, from its first use on. One that is not on screen keeps running. */
  orgs: Partial<Record<OrgId, Runtime>>;
  replays: Map<string, Runtime>;
  watchers: Set<() => void>;
  /** The last incident number handed out, and its year. One counter for every org's floor, so numbers never repeat. */
  incidentSeq: IncidentSeq;
}
const g = globalThis as typeof globalThis & { __rtmRegistry?: Registry };
const registry: Registry = (g.__rtmRegistry ??= {
  rules: defaultRules(), source: process.env.NEXT_PUBLIC_FEED === "sim" ? "sim" : "gencloud", org: loadActiveOrg(),
  floors: {}, orgs: {}, replays: new Map(), watchers: new Set(), incidentSeq: { year: 0, n: 0 },
});
// A registry from before there were several orgs (a dev reload) gets the new fields.
registry.org ??= loadActiveOrg();
registry.orgs ??= {};
// A registry from before numbers carried their year (a dev reload) held a plain count.
if (typeof registry.incidentSeq !== "object" || registry.incidentSeq === null) registry.incidentSeq = { year: 0, n: 0 };
const sharedIncidents: IncidentCounter = incidentCounter(registry.incidentSeq);

/** The floor on screen, if it is running. */
const onScreen = (): Runtime | undefined => (registry.source === "sim" ? registry.floors.sim : registry.orgs[registry.org]);

/** Real names for the simulator: from the org's running floor, else from the roster it last delivered. */
function realSeed(): SimSeed | undefined {
  const floor = registry.orgs[registry.org]?.engine.S;
  return (floor && seedFromRoster(floor)) ?? seedFromRoster(loadRoster(registry.org)) ?? undefined;
}

/** The floor everyone is looking at: the org's Gencloud feed, or the simulator when it is switched on. */
export function liveRuntime(): Runtime {
  const running = onScreen();
  if (running) return running;
  const rt = registry.source === "sim"
    ? (registry.floors.sim = createSim(registry.rules, realSeed()))
    : (registry.orgs[registry.org] = createGencloud(registry.rules, registry.org, sharedIncidents));
  // Desktop alerts reach people who have no stream open (browser minimized or closed).
  // Only the floor on screen alerts: the other orgs, and Gencloud behind a simulation, keep running quietly.
  rt.subscribe(batch => { if (onScreen() === rt) pushBatch(rt.engine.S, batch); });
  return rt;
}

/** Which data source the floor is on. */
export const floorSource = (): FloorSource => registry.source;

/** The org Gencloud shows (also while the simulator is on). */
export const activeOrg = (): OrgId => registry.org;

/**
 * Switch the floor for everyone: to an org's Gencloud feed, or to the simulator. An org's feed
 * keeps running once started, so its ledger, strikes and roster are there on the way back; a
 * simulation starts fresh each time. The org is remembered across restarts.
 */
export function setFloorSource(source: FloorSource, org: OrgId = registry.org): Runtime {
  if (source === registry.source && org === registry.org) return liveRuntime();
  if (registry.source === "sim" && source !== "sim") { registry.floors.sim?.stop(); delete registry.floors.sim; }
  registry.source = source;
  if (org !== registry.org) { registry.org = org; saveActiveOrg(org); }
  const rt = liveRuntime();
  for (const fn of [...registry.watchers]) fn();
  return rt;
}

/**
 * Reconnect an org's Gencloud feed after its token was replaced, or every running org's after the
 * queue map changed. An org that is not running picks the change up when it starts.
 */
export function restartGencloud(org?: OrgId): void {
  for (const [id, rt] of Object.entries(registry.orgs)) if (!org || id === org) rt?.restartFeed();
}

/** Told after the floor's data source was switched. Returns an unsubscribe function. */
export function onFloorChange(fn: () => void): () => void {
  registry.watchers.add(fn);
  return () => { registry.watchers.delete(fn); };
}

/** The runtime a session is looking at: its own replay when one is running, otherwise the live floor. */
export function runtimeFor(sid: string): Runtime {
  return registry.replays.get(sid) ?? liveRuntime();
}

/** Start replaying an export for this session, through the same rule configuration as the live floor. */
export function startReplay(sid: string, events: ReplayEvent[], extras: ReplayExtras = {}): Runtime {
  exitReplay(sid);
  if (registry.replays.size >= MAX_REPLAYS) exitReplay(registry.replays.keys().next().value!);
  const rt = createRuntime("replay", registry.rules, REPLAY_SPEED, { deriveAdh: true }, () => new CsvReplayFeed(events, extras), (engine, feed) => {
    const csv = feed as CsvReplayFeed;
    engine.reset({ t: csv.startT, mode: "replay", replay: csv.meta });
  });
  registry.replays.set(sid, rt);
  return rt;
}

export function exitReplay(sid: string): boolean {
  const rt = registry.replays.get(sid);
  if (!rt) return false;
  rt.stop();
  registry.replays.delete(sid);
  return true;
}

/** Rule configuration is shared, so a rules change is pushed to every runtime's subscribers. */
export function publishAll(): void {
  for (const rt of Object.values(registry.floors)) rt.publish();
  for (const rt of registry.replays.values()) rt.publish();
}
