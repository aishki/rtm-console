"use client";

import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
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

const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

interface Seen { x: number; y: number; w: number; h: number; parts: Map<Element, DOMRect> }

/**
 * Animates a small group of controls as React swaps them (for example "Start investigation" giving way to a
 * disposition list and "Close incident"). Buttons and `[data-morph]` elements inside `ref`:
 * - that appear fade and scale in;
 * - that disappear fade and scale out where they stood, so old and new cross-fade;
 * - and the box slides between its old and new size. Inside a table cell that carries the column and row with it. * Skipped when the viewer asks for reduced motion.
 */
export function useMorph(ref: RefObject<HTMLElement | null>) {
  const seen = useRef<Seen | null>(null);

  // Runs after every render, because any render may swap the controls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = seen.current;
    const box = el.getBoundingClientRect();
    const parts = new Map<Element, DOMRect>();
    for (const c of Array.from(el.querySelectorAll("button, [data-morph]"))) parts.set(c, c.getBoundingClientRect());
    seen.current = { x: box.left, y: box.top, w: box.width, h: box.height, parts };
    if (!prev || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const added = [...parts.keys()].filter(c => !prev.parts.has(c));
    const removed = [...prev.parts].filter(([c]) => !c.isConnected);
    if (!added.length && !removed.length) return;

    if (Math.abs(prev.w - box.width) > 1 || Math.abs(prev.h - box.height) > 1) {
      el.animate(
        [{ width: `${prev.w}px`, height: `${prev.h}px`, overflow: "clip" }, { width: `${box.width}px`, height: `${box.height}px`, overflow: "clip" }],
        { duration: 450, easing: EASE_IN_OUT },
      );
    }
    for (const c of added) {
      c.animate([{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: 120, easing: "ease-out", fill: "backwards" });
    }
    // React has already removed these: a copy fades out on top, where the original stood relative to the box.
    for (const [c, r] of removed) {
      const ghost = c.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed", margin: "0", zIndex: "1", pointerEvents: "none", boxSizing: "border-box",
        left: `${box.left + r.left - prev.x}px`, top: `${box.top + r.top - prev.y}px`,
        width: `${r.width}px`, height: `${r.height}px`,
      });
      document.body.appendChild(ghost);
      ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.92)" }], { duration: 200, easing: "ease-in", fill: "forwards" })
        .finished.then(() => ghost.remove(), () => ghost.remove());
    }
  });

  // Keep the size current between swaps (window resizes, wrapping), so the next slide starts from the right place.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!seen.current || el.getAnimations().length) return;
      const r = el.getBoundingClientRect();
      seen.current = { ...seen.current, x: r.left, y: r.top, w: r.width, h: r.height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
