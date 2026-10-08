import { useSyncExternalStore } from "react";
import type { ToastKind } from "@/lib/types";

// Preview stand-in for the app's zustand store: same fields, filled from sample data, no server stream.
export interface ToastItem { id: number; kind: ToastKind; title: string; body: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = Record<string, any>;

let toastSeq = 0;
let state: State = {
  status: "connecting", view: null, org: [], people: null, t: 0, mode: "live", feed: "gencloud", realNames: false, canSwitchFeed: false, staleFor: 0, replay: null,
  queue: null, rules: [], agents: [], incidents: [], ledger: [], toasts: [], nudge: null,
  toast(kind: ToastKind, title: string, body: string) { setState(s => ({ toasts: [...s.toasts, { id: ++toastSeq, kind, title, body }].slice(-4) })); },
  setNudge(nudge: unknown) { setState({ nudge }); },
};
const subs = new Set<() => void>();
function setState(patch: State | ((s: State) => State)): void {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach(fn => fn());
}
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };

export function useConsole<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
useConsole.getState = () => state;
useConsole.setState = setState;

export async function connect(): Promise<void> {}
export function disconnect(): void {}
