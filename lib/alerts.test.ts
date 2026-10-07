import { describe, expect, it } from "vitest";
import type { NudgeEvent } from "@/lib/types";
import { alertsFor } from "./alerts";
import { parseSubscription } from "./server/push";

const NUDGE: NudgeEvent = { n: 7, agent: "Amara Reyes", team: "Team Alpha", first: "Amara", body: "ACW is past 120s." };
const TOASTS = [{ title: "Amara Reyes · ACW overage", body: "strike 2", n: 8, team: "Team Alpha" }, { title: "Queue · Queue backlog", body: "now 14", n: 9 }, { title: "Gencloud not responding", body: "feed stale" }];

describe("desktop alerts", () => {
  it("alerts an agent about their nudges, with the pop-up's buttons, and never about toasts", () => {
    expect(alertsFor("agent", [NUDGE], TOASTS)).toEqual([
      { tag: "rtm-7", n: 7, title: "Amara, quick heads up", body: "ACW is past 120s.", url: "/my-view", nudge: NUDGE },
    ]);
  });

  it("alerts a leader about the nudge previews and call-out toasts of their span, saying who: no feed notices", () => {
    expect(alertsFor("tl", [NUDGE], TOASTS)).toEqual([
      { tag: "rtm-7", n: 7, title: "Amara, quick heads up", body: "ACW is past 120s.\nAmara Reyes · Team Alpha", url: "/console", nudge: NUDGE },
      { tag: "rtm-8", n: 8, title: "Amara Reyes · ACW overage", body: "strike 2\nTeam Alpha", url: "/console", nudge: null },
      { tag: "rtm-9", n: 9, title: "Queue · Queue backlog", body: "now 14", url: "/console", nudge: null },
    ]);
  });

  it("accepts subscriptions only for real push services", () => {
    const keys = { p256dh: "p", auth: "a" };
    expect(parseSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys })).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys });
    expect(parseSubscription({ endpoint: "https://wns2-sg2p.notify.windows.com/w/?token=abc", keys })).not.toBeNull();
    expect(parseSubscription({ endpoint: "https://internal.example/hook", keys })).toBeNull();
    expect(parseSubscription({ endpoint: "http://fcm.googleapis.com/fcm/send/abc", keys })).toBeNull();
    expect(parseSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" })).toBeNull();
  });
});
