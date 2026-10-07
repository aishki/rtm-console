"use client";

import type { CsvCols, MappedState } from "@/lib/csv/parse";
import type { ImportSummary } from "@/lib/import/floor";
import type { AgentState, FeedKind, FloorSource, Incident, Instance, InvAction, ReplayMeta, Role, Rule, View } from "@/lib/types";
import { connect, useConsole } from "./store";

/** A refusal from the API. `details` lists every problem when the server found several. */
export class ApiError extends Error {
  constructor(message: string, readonly details: string[] = [message]) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `Request failed (${res.status}).`;
    throw new ApiError(message, Array.isArray(data.errors) ? data.errors : [message]);
  }
  return data as T;
}
const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Run an action; a refusal from the server surfaces as a toast. Resolves to undefined on failure. */
export async function attempt<T>(action: Promise<T>): Promise<T | undefined> {
  try { return await action; } catch (e) {
    useConsole.getState().toast("warn", "That did not go through", e instanceof Error ? e.message : "Try again.");
    return undefined;
  }
}

export const api = {
  /** Dev "View as": switch role or person, then re-open the stream for the new span. */
  async setView(role: Role, who: string | null) {
    const { view } = await post<{ view: View }>("/api/session", { role, who });
    useConsole.setState({ view, nudge: null });
    await connect();
    return view;
  },
  /** Switch the floor's data source for everyone. The open stream follows with a fresh snapshot. */
  async setFeed(source: FloorSource) {
    const res = await post<{ feed: FeedKind; realNames: boolean }>("/api/feed", { source });
    useConsole.setState({ nudge: null });
    return res;
  },
  /** Dev "View as": every agent's current state, for the person box. */
  peopleStates: () => call<{ states: Record<string, AgentState> }>("/api/session/states"),
  ack: (n: number) => post<{ instance: Instance }>(`/api/instances/${n}/ack`),
  ackAll: () => post<{ count: number }>("/api/instances/ack-all"),
  comment: (n: number, text: string, ack: boolean) => post<{ instance: Instance }>(`/api/instances/${n}/comment`, { text, ack }),
  incident: (inc: string, action: InvAction, disposition?: string) => post<{ incident: Incident }>(`/api/incidents/${encodeURIComponent(inc)}`, { action, disposition }),
  patchRule: (id: Rule["id"], patch: Partial<Pick<Rule, "thr" | "sev" | "route" | "on">>) =>
    call<{ rule: Rule }>("/api/rules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) }),
  /** Check a filled-in Excel template without starting a replay. */
  validateImport(file: File) {
    const form = new FormData();
    form.set("file", file);
    return call<{ summary: ImportSummary; warnings: string[] }>("/api/import/validate", { method: "POST", body: form });
  },
  /** Start a replay from an Excel template, or from a CSV export with its column and status mapping. */
  async startReplay(file: File, csv?: { cols: CsvCols; smap: Record<string, MappedState> }) {
    const form = new FormData();
    form.set("file", file);
    if (csv) {
      form.set("cols", JSON.stringify(csv.cols));
      form.set("smap", JSON.stringify(csv.smap));
    }
    const res = await call<{ view: View; replay: ReplayMeta }>("/api/replay", { method: "POST", body: form });
    useConsole.setState({ nudge: null });
    await connect();
    return res;
  },
  async exitReplay() {
    await call<{ ok: true }>("/api/replay", { method: "DELETE" });
    await connect();
  },
};

/** Save a server export; the route sets the file name. */
export function download(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
}

/** Save text generated in the browser (the sample CSV). */
export function downloadText(text: string, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
