import { describe, expect, it } from "vitest";
import type { OrgPerson } from "@/lib/types";
import type { UserLine } from "./client";
import { type LineSources, resolveLines } from "./lines";

// Invented Genesys users. Names end in " - <Domain ID>", as the org names accounts.
const U = (id: string, did: string, managerId: string | null): UserLine => ({ id, name: `Person, ${id} - ${did}`, managerId });
const USERS: UserLine[] = [
  U("a1", "AA00001", "tl1"), U("a2", "AA00002", null), U("a3", "AA00003", "gone"), U("a4", "AA00004", null),
  U("tl1", "TL00001", "mgr"), U("tl2", "TL00002", null), U("mgr", "MG00001", null),
];
const agents = USERS.filter(u => u.id.startsWith("a")).map(u => ({ uid: u.id, name: u.name }));

function sources(directory?: Record<string, string | null>) {
  const asked: string[] = [], searched: string[] = [];
  const src: LineSources = {
    async users(ids) { return USERS.filter(u => ids.includes(u.id)); },
    async byDomainId(did) { searched.push(did); return USERS.find(u => u.name.endsWith(` - ${did}`)) ?? null; },
    ...(directory && { managerOf: async (did: string) => { asked.push(did); return did in directory ? directory[did] : null; } }),
  };
  return { src, asked, searched };
}
const lineOf = (people: OrgPerson[], uid: string) => people.find(p => p.uid === uid)?.supervisor;

describe("resolveLines", () => {
  it("takes Genesys supervisors and the chain above them; an inactive or missing supervisor counts as none", async () => {
    const sent: OrgPerson[][] = [];
    const { src } = sources();
    const counts = await resolveLines(agents, src, p => sent.push(p));
    expect(sent).toHaveLength(1);
    expect(lineOf(sent[0], "a1")).toBe("tl1");
    expect(lineOf(sent[0], "tl1")).toBe("mgr");
    expect(lineOf(sent[0], "a3")).toBeNull();
    expect(counts).toEqual({ agents: 4, genesys: 1, directory: 0, none: 3 });
  });

  it("fills gaps from the CGS directory, matched to Genesys users by Domain ID, and Genesys stays first", async () => {
    const sent: OrgPerson[][] = [];
    // a2 and a3 get tl2 from the directory; tl2 (their new Team Lead) gets the Manager. a4 is not in the directory.
    const { src, asked } = sources({ AA00002: "TL00002", AA00003: "tl00002", TL00002: "MG00001", AA00001: "XX99999" });
    const counts = await resolveLines(agents, src, p => sent.push(p));
    const last = sent.at(-1)!;
    expect(lineOf(last, "a2")).toBe("tl2");
    expect(lineOf(last, "a3")).toBe("tl2");
    expect(lineOf(last, "tl2")).toBe("mgr");
    expect(lineOf(last, "a4")).toBeNull();
    // a1 has a Genesys supervisor, so the directory is not asked about them.
    expect(asked).not.toContain("AA00001");
    expect(counts).toEqual({ agents: 4, genesys: 1, directory: 2, none: 1 });
  });

  it("looks up a manager who is not on the floor by Domain ID, once", async () => {
    const { src, searched } = sources({ AA00002: "TL00002", AA00004: "TL00002" });
    await resolveLines(agents, src, () => {});
    expect(searched).toEqual(["TL00002"]);
  });

  it("sends nothing more once stopped", async () => {
    const sent: OrgPerson[][] = [];
    let stop = false;
    const { src } = sources({ AA00002: "TL00002" });
    const managerOf = src.managerOf!;
    src.managerOf = async did => { stop = true; return managerOf(did); };
    expect(await resolveLines(agents, src, p => sent.push(p), () => stop)).toBeNull();
    expect(sent).toHaveLength(1);
  });
});
