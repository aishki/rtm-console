"use client";

import { useConsole } from "@/lib/client/store";
import { fmt } from "@/lib/engine/format";

/**
 * Seconds since engine second `since`, as m:ss. The only part of an agent's card that changes every
 * second: it follows the floor clock on its own, so the card around it re-renders only when the agent does.
 */
export function Elapsed({ since }: { since: number }) {
  const t = useConsole(s => s.t);
  return <>{fmt(Math.max(0, t - since))}</>;
}
