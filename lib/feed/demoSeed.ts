import type { RosterNames } from "@/lib/store/store";
import type { OrgPerson, Team } from "@/lib/types";
import type { SimSeed } from "./SimFeed";
import { teamLines } from "./teamLines";

// The demo floor: the real structure of every cached roster (teams, queues, LOBs, who sits in which
// queue, how many) with every person invented. No real name or Genesys ID survives: agents become
// demo:<n>, leaders demo:lead:<n>. The same rosters always give the same names, so a rehearsal and
// the presentation look alike.

const FIRST = [
  "Aaron", "Abby", "Adele", "Aiden", "Alana", "Alma", "Amara", "Andre", "Anika", "Ari", "Asha", "Avery", "Beau", "Bianca", "Blake", "Brea",
  "Caleb", "Cara", "Cedric", "Celia", "Dahlia", "Dante", "Delia", "Derek", "Dina", "Eamon", "Edie", "Elena", "Elliot", "Elsa", "Emil", "Esme",
  "Ezra", "Fallon", "Felix", "Fiona", "Gavin", "Gemma", "Greer", "Hadley", "Hollis", "Hugo", "Ines", "Ira", "Isla", "Jada", "Jasper", "Jonah",
  "Juno", "Kai", "Keira", "Kian", "Lena", "Leon", "Lila", "Lionel", "Lucia", "Mabel", "Maren", "Mateo", "Mira", "Nadia", "Nico", "Noor",
  "Odette", "Omar", "Orla", "Otis", "Paige", "Perry", "Quinn", "Rafael", "Reina", "Rhys", "Rosa", "Rowan", "Sabine", "Selma", "Silas", "Sonia",
  "Tamsin", "Teo", "Thea", "Tobias", "Uma", "Vera", "Wade", "Willa", "Xavi", "Yara", "Yusuf", "Zane", "Zora",
];
const LAST = [
  "Abbott", "Acosta", "Alder", "Ambrose", "Arden", "Ashby", "Baird", "Barlow", "Beckett", "Bellamy", "Boone", "Bramble", "Calloway", "Carver",
  "Castell", "Corbin", "Crane", "Dalton", "Delacroix", "Draper", "Easton", "Ellery", "Emberly", "Farrow", "Fenwick", "Finch", "Garland",
  "Gentry", "Greaves", "Hale", "Harlow", "Hawthorne", "Holloway", "Ingram", "Ivers", "Jessup", "Keane", "Kendrick", "Kingsley", "Lachlan",
  "Langford", "Larkin", "Lowell", "Maddox", "Marlowe", "Merritt", "Monroe", "Nash", "Norwood", "Oakley", "Osborne", "Pace", "Pemberton",
  "Prescott", "Quill", "Radley", "Rainier", "Redford", "Rourke", "Sallow", "Sinclair", "Sterling", "Strand", "Talbot", "Thorne", "Tolliver",
  "Underhill", "Vance", "Varga", "Vesper", "Wakefield", "Whitlock", "Winslow", "Wren", "Yardley", "Yates", "Zeller",
];

/** A small seeded PRNG (mulberry32): the same seed gives the same names. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unique invented names, drawn in a fixed order. A repeat gets a middle initial. */
function namer(rnd: () => number): () => string {
  const used = new Set<string>();
  return () => {
    for (;;) {
      const first = FIRST[Math.floor(rnd() * FIRST.length)], last = LAST[Math.floor(rnd() * LAST.length)];
      const plain = `${first} ${last}`;
      if (!used.has(plain)) { used.add(plain); return plain; }
      const mid = `${first} ${String.fromCharCode(65 + Math.floor(rnd() * 26))}. ${last}`;
      if (!used.has(mid)) { used.add(mid); return mid; }
    }
  };
}

/** Teams per invented manager, where a roster names no leaders. */
const TEAMS_PER_MGR = 6;

/**
 * The demo floor over the cached rosters (one per org). Null when none has an agent: the caller
 * falls back to the simulator's sample floor.
 */
export function demoSeed(rosters: RosterNames[], seed = 1): SimSeed | null {
  const withAgents = rosters.filter(r => r.agents.length);
  if (!withAgents.length) return null;
  const name = namer(prng(seed));

  // Agents: one demo uid per real one (or per name, in rosters saved before agents had IDs).
  const agentUid = new Map<string, string>();
  const seats: NonNullable<SimSeed["seats"]> = [];
  const keyOf = (a: { uid?: string; name: string }) => a.uid ?? `name:${a.name}`;
  for (const r of withAgents) for (const a of r.agents) {
    const k = keyOf(a);
    if (agentUid.has(k)) continue;
    const uid = `demo:${seats.length + 1}`;
    agentUid.set(k, uid);
    seats.push({ uid, name: name(), team: a.team });
  }

  // Leaders: one invented person per real name or uid.
  const leaderByName = new Map<string, { uid: string; name: string }>();
  const leaderByUid = new Map<string, { uid: string; name: string }>();
  let leaders = 0;
  const newLeader = () => ({ uid: `demo:lead:${++leaders}`, name: name() });
  const leaderNamed = (real: string) => {
    let l = leaderByName.get(real);
    if (!l) leaderByName.set(real, (l = newLeader()));
    return l;
  };

  const org: Team[] = [];
  const seen = new Set<string>();
  for (const r of withAgents) for (const t of r.org) {
    if (seen.has(t.team)) continue;
    seen.add(t.team);
    org.push({ team: t.team, lob: t.lob, tl: t.tl ? leaderNamed(t.tl).name : "", mgr: t.mgr ? leaderNamed(t.mgr).name : "" });
  }
  // A roster without leaders (older saves, or before the reporting lines arrive): invent a Team Lead per team
  // and a Manager per few teams, so call-outs still say who they went to.
  if (org.every(t => !t.tl && !t.mgr)) {
    let mgr = "";
    org.forEach((t, i) => {
      if (i % TEAMS_PER_MGR === 0) mgr = newLeader().name;
      t.tl = newLeader().name;
      t.mgr = mgr;
    });
  }

  // Queue membership, remapped. Older saves list members by name.
  const members: Record<string, string[]> = {};
  for (const r of withAgents) for (const [queue, ids] of Object.entries(r.members ?? {})) {
    const into = (members[queue] ??= []);
    for (const id of ids) {
      const uid = agentUid.get(id) ?? agentUid.get(`name:${id}`);
      if (uid && !into.includes(uid)) into.push(uid);
    }
  }

  // Reporting lines: the real ones remapped when a roster has them, otherwise from the teams.
  const realPeople = withAgents.flatMap(r => r.people ?? []);
  let people: OrgPerson[];
  if (realPeople.length) {
    const mapUid = (uid: string) => {
      const agent = agentUid.get(uid);
      if (agent) return agent;
      let l = leaderByUid.get(uid);
      if (!l) leaderByUid.set(uid, (l = newLeader()));
      return l.uid;
    };
    const nameOf = new Map(seats.map(s => [s.uid, s.name]));
    const out = new Map<string, OrgPerson>();
    for (const p of realPeople) {
      const uid = mapUid(p.uid);
      if (out.has(uid)) continue;
      const leader = [...leaderByUid.values()].find(l => l.uid === uid);
      out.set(uid, { uid, name: nameOf.get(uid) ?? leader?.name ?? name(), supervisor: p.supervisor ? mapUid(p.supervisor) : null });
    }
    people = [...out.values()];
  } else {
    people = teamLines(org, seats.map(s => ({ uid: s.uid!, name: s.name, team: s.team })), "demo:");
  }

  return { org, seats, real: false, members, people };
}
