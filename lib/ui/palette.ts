import type { Incident, Instance, Stage, TabId, ToastKind } from "@/lib/types";
import type { TargetLevel } from "@/lib/engine/rules";

// Status colors from the BITS tokens (see app/globals.css). Kept as values because they are
// picked at runtime from engine data.

export interface Tone { bg: string; fg: string }

export const SEV: Record<Instance["sev"], Tone & { label: string }> = {
  warn: { label: "Warning", bg: "#FDF3D7", fg: "#7A5300" },
  crit: { label: "Critical", bg: "#FBE3E8", fg: "#B00830" },
  esc: { label: "Escalated", bg: "#EBE4FF", fg: "#5009B5" },
};
export const STAGE: Record<Stage, Tone & { label: string; solid: string }> = {
  nudge: { label: "Nudge", bg: "#D9F5F5", fg: "#028283", solid: "#00BBBA" },
  lead: { label: "Leader", bg: "#FDF3D7", fg: "#7A5300", solid: "#F2BC35" },
  ops: { label: "Ops", bg: "#EBE4FF", fg: "#5009B5", solid: "#5009B5" },
};
export const STAGE_ORDER: Stage[] = ["nudge", "lead", "ops"];

export type Level = "ok" | "warn" | "crit" | "esc";
export const LVL: Record<Level, { fg: string; dot: string }> = {
  ok: { fg: "#231E33", dot: "#449E3C" },
  warn: { fg: "#7A5300", dot: "#F2BC35" },
  crit: { fg: "#B00830", dot: "#D20A36" },
  esc: { fg: "#5009B5", dot: "#5009B5" },
};
export const TGT: Record<TargetLevel, Tone> = {
  ok: { bg: "#E5F2E3", fg: "#2F6E29" },
  watch: { bg: "#FDF3D7", fg: "#7A5300" },
  breach: { bg: "#FBE3E8", fg: "#B00830" },
  off: { bg: "#F5F5F5", fg: "#5C5C6F" },
};
export const INC: Record<Incident["status"], Tone> = {
  Open: { bg: "#FBE3E8", fg: "#B00830" },
  Investigating: { bg: "#FDF3D7", fg: "#7A5300" },
  Closed: { bg: "#E5F2E3", fg: "#2F6E29" },
};
export const TOAST: Record<ToastKind, { dot: string; fg: string }> = {
  warn: { dot: "#F2BC35", fg: "#231E33" },
  crit: { dot: "#D20A36", fg: "#B00830" },
  esc: { dot: "#5009B5", fg: "#5009B5" },
  info: { dot: "#449E3C", fg: "#231E33" },
};

export const TABS: { id: TabId; label: string; href: string }[] = [
  { id: "console", label: "Console", href: "/console" },
  { id: "myview", label: "My View", href: "/my-view" },
  { id: "dash", label: "Dashboards", href: "/dashboards" },
  { id: "rules", label: "Rules Engine", href: "/rules" },
  { id: "ledger", label: "Instance Ledger", href: "/ledger" },
];
