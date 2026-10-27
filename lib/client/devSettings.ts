"use client";

import { create } from "zustand";

// TODO(prod): the dev bar and these switches exist for development only. Remove this file, components/chrome/DevBar.tsx
// and the `devSettings` checks in lib/client/store.ts before going to production (or leave NEXT_PUBLIC_DEV_TOOLS unset there).

/**
 * True in `next dev`, or in any build made with NEXT_PUBLIC_DEV_TOOLS=1 (read at build time, so
 * changing it needs a rebuild). Without either, the dev bar is hidden and every notification stays on.
 */
export const DEV_TOOLS = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_DEV_TOOLS === "1";

export type DevSwitch = "toasts" | "nudges" | "desktop";

interface DevSettings {
  /** Toasts raised by the live floor (call-outs, escalations). Toasts from your own clicks always show. */
  toasts: boolean;
  /** The agent's nudge pop-up. */
  nudges: boolean;
  /** System notifications, from Web Push and from a hidden tab. */
  desktop: boolean;
  set(key: DevSwitch, on: boolean): void;
}

const KEY = "rtm.devSettings";
const DEFAULTS = { toasts: true, nudges: true, desktop: true };

function save(s: Pick<DevSettings, DevSwitch>): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window or storage blocked: the switch still works until reload */ }
}

export const useDevSettings = create<DevSettings>((set, get) => ({
  ...DEFAULTS,
  set(key, on) {
    set({ [key]: on } as Pick<DevSettings, DevSwitch>);
    const { toasts, nudges, desktop } = get();
    save({ toasts, nudges, desktop });
  },
}));

/**
 * Read the saved switches. Called once from the dev bar after the first render, so the server
 * render and the browser's first render agree. While DEV_TOOLS is off, every notification stays on.
 */
export function loadDevSettings(): void {
  if (!DEV_TOOLS) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Record<DevSwitch, unknown>> | null;
    if (!saved) return;
    useDevSettings.setState({
      toasts: saved.toasts !== false, nudges: saved.nudges !== false, desktop: saved.desktop !== false,
    });
  } catch { /* nothing saved, or unreadable: keep the defaults */ }
}

/** Current value of one switch, for code outside React. Always true while DEV_TOOLS is off. */
export const devOn = (key: DevSwitch): boolean => !DEV_TOOLS || useDevSettings.getState()[key];
