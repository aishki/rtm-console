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
 * Training, Idle) is Aux Personal. ACW is not visible in presence or routing (it needs the
 * conversation topics), so the live feed never reports it.
 */
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
