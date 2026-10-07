"use client";

import { useSyncExternalStore } from "react";
import { alertTag } from "@/lib/alerts";
import type { AlertNote } from "@/lib/types";

// Browser side of desktop alerts: the permission, the service worker, the Web Push
// subscription, and the fallback where a hidden tab raises the notification itself.

export type AlertState = "unsupported" | "default" | "granted" | "denied";

/** "unsupported" covers old browsers and pages not served over HTTPS (localhost is fine). */
export function alertState(): AlertState {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission;
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useAlertState = (): AlertState => useSyncExternalStore(subscribe, alertState, () => "unsupported");

let ready: Promise<ServiceWorkerRegistration> | null = null;
const worker = () => (ready ??= navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready));

const base64Url = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "");

/**
 * Register this browser for the current person's alerts. Runs on every connect, so the
 * server relearns subscriptions after a restart and follows a "View as" switch.
 */
export async function syncAlerts(): Promise<void> {
  if (alertState() !== "granted") return;
  const reg = await worker();
  if (!("PushManager" in window)) return;
  const { key } = (await fetch("/api/push").then(r => r.json())) as { key?: string | null };
  if (!key) return; // Push is not configured: the hidden-tab fallback still works.
  let sub = await reg.pushManager.getSubscription();
  // A subscription made under another server key can no longer be pushed to.
  if (sub && base64Url(sub.options.applicationServerKey) !== key) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub }) });
}

/** Ask for permission (must follow a click) and register. Resolves to the resulting state. */
export async function enableAlerts(): Promise<AlertState> {
  if (alertState() === "unsupported") return "unsupported";
  await Notification.requestPermission();
  for (const fn of listeners) fn();
  await syncAlerts().catch(() => {});
  return alertState();
}

function tell(msg: { type: "alert"; note: AlertNote } | { type: "clear"; tag: string }): void {
  if (alertState() !== "granted") return;
  void worker().then(reg => reg.active?.postMessage(msg)).catch(() => {});
}

/** A tab nobody is looking at raises the system notification itself (same tag as the push, so no doubles). */
export function alertWhileHidden(notes: AlertNote[]): void {
  if (!notes.length || document.visibilityState !== "hidden") return;
  for (const note of notes) tell({ type: "alert", note });
}

/** Take down the system notification for an instance that was dealt with in the console. */
export const clearAlert = (n: number): void => tell({ type: "clear", tag: alertTag(n) });
