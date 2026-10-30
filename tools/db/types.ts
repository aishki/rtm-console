import { spawnSync } from "node:child_process";
import path from "node:path";
import { databaseUrl } from "../../lib/db/url";
import { ROOT, dbEnv, localOnly } from "./env";

// npm run db:types: regenerate lib/db/schema.ts from a migrated local database. Commit the result
// with the migration that changed it. The URL goes to kysely-codegen in its environment, never on
// the command line.

const e = dbEnv();
localOnly(e, "db:types");
const bin = path.join(ROOT, "node_modules/kysely-codegen/dist/cli/bin.js");
const r = spawnSync(process.execPath, [bin, "--dialect", "postgres", "--out-file", "lib/db/schema.ts", "--exclude-pattern", "kysely_*", ...(e.DB_SCHEMA ? ["--default-schema", e.DB_SCHEMA] : [])], {
  cwd: ROOT, stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl(e) },
});
process.exit(r.status ?? 1);
