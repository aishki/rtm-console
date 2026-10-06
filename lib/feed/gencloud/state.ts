import type { AgentState } from "@/lib/types";

export function mapGenesysState(presence: string | undefined, routing: string | undefined): AgentState {
  const p = (presence ?? "").toUpperCase(), r = (routing ?? "").toUpperCase();
  if (p === "OFFLINE" || r === "OFF_QUEUE") return "off";
  if (r === "INTERACTING") return "oncall";
  if (r === "COMMUNICATING") return "acw";
  if (p === "BREAK" || p === "MEAL") return "auxb";
  if (r === "IDLE" && p === "AVAILABLE") return "avail";
  if (["BUSY","AWAY","MEETING","TRAINING"].includes(p)) return "auxp";
  return "auxp";
}
