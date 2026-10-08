/**
 * The floor's clock. The floor runs on US Eastern time wherever the server is (it was
 * Manila's, the server's own, so "today" started at Manila midnight, midday in the US).
 * RTM_TIME_ZONE overrides it with any IANA zone.
 */
export const FLOOR_TIME_ZONE = process.env.RTM_TIME_ZONE || "America/New_York";

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** The wall-clock date and time at `at` in `timeZone`. */
export function wallClock(at: Date, timeZone = FLOOR_TIME_ZONE): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Seconds since midnight on the floor's clock: the engine's `t`. */
export function floorSeconds(at: Date, timeZone = FLOOR_TIME_ZONE): number {
  const w = wallClock(at, timeZone);
  return w.hour * 3600 + w.minute * 60 + w.second;
}

/** The instant the floor's day containing `at` began (its midnight), correct across daylight-saving changes. */
export function floorMidnight(at: Date, timeZone = FLOOR_TIME_ZONE): Date {
  const w = wallClock(at, timeZone);
  const wallUtc = Date.UTC(w.year, w.month - 1, w.day);
  // The zone's offset at a moment: its wall clock read as UTC, minus the moment.
  const offset = (ms: number) => { const c = wallClock(new Date(ms), timeZone); return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - ms; };
  let guess = wallUtc - offset(wallUtc);
  guess = wallUtc - offset(guess);
  return new Date(guess);
}
