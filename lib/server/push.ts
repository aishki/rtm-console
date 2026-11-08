import webpush, { type PushSubscription } from "web-push";
import type { AlertNote, View } from "@/lib/types";
import { alertsFor } from "@/lib/alerts";
import type { EngineState } from "@/lib/engine/escalation";
import { inScope } from "@/lib/engine/scope";
import { env } from "@/lib/env";
import type { Batch } from "./runtime";
import { bootSubscriptions, store } from "./store";
import type { NotificationSent } from "@/lib/store/store";

// Web Push: delivers nudges and escalations as system notifications, including to people
// whose browser is minimized or closed. Each browser registers a subscription for the
// person it is signed in as; the push services (Google for Chrome, Microsoft for Edge)
// relay the encrypted payload.

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env();

/** The key browsers subscribe with, or null when push is not configured. The settings check makes it all three or none. */
export const pushKey: string | null = VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT ? VAPID_PUBLIC_KEY : null;
if (pushKey) webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);

/** A nudge is only useful in the moment: undelivered pushes are dropped after this many seconds. */
const TTL_SECONDS = 60;

/** The server posts to whatever endpoint a browser hands it, so only real push services are accepted. */
const PUSH_HOSTS = [".googleapis.com", ".notify.windows.com", ".push.services.mozilla.com", ".push.apple.com"];

interface Entry { sub: PushSubscription; view: View }
// Kept by the store (push_subscription with PostgreSQL), so a restart keeps everyone's alerts.
// TODO(SSO): `view` is the "View as" person; bind subscriptions to the signed-in user instead.
const g = globalThis as typeof globalThis & { __rtmPushSubs?: Map<string, Entry> };
/** Read from what the store loaded at start-up the first time it is needed. */
const subs = (): Map<string, Entry> => (g.__rtmPushSubs ??= new Map(bootSubscriptions().map(e => [e.sub.endpoint, e])));

export function parseSubscription(x: unknown): PushSubscription | null {
  const s = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== "string" || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") return null;
  let url: URL;
  try { url = new URL(s.endpoint); } catch { return null; }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some(h => url.hostname.endsWith(h))) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

/** One entry per browser: re-registering moves the browser to the person now using it. */
export function saveSubscription(view: View, sub: PushSubscription, userAgent?: string): void {
  const entry = {
    sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, view: { role: view.role, who: view.who },
    ...(userAgent && { userAgent: userAgent.slice(0, 300) }),
  };
  subs().set(sub.endpoint, entry);
  store().subscriptionSaved(entry);
}

export function removeSubscription(endpoint: string): void {
  if (subs().delete(endpoint)) store().subscriptionRemoved(endpoint);
}

/** Each browser's last recorded delivery, so a busy floor records at most one every few minutes per browser. */
const lastNoted = new Map<string, number>();
const NOTE_EVERY_MS = 5 * 60_000;
function delivered(endpoint: string): void {
  const now = Date.now();
  if (now - (lastNoted.get(endpoint) ?? 0) < NOTE_EVERY_MS) return;
  lastNoted.set(endpoint, now);
  store().subscriptionDelivered(endpoint);
}

/** Send one alert. With `log`, the outcome is kept in notification_log: who it went to, and whether the push service took it. */
function send(sub: PushSubscription, note: AlertNote, log?: { view: View; level: NotificationSent["level"] }): void {
  const logged = (status: NotificationSent["status"]) => {
    if (log) store().notificationSent({ n: note.n, who: log.view.who, role: log.view.role, level: log.level, endpoint: sub.endpoint, status, at: new Date() });
  };
  webpush.sendNotification(sub, JSON.stringify(note), { TTL: TTL_SECONDS, urgency: "high" }).then(() => { delivered(sub.endpoint); logged("sent"); }).catch((e: { statusCode?: number }) => {
    // The browser unsubscribed or the subscription expired.
    const gone = e.statusCode === 404 || e.statusCode === 410;
    logged(gone ? "gone" : "failed");
    if (gone) removeSubscription(sub.endpoint);
  });
}

/** Push what the live floor just raised to every subscriber it is in scope for. `log`: keep each delivery (a Genesys floor). */
export function pushBatch(S: EngineState, batch: Batch, log = false): void {
  if (!pushKey || !subs().size || (!batch.nudges.length && !batch.toasts.length)) return;
  for (const { sub, view } of subs().values()) {
    const notes = alertsFor(
      view.role,
      // The same nudges the stream sends: an agent's own, none for leaders.
      view.role === "agent" ? batch.nudges.filter(n => n.agentId === view.who) : [],
      batch.toasts.flatMap(e => (e.instance && inScope(S, view, e.instance) ? [{ title: e.title, body: e.body, n: e.instance.n, team: e.instance.isFloor ? undefined : e.instance.team }] : [])),
    );
    for (const note of notes) send(sub, note, log ? { view, level: note.nudge ? "nudge" : S.ledger.find(r => r.n === note.n)?.stage ?? "info" } : undefined);
  }
}
