import type { FloorSource, NudgeEvent, Rule, ToastEvent } from "@/lib/types";
import type { ReplayEvent } from "@/lib/csv/parse";
import { type Engine, createEngine } from "@/lib/engine/engine";
import { defaultRules } from "@/lib/engine/rules";
import type { FeedSource } from "@/lib/feed/FeedSource";
import { CsvReplayFeed, REPLAY_SPEED, type ReplayExtras } from "@/lib/feed/CsvReplayFeed";
import { GencloudFeed } from "@/lib/feed/GencloudFeed";
import { type SimSeed, SimFeed, seedFromRoster } from "@/lib/feed/SimFeed";
import { pushBatch } from "./push";
import { loadRoster, saveRoster } from "./rosterCache";
import { genesysToken } from "./tokenStore";

// Server-side home of the rules engine. One live runtime serves the whole floor; a CSV
// replay gets its own runtime per session so reviewing history never disturbs the live feed.
// Outside production the floor can be switched between the Gencloud feed and the simulator.
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
  stop(): void;
}

/** The simulator is a dev tool: it never runs in a production build. */
export const SIM_ALLOWED = process.env.NODE_ENV !== "production";

const WARM_SECONDS = 900;
const MAX_REPLAYS = 8;

function createRuntime(kind: Runtime["kind"], rules: Rule[], speed: number, deriveAdh: boolean, makeFeed: (engine: Engine) => FeedSource, prepare: (engine: Engine, feed: FeedSource) => void): Runtime {
  const listeners = new Set<Listener>();
  const lastNudge = new Map<string, NudgeEvent>();
  let batch: Batch = { toasts: [], nudges: [] };
  const engine = createEngine({ toast: e => batch.toasts.push(e), nudge: e => batch.nudges.push(e) }, { rules, deriveAdh });
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
    for (let i = 0; i < speed; i++) { feed.tick?.(engine.S.t + 1); engine.tick(); }
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

/** Keeps the real roster on disk, so the simulator can use its names when Gencloud is away. */
const remembering = (feed: FeedSource): FeedSource => ({
  kind: feed.kind,
  subscribe: h => feed.subscribe({ ...h, onRoster(r) { saveRoster(r); h.onRoster(r); } }),
});

function createGencloud(rules: Rule[]): Runtime {
  const now = new Date();
  const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return createRuntime("live", rules, 1, false, () => {
    const feed = new GencloudFeed({
      apiBase: process.env.GENCLOUD_API_BASE, getToken: genesysToken, viewConfigId: process.env.RTM_VIEW_CONFIG_ID, clientId: process.env.GENCLOUD_CLIENT_ID, clientSecret: process.env.GENCLOUD_CLIENT_SECRET,
    });
    return SIM_ALLOWED ? remembering(feed) : feed;
  }, engine => engine.reset({ t }));
}

function createSim(rules: Rule[], seed: SimSeed | undefined): Runtime {
  const rt = createRuntime("live", rules, 1, true,
    engine => new SimFeed({ thr: engine.thr, strikes: (name, id) => engine.S.agents.find(a => a.name === name)?.strikes[id] ?? 0 }, Math.random, seed),
    engine => engine.reset({ t: 8 * 3600 }), // 08:00 shift start
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
  /** Which floor everyone is looking at. */
  source: FloorSource;
  floors: Partial<Record<FloorSource, Runtime>>;
  replays: Map<string, Runtime>;
  watchers: Set<() => void>;
}
const g = globalThis as typeof globalThis & { __rtmRegistry?: Registry };
const registry: Registry = (g.__rtmRegistry ??= {
  rules: defaultRules(), source: SIM_ALLOWED && process.env.NEXT_PUBLIC_FEED === "sim" ? "sim" : "gencloud",
  floors: {}, replays: new Map(), watchers: new Set(),
});

/** Real names for the simulator: from the running Gencloud floor, else from the roster it last delivered. */
function realSeed(): SimSeed | undefined {
  const floor = registry.floors.gencloud?.engine.S;
  return (floor && seedFromRoster(floor)) ?? seedFromRoster(loadRoster()) ?? undefined;
}

/** The floor everyone is looking at: the Gencloud feed, or the simulator when it is switched on. */
export function liveRuntime(): Runtime {
  const source = registry.source;
  const running = registry.floors[source];
  if (running) return running;
  const rt = (registry.floors[source] = source === "sim" ? createSim(registry.rules, realSeed()) : createGencloud(registry.rules));
  // Desktop alerts reach people who have no stream open (browser minimized or closed).
  // Only the floor on screen alerts: Gencloud keeps running behind a simulation.
  rt.subscribe(batch => { if (registry.floors[registry.source] === rt) pushBatch(rt.engine.S, batch); });
  return rt;
}

/** Which data source the floor is on. */
export const floorSource = (): FloorSource => registry.source;

/**
 * Switch the floor for everyone. Gencloud keeps running behind a simulation, so its ledger
 * and strikes are there on the way back; a simulation starts fresh each time.
 */
export function setFloorSource(source: FloorSource): Runtime {
  if (source === registry.source) return liveRuntime();
  if (registry.source === "sim") { registry.floors.sim?.stop(); delete registry.floors.sim; }
  registry.source = source;
  const rt = liveRuntime();
  for (const fn of [...registry.watchers]) fn();
  return rt;
}

/**
 * Reconnect the Gencloud feed after its token was replaced. When the floor is on the simulator
 * and Gencloud is not running, the next switch back starts it with the new token anyway.
 */
export function restartGencloud(): void {
  registry.floors.gencloud?.restartFeed();
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
  const rt = createRuntime("replay", registry.rules, REPLAY_SPEED, true, () => new CsvReplayFeed(events, extras), (engine, feed) => {
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
