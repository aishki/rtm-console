"use client";

import { create } from "zustand";
import type { Agent, Incident, Instance, NudgeEvent, PeopleDirectory, Queue, ReplayMeta, Rule, StreamMsg, Team, ToastKind, View } from "@/lib/types";

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

export const useConsole = create<ConsoleState>((set, get) => ({
  status: "connecting", view: null, org: [], people: null, t: 0, mode: "live", staleFor: 0, replay: null,
  queue: null, rules: [], agents: [], incidents: [], ledger: [], toasts: [], nudge: null,
  toast(kind, title, body) {
    const id = ++toastSeq;
    set(s => ({ toasts: [...s.toasts, { id, kind, title, body }].slice(-MAX_TOASTS) }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })), TOAST_MS);
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
  useConsole.setState(s => ({
    status: "ready", t: msg.t, mode: msg.mode, staleFor: msg.staleFor, replay: msg.replay, queue: msg.queue,
    rules: msg.rules, agents: msg.agents, incidents: msg.incidents, org: msg.org,
    ...(msg.type === "init"
      ? { view: (msg as Extract<StreamMsg, { type: "init" }>).view, people: (msg as Extract<StreamMsg, { type: "init" }>).people, ledger: msg.ledger }
      : { ledger: mergeLedger(s.ledger, msg.ledger) }),
    ...(msg.nudges.length ? { nudge: msg.nudges[msg.nudges.length - 1] } : null),
  }));
  for (const t of msg.toasts) toast(t.kind, t.title, t.body);
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
