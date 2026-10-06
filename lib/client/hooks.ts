"use client";

import { useMemo } from "react";
import type { Instance, Perms } from "@/lib/types";
import { PERMS } from "@/lib/engine/scope";
import { useConsole } from "./store";

/** PERMS for the current viewer. The server enforces the same table on every API route. */
export function usePerms(): Perms | null {
  const role = useConsole(s => s.view?.role);
  return role ? PERMS[role] : null;
}

/** Mean seconds between a call-out firing and its acknowledgement, e.g. "42s", or "—". */
export function avgResponse(ledger: Instance[]): string {
  let sum = 0, n = 0;
  for (const r of ledger) if (r.ackT !== null) { sum += r.ackT - r.t; n++; }
  return n ? Math.round(sum / n) + "s" : "—";
}

export function useOpenCounts(): { openInstances: number; openInvestigations: number } {
  const ledger = useConsole(s => s.ledger);
  const incidents = useConsole(s => s.incidents);
  return useMemo(() => ({
    openInstances: ledger.filter(r => r.status === "open").length,
    openInvestigations: incidents.filter(i => i.status !== "Closed").length,
  }), [ledger, incidents]);
}
