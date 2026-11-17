"use client";

import { useConsole } from "@/lib/client/store";
import { fmt } from "@/lib/engine/format";

/**
 * Seconds since `since` on the agents' clock, as m:ss. The only part of an agent's card that changes every
 * second: it follows the clock on its own, so the card around it re-renders only when the agent does.
 */
export function Elapsed({ since }: { since: number }) {
  const t = useConsole(s => s.agentT);
  return <>{fmt(Math.max(0, t - since))}</>;
}
