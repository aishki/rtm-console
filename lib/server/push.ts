import webpush, { type PushSubscription } from "web-push";
import type { AlertNote, View } from "@/lib/types";
import { alertsFor } from "@/lib/alerts";
import type { EngineState } from "@/lib/engine/escalation";
import { inScope } from "@/lib/engine/scope";
import type { Batch } from "./runtime";

// Web Push: delivers nudges and escalations as system notifications, including to people
// whose browser is minimized or closed. Each browser registers a subscription for the
// person it is signed in as; the push services (Google for Chrome, Microsoft for Edge)
// relay the encrypted payload.

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

/** The key browsers subscribe with, or null when push is not configured. */
export const pushKey: string | null = PUBLIC_KEY && PRIVATE_KEY ? PUBLIC_KEY : null;
if (pushKey) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:rtm-console@example.com", PUBLIC_KEY!, PRIVATE_KEY!);

/** A nudge is only useful in the moment: undelivered pushes are dropped after this many seconds. */
const TTL_SECONDS = 60;

/** The server posts to whatever endpoint a browser hands it, so only real push services are accepted. */
const PUSH_HOSTS = [".googleapis.com", ".notify.windows.com", ".push.services.mozilla.com", ".push.apple.com"];

interface Entry { sub: PushSubscription; view: View }
// TODO(DB): subscriptions live in memory, so a restart drops them until each person reopens the console.
// TODO(SSO): `view` is the "View as" person; bind subscriptions to the signed-in user instead.
const g = globalThis as typeof globalThis & { __rtmPushSubs?: Map<string, Entry> };
const subs = (g.__rtmPushSubs ??= new Map());

export function parseSubscription(x: unknown): PushSubscription | null {
  const s = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== "string" || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") return null;
  let url: URL;
  try { url = new URL(s.endpoint); } catch { return null; }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some(h => url.hostname.endsWith(h))) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

/** One entry per browser: re-registering moves the browser to the person now using it. */
export function saveSubscription(view: View, sub: PushSubscription): void {
  subs.set(sub.endpoint, { sub, view });
}

export function removeSubscription(endpoint: string): void {
  subs.delete(endpoint);
}

function send(sub: PushSubscription, note: AlertNote): void {
  webpush.sendNotification(sub, JSON.stringify(note), { TTL: TTL_SECONDS, urgency: "high" }).catch((e: { statusCode?: number }) => {
    // The browser unsubscribed or the subscription expired.
    if (e.statusCode === 404 || e.statusCode === 410) subs.delete(sub.endpoint);
  });
}

/** Push what the live floor just raised to every subscriber it is in scope for. */
export function pushBatch(S: EngineState, batch: Batch): void {
  if (!pushKey || !subs.size || (!batch.nudges.length && !batch.toasts.length)) return;
  for (const { sub, view } of subs.values()) {
    const notes = alertsFor(
      view.role,
      // The same nudges the stream sends: an agent's own, none for leaders.
      view.role === "agent" ? batch.nudges.filter(n => n.agent === view.who) : [],
      batch.toasts.flatMap(e => (e.instance && inScope(S, view, e.instance) ? [{ title: e.title, body: e.body, n: e.instance.n, team: e.instance.isFloor ? undefined : e.instance.team }] : [])),
    );
    for (const note of notes) send(sub, note);
  }
}
