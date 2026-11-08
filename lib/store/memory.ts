import { defaultRules } from "@/lib/engine/rules";
import { isOrgId } from "@/lib/orgs";
import { loadActiveOrg, saveActiveOrg } from "@/lib/server/tokenStore";
import { RTM_DIR, readQueueMapFile, writeQueueMapFile, writeRosterFile } from "./files";
import type { Store } from "./store";

/**
 * Keeps nothing in a database: development without one, unit tests and CSV replays. Rules and their
 * overrides, call-outs, incidents and strikes reset on a restart; the queue map, each org's last roster and the org on screen are kept in `dir`
 * (.rtm/ by default); desktop-alert subscriptions stay in memory.
 * `dir: null` keeps nothing at all (unit tests).
 */
export function memoryStore(opts: { dir?: string | null } = {}): Store {
  const dir = opts.dir === undefined ? RTM_DIR() : opts.dir;
  return {
    kind: "memory",
    loadRules: async () => defaultRules(),
    ruleChanged() {},
    overrideChanged() {},
    async loadBoot() {
      const none = { floors: {}, lastInstance: 0, incidentSeq: null };
      if (dir === null) return { queueMap: [], rosters: {}, subscriptions: [], ...none };
      // Rosters are read when an org first needs one.
      const org = loadActiveOrg(dir);
      return { queueMap: readQueueMapFile(dir), rosters: {}, subscriptions: [], ...none, ...(isOrgId(org) && { activeOrg: org }) };
    },
    async saveQueueMap(rows) { if (dir !== null) writeQueueMapFile(rows, dir); },
    rosterChanged(org, roster) { if (dir !== null) writeRosterFile(org, roster, dir); },
    subscriptionSaved() {},
    subscriptionDelivered() {},
    subscriptionRemoved() {},
    activeOrgChanged(org) { if (dir !== null) saveActiveOrg(org, dir); },
    feedSwitched() {},
    shiftStarted() {},
    instanceFired() {},
    instancesAcked() {},
    instanceCommented() {},
    incidentMoved() {},
    floorFiredChanged() {},
    notificationSent() {},
    eventsReceived() {},
    eventsCleared() {},
    flush: async () => {},
    close: async () => {},
  };
}
