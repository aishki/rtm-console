"use client";

import { create } from "zustand";
import { alertsFor } from "@/lib/alerts";
import type { Agent, FeedKind, Incident, InitMsg, Instance, NudgeEvent, PeopleDirectory, Queue, ReplayMeta, Rule, StreamMsg, Team, ToastKind, View } from "@/lib/types";
import { alertWhileHidden, syncAlerts } from "./alerts";

export interface ToastItem { id: number; kind: ToastKind; title: string; body: string }

interface ConsoleState {
  /** connecting: no snapshot yet. unauthorized: nobody is signed in. */
  status: "connecting" | "ready" | "unauthorized";
  view: View | null;
  /** Teams in the viewer's span. */
  org: Team[];
  /** People for the dev "View as" selector; null when roles come from SSO. */
  people: PeopleDirectory | null;
  t: number;
  mode: "live" | "replay";
  feed: FeedKind;
  /** Simulator only: the floor carries real team and agent names. */
  realNames: boolean;
  canSwitchFeed: boolean;
  staleFor: number;
  replay: ReplayMeta | null;
  queue: Queue | null;
  rules: Rule[];
  agents: Agent[];
  incidents: Incident[];
  /** Scoped ledger, newest first. */
  ledger: Instance[];
  toasts: ToastItem[];
  nudge: NudgeEvent | null;
  toast(kind: ToastKind, title: string, body: string): void;
  setNudge(n: NudgeEvent | null): void;
}

const TOAST_MS = 8000;
const MAX_TOASTS = 4;
let toastSeq = 0;
/** The nudge last shown, so a reconnect does not bring back one that was already closed. */
let shownNudge = -1;

/** Run once the tab is on screen: now, or when the person comes back to it. */
function whenSeen(fn: () => void): void {
  if (document.visibilityState === "visible") return fn();
  const check = () => { if (document.visibilityState !== "visible") return; document.removeEventListener("visibilitychange", check); fn(); };
  document.addEventListener("visibilitychange", check);
}

export const useConsole = create<ConsoleState>((set, get) => ({
  status: "connecting", view: null, org: [], people: null, t: 0, mode: "live", feed: "gencloud", realNames: false, canSwitchFeed: false, staleFor: 0, replay: null,
  queue: null, rules: [], agents: [], incidents: [], ledger: [], toasts: [], nudge: null,
  toast(kind, title, body) {
    const id = ++toastSeq;
    set(s => ({ toasts: [...s.toasts, { id, kind, title, body }].slice(-MAX_TOASTS) }));
    // A toast raised behind the desktop alert is still there when the person opens the console.
    whenSeen(() => setTimeout(() => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })), TOAST_MS));
    void get;
  },
  setNudge(nudge) { set({ nudge }); },
}));

/** Merge changed and new instances into the newest-first ledger. */
function mergeLedger(old: Instance[], delta: Instance[]): Instance[] {
  if (!delta.length) return old;
  const changed = new Map(delta.map(r => [r.n, r]));
  const merged = old.map(r => { const c = changed.get(r.n); if (c) changed.delete(r.n); return c ?? r; });
  const fresh = [...changed.values()].sort((a, b) => b.n - a.n);
  return fresh.length ? [...fresh, ...merged] : merged;
}

function apply(msg: StreamMsg) {
  const { toast } = useConsole.getState();
  const init = msg.type === "init" ? (msg as InitMsg) : null;
  // A snapshot repeats the agent's unacknowledged nudge; a tick only carries new ones.
  const nudge = msg.nudges.filter(e => !init || e.n !== shownNudge).at(-1);
  if (nudge) shownNudge = nudge.n;
  useConsole.setState(s => ({
    status: "ready", t: msg.t, mode: msg.mode, staleFor: msg.staleFor, replay: msg.replay, queue: msg.queue,
    rules: msg.rules, agents: msg.agents, incidents: msg.incidents, org: msg.org,
    ...(init
      ? { view: init.view, people: init.people, feed: init.feed, realNames: init.realNames, canSwitchFeed: init.canSwitchFeed, ledger: msg.ledger }
      : { ledger: mergeLedger(s.ledger, msg.ledger) }),
    ...(nudge ? { nudge } : null),
  }));
  for (const t of msg.toasts) toast(t.kind, t.title, t.body);
  if (init) void syncAlerts().catch(() => {});
  const role = useConsole.getState().view?.role;
  if (role && !init) alertWhileHidden(alertsFor(role, msg.nudges, msg.toasts));
}

let source: EventSource | null = null;
/** Bumped on every connect/disconnect so a superseded connect() never opens a second stream. */
let attempt = 0;

/** Open the server stream. The browser reconnects by itself and gets a fresh snapshot each time. */
export async function connect(): Promise<void> {
  disconnect();
  const mine = attempt;
  const res = await fetch("/api/session").catch(() => null);
  if (mine !== attempt) return;
  if (res?.status === 401) { useConsole.setState({ status: "unauthorized" }); return; }
  source = new EventSource("/api/stream");
  source.onmessage = e => apply(JSON.parse(e.data) as StreamMsg);
}

export function disconnect(): void {
  attempt++;
  source?.close();
  source = null;
}
