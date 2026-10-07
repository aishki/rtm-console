// RTM Console service worker: desktop alerts only (no caching, no offline).
// It shows a system notification for a nudge or an escalation, either pushed by the server
// (works with the browser minimized or closed) or handed over by a hidden console tab.
// A note is { tag, n, title, body, url, nudge }; see alertsFor() in lib/alerts.ts.
// Its buttons act from the notification itself, so the console does not have to be opened.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

const windows = () => self.clients.matchAll({ type: "window", includeUncontrolled: true });

// The console's own buttons, as far as the browser's limit of two allows. A nudge loses
// "On a case, 2 min", which only closes the pop-up: closing the notification does the same.
// "Send reason" brings up the pop-up with its reason box: Chrome on Windows draws a reply
// box inside the notification but does not let anyone type in it.
const NUDGE_ACTIONS = [{ action: "ack", title: "Got it" }, { action: "reason", title: "Send reason" }];
const CALLOUT_ACTIONS = [{ action: "ack", title: "Acknowledge" }, { action: "open", title: "Open console" }];

function show(note) {
  return self.registration.showNotification(note.title, {
    body: note.body,
    tag: note.tag,
    icon: "/assets/logos/carelon-icon-mark.png",
    // Stays on screen until the person deals with it.
    requireInteraction: true,
    data: note,
    actions: note.nudge ? NUDGE_ACTIONS : CALLOUT_ACTIONS,
  });
}

/** Show the note unless a console tab is on screen: that tab already shows the nudge pop-up or the toast. */
const showUnlessOnScreen = note => windows().then(list => (list.some(c => c.visibilityState === "visible") ? undefined : show(note)));

self.addEventListener("push", e => {
  if (e.data) e.waitUntil(showUnlessOnScreen(e.data.json()));
});

self.addEventListener("message", e => {
  const msg = e.data;
  // From a hidden tab, while another console tab may be on screen.
  if (msg?.type === "alert") e.waitUntil(showUnlessOnScreen(msg.note));
  // A console tab that just opened asks whether "Send reason" brought it up.
  if (msg?.type === "reason?" && reasonFor) { e.source.postMessage({ type: "reason", nudge: reasonFor }); reasonFor = null; }
  if (msg?.type === "clear") e.waitUntil(self.registration.getNotifications({ tag: msg.tag }).then(list => list.forEach(n => n.close())));
});

/** The nudge whose "Send reason" opened a new console tab, until that tab asks for it. */
let reasonFor = null;

self.addEventListener("notificationclick", e => {
  const note = e.notification.data;
  e.notification.close();
  e.waitUntil((async () => {
    if (e.action === "ack") {
      const res = await fetch(`/api/instances/${note.n}/ack`, { method: "POST" }).catch(() => null);
      if (res?.ok) return;
      // Not acknowledged (signed out, or the server is away): open the console instead.
    }
    const [tab] = await windows();
    const reason = e.action === "reason" && note.nudge ? note.nudge : null;
    if (!tab) { reasonFor = reason; return self.clients.openWindow(note.url); }
    if (reason) tab.postMessage({ type: "reason", nudge: reason });
    return tab.focus();
  })());
});
