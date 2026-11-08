const pad = (n: number) => String(n).padStart(2, "0");

/** Seconds as m:ss. */
export const fmt = (s: number): string => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

/** Seconds since midnight as hh:mm:ss. */
export const clock = (t: number): string =>
  `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;

/** Splits "Last, First - AH12345" into the name and the domain ID. The last " - " separates them: a surname can hold one too. */
export const splitAgent = (name: string): { who: string; id: string } => {
  const cut = name.lastIndexOf(" - ");
  return cut < 0 ? { who: name, id: "" } : { who: name.slice(0, cut), id: name.slice(cut + 3) };
};

/** The Domain ID at the end of a Genesys name ("Last, First - AH12345"), upper-cased; "" when the name has none. */
export const domainIdOf = (name: string): string => {
  const id = splitAgent(name).id.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(id) ? id : "";
};

/** Shown for a Team Lead or Manager when the agent has no supervisor, or their supervisor has none, in Genesys or the CGS directory. */
export const NO_LEADER = "(none in Genesys)";

/**
 * An agent's incidents as one short cause line, one entry per rule, newest rule first:
 * "Extended ACW ×3" for a single incident, "Prolonged offline: 12 IRs, latest ×14" for several.
 * Closed ones are marked, so a long run of repeats stays one line.
 */
export function causeSummary(list: { rule: string; instances: number; status: string }[]): string {
  const by = new Map<string, { n: number; open: number; latest: number }>();
  for (const i of list) {
    const c = by.get(i.rule) ?? { n: 0, open: 0, latest: 0 };
    c.n++;
    if (i.status !== "Closed") c.open++;
    c.latest = Math.max(c.latest, i.instances);
    by.set(i.rule, c);
  }
  return [...by].map(([rule, c]) => {
    const closed = c.open === 0 ? " (closed)" : c.open < c.n ? ` (${c.open.toLocaleString("en-US")} open)` : "";
    return c.n === 1 ? `${rule} ×${c.latest}${closed}` : `${rule}: ${c.n.toLocaleString("en-US")} IRs, latest ×${c.latest}${closed}`;
  }).join(" · ");
}
