import type { AgentState } from "@/lib/types";

/** Genesys writes presence as "On Queue", "Break", "Offline"; compare in one form ("ON_QUEUE"). */
const norm = (s: string | undefined): string => (s ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");

/**
 * Console state from a Genesys system presence and routing status.
 *
 * Routing says what the agent is doing with calls; presence says why they are not taking them.
 * An ACD call (INTERACTING) or a non-ACD call such as a callback (COMMUNICATING) wins over
 * presence. Routing IDLE exists only on queue, so it is Available even before the presence
 * message arrives (the two come separately). Off calls, Break and Meal are Aux Break; On Queue
 * is Available; any other logged-in presence (Available but off queue, Busy, Away, Meeting,
 * Training, Idle) is Aux Personal. ACW is not visible in presence or routing; `consoleState`
 * adds it from the conversation topic.
 */
/**
 * When the agent entered the state `mapGenesysState` gives, from the snapshot's timestamps:
 * routing's `startTime` for states routing decides (on a call, outbound, idle on queue,
 * not responding), presence's `modifiedDate` for the rest. Either one stands in for the other
 * when missing. Epoch ms, or undefined when neither is known.
 */
export function stateSince(
  presence: string | undefined, routing: string | undefined,
  presenceSince: string | undefined, routingSince: string | undefined,
): number | undefined {
  const p = norm(presence), r = norm(routing);
  const fromRouting = p !== "OFFLINE" && ["INTERACTING", "COMMUNICATING", "IDLE", "NOT_RESPONDING"].includes(r);
  const ms = (s: string | undefined) => { const v = s ? Date.parse(s) : NaN; return Number.isFinite(v) ? v : undefined; };
  return fromRouting ? ms(routingSince) ?? ms(presenceSince) : ms(presenceSince) ?? ms(routingSince);
}

/**
 * The console state once the agent's calls are known. Routing stays INTERACTING through
 * after-call work, so pending ACW with no call connected is ACW, whatever routing says.
 */
export function consoleState(
  presence: string | undefined, routing: string | undefined,
  calls?: { onCall: boolean; acwSince: number | null },
): AgentState {
  const base = mapGenesysState(presence, routing);
  return calls && calls.acwSince !== null && !calls.onCall && base !== "off" ? "acw" : base;
}

export function mapGenesysState(presence: string | undefined, routing: string | undefined): AgentState {
  const p = norm(presence), r = norm(routing);
  if (p === "OFFLINE") return "off";
  if (r === "INTERACTING") return "oncall";
  if (r === "COMMUNICATING") return "outb";
  if (r === "IDLE") return "avail";
  if (r === "NOT_RESPONDING") return "auxp";
  if (p === "BREAK" || p === "MEAL") return "auxb";
  if (p === "ON_QUEUE") return "avail";
  return "auxp";
}
