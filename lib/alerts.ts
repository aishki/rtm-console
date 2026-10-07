import type { AlertNote, NudgeEvent, Role, ToastEvent } from "@/lib/types";

// Desktop alerts: the system notification raised for a nudge or an escalation. The server
// (Web Push) and a hidden console tab build them from the same events with the same tag,
// so the operating system shows each call-out once.

type CalloutToast = Pick<ToastEvent, "title" | "body"> & { n?: number; team?: string };

export const alertTag = (n: number): string => `rtm-${n}`;

/**
 * What one person is alerted about, from events already scoped to them: whatever the console
 * would pop up for them. Agents get their own nudges; leaders get the nudge previews and the
 * call-out toasts of their span (feed notices carry no instance and stay in-page).
 * The wording is the in-page nudge's and toast's; a leader's alert adds who it is about on a
 * second line, which the console shows around the pop-up.
 */
export function alertsFor(role: Role, nudges: NudgeEvent[], toasts: CalloutToast[]): AlertNote[] {
  const agent = role === "agent";
  const own: AlertNote[] = nudges.map(e => ({
    tag: alertTag(e.n), n: e.n, title: `${e.first}, quick heads up`, body: agent ? e.body : `${e.body}\n${e.agent} · ${e.team}`,
    url: agent ? "/my-view" : "/console", nudge: e,
  }));
  if (agent) return own;
  return own.concat(toasts.flatMap(e => (e.n === undefined ? [] : [{ tag: alertTag(e.n), n: e.n, title: e.title, body: e.team ? `${e.body}\n${e.team}` : e.body, url: "/console", nudge: null }])));
}
