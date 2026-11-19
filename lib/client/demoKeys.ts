"use client";

import { useEffect } from "react";
import { api, attempt } from "./api";
import { useConsole } from "./store";

/** Typing in one of these never fires a cue. */
const TYPING = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/**
 * The presenter's cue keys on the demo floor (Admin, or any view while "View as" is on): 1, 2 or 3 moves
 * the cue agent to their next Overbreak strike (nudge, team lead, operations and an incident); 0 picks a
 * fresh cue agent. In an agent's view the cue agent is the agent on screen.
 * Off on every other floor, while typing, and with a modifier key held.
 */
export function useDemoKeys(): void {
  const on = useConsole(s => s.feed === "demo" && s.canCue);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(TYPING)) return;
      const action = e.key === "0" ? "reset" : e.key === "1" || e.key === "2" || e.key === "3" ? "next" : null;
      if (!action) return;
      e.preventDefault();
      void attempt(api.demoCue(action));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);
}
