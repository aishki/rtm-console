// Lists every queue the Genesys token can read, with its ID, so a queue can be added to the
// watched set later. Writes .rtm/genesys-queues.csv (gitignored: queue names and IDs are internal).
//
//   node tools/list-queues.mjs
//
// Reads GENESYS_TOKEN, GENCLOUD_API_BASE and RTM_VIEW_CONFIG_ID from .env.local, as the console does.
// Read-only; prints counts, never the token.
import fs from "node:fs";

const env = { ...process.env };
if (fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const base = env.GENCLOUD_API_BASE || "https://api.mypurecloud.com";
const viewId = env.RTM_VIEW_CONFIG_ID || "9c9f8fd2-acab-4282-9442-ddba152f9c18";
if (!env.GENESYS_TOKEN) { console.error("GENESYS_TOKEN is not set"); process.exit(1); }
const headers = { Authorization: `Bearer ${env.GENESYS_TOKEN}` };

async function get(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + path, { headers });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path.replace(/\?.*/, "")}`);
    return res.json();
  }
}

const view = await get(`/api/v2/analytics/reporting/settings/viewconfigurations/${encodeURIComponent(viewId)}`);
const watched = new Set(view?.filter?.queueIds ?? []);

const queues = [];
for (let page = 1; ; page++) {
  const r = await get(`/api/v2/routing/queues?pageSize=100&pageNumber=${page}&sortOrder=asc`);
  for (const q of r.entities ?? []) {
    queues.push({
      id: q.id,
      name: q.name ?? "",
      division: q.division?.name ?? "",
      members: q.memberCount ?? 0,
      watched: watched.has(q.id) ? "yes" : "",
    });
  }
  if (page >= (r.pageCount ?? 1)) break;
  await new Promise((r) => setTimeout(r, 250)); // the console's bulk pace: 4 a second
}
queues.sort((a, b) => a.name.localeCompare(b.name));

const cell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const rows = [["queueId", "name", "division", "members", "watched"], ...queues.map((q) => [q.id, q.name, q.division, q.members, q.watched])];
fs.mkdirSync(".rtm", { recursive: true });
fs.writeFileSync(".rtm/genesys-queues.csv", rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n");

const divisions = new Set(queues.map((q) => q.division)).size;
console.log(`${queues.length} readable queues in ${divisions} divisions; ${queues.filter((q) => q.watched).length} watched by view ${viewId}; ${queues.filter((q) => q.members === 0).length} with no members`);
console.log("Wrote .rtm/genesys-queues.csv");
