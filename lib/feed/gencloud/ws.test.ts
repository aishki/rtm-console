import { describe, it, expect } from "vitest";
import { splitTopics, parseNotification } from "./ws";

describe("splitTopics", () => {
  it("splits at the topic budget (2 topics/user)", () => {
    const users = Array.from({length:600},(_,i)=>"u"+i);
    const chans = splitTopics(users, 1000);
    expect(chans.length).toBe(2);
    expect(chans[0].length).toBe(1000);
    expect(chans[1].length).toBe(200);
  });
});
describe("parseNotification", () => {
  it("null for heartbeat", () =>
    expect(parseNotification(JSON.stringify({ topicName:"channel.metadata", eventBody:{ message:"WebSocket Heartbeat" } }))).toBeNull());
  it("parses presence", () => {
    const e = parseNotification(JSON.stringify({ topicName:"v2.users.u1.presence",
      eventBody:{ presenceDefinition:{ systemPresence:"BUSY" }, modifiedDate:"2026-10-06T09:26:23Z" } }));
    expect(e).toMatchObject({ userId:"u1", systemPresence:"BUSY" });
  });
  it("parses routingStatus", () => {
    const e = parseNotification(JSON.stringify({ topicName:"v2.users.u1.routingStatus",
      eventBody:{ routingStatus:{ status:"INTERACTING" } } }));
    expect(e).toMatchObject({ userId:"u1", routingStatus:"INTERACTING" });
  });
});
