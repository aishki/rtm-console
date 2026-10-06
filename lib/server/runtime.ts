import type { NudgeEvent, Rule, ToastEvent } from "@/lib/types";
import type { ReplayEvent } from "@/lib/csv/parse";
import { type Engine, createEngine } from "@/lib/engine/engine";
import { defaultRules } from "@/lib/engine/rules";
import type { FeedSource } from "@/lib/feed/FeedSource";
import { CsvReplayFeed, REPLAY_SPEED } from "@/lib/feed/CsvReplayFeed";
import { GencloudFeed } from "@/lib/feed/GencloudFeed";
import { SimFeed } from "@/lib/feed/SimFeed";

// Server-side home of the rules engine. One live runtime serves the whole floor; a CSV
// replay gets its own runtime per session so reviewing history never disturbs the live feed.
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
  stop(): void;
}

/** The simulator is a dev tool: it never runs in a production build. */
export const USE_SIM = process.env.NEXT_PUBLIC_FEED === "sim" && process.env.NODE_ENV !== "production";

const WARM_SECONDS = 900;
const MAX_REPLAYS = 8;

function createRuntime(kind: Runtime["kind"], rules: Rule[], speed: number, makeFeed: (engine: Engine) => FeedSource, prepare: (engine: Engine, feed: FeedSource) => void): Runtime {
  const listeners = new Set<Listener>();
  let batch: Batch = { toasts: [], nudges: [] };
  const engine = createEngine({ toast: e => batch.toasts.push(e), nudge: e => batch.nudges.push(e) }, { rules, deriveAdh: kind === "replay" || USE_SIM });
  const feed = makeFeed(engine);
  prepare(engine, feed);
  const unsubscribe = feed.subscribe(engine.ingest);

  const publish = () => {
    const out = batch;
    batch = { toasts: [], nudges: [] };
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
    stop() { clearInterval(timer); unsubscribe(); listeners.clear(); },
  };
}

function createLive(rules: Rule[]): Runtime {
  if (!USE_SIM) {
    const now = new Date();
    const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    return createRuntime("live", rules, 1, () => new GencloudFeed({
      apiBase: process.env.GENCLOUD_API_BASE, clientId: process.env.GENCLOUD_CLIENT_ID, clientSecret: process.env.GENCLOUD_CLIENT_SECRET,
    }), engine => engine.reset({ t }));
  }
  const rt = createRuntime("live", rules, 1,
    engine => new SimFeed({ thr: engine.thr, strikes: (name, id) => engine.S.agents.find(a => a.name === name)?.strikes[id] ?? 0 }),
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

interface Registry { rules: Rule[]; live: Runtime | null; replays: Map<string, Runtime> }
const g = globalThis as typeof globalThis & { __rtmRegistry?: Registry };
const registry = (g.__rtmRegistry ??= { rules: defaultRules(), live: null, replays: new Map() });

export function liveRuntime(): Runtime {
  return (registry.live ??= createLive(registry.rules));
}

/** The runtime a session is looking at: its own replay when one is running, otherwise the live floor. */
export function runtimeFor(sid: string): Runtime {
  return registry.replays.get(sid) ?? liveRuntime();
}

/** Start replaying an export for this session, through the same rule configuration as the live floor. */
export function startReplay(sid: string, events: ReplayEvent[]): Runtime {
  exitReplay(sid);
  if (registry.replays.size >= MAX_REPLAYS) exitReplay(registry.replays.keys().next().value!);
  const rt = createRuntime("replay", registry.rules, REPLAY_SPEED, () => new CsvReplayFeed(events), (engine, feed) => {
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
  registry.live?.publish();
  for (const rt of registry.replays.values()) rt.publish();
}
