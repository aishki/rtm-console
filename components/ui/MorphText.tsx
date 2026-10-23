"use client";

import { useLayoutEffect, useRef } from "react";

const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
const SLIDE_MS = 400;

interface Last { text: string; w: number; h: number; copy: HTMLElement }

/**
 * Text that cross-fades when it changes while its box (and the table column around it) slides to the new size.
 * The old text fades out quickly inside the box, so it moves and clips with the cell instead of spilling over its
 * neighbours. The new text fades in as the slide settles, held at its final width so its lines don't re-wrap mid-slide.
 * Skipped when the viewer asks for reduced motion.
 */
export function MorphText({ children }: { children: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const last = useRef<Last | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    const text = el?.firstElementChild as HTMLElement | null;
    if (!el || !text) return;
    const r = el.getBoundingClientRect();
    const prev = last.current;
    last.current = { text: children, w: r.width, h: r.height, copy: text.cloneNode(true) as HTMLElement };
    if (!prev || prev.text === children || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.animate(
      [{ width: `${prev.w}px`, height: `${prev.h}px` }, { width: `${r.width}px`, height: `${r.height}px` }],
      { duration: SLIDE_MS, easing: EASE_IN_OUT },
    );
    text.animate([{ width: `${r.width}px` }, { width: `${r.width}px` }], { duration: SLIDE_MS });
    text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 160, easing: "ease-out", fill: "backwards" });

    const old = prev.copy;
    old.setAttribute("aria-hidden", "true");
    Object.assign(old.style, { position: "absolute", left: "0", top: "0", width: `${prev.w}px`, pointerEvents: "none" });
    el.appendChild(old);
    old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-in", fill: "forwards" })
      .finished.then(() => old.remove(), () => old.remove());
  }, [children]);

  // Keep the size current between changes (window resizes, column reflow), so the next slide starts from the right place.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!last.current || el.getAnimations().length) return;
      const r = el.getBoundingClientRect();
      last.current = { ...last.current, w: r.width, h: r.height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <span ref={box} className="relative inline-block overflow-clip align-top">
      <span className="block">{children}</span>
    </span>
  );
}
