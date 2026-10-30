import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "kysely-ctl";
import { createPool } from "./lib/db/client";
import { parseDbEnv } from "./lib/env";

// kysely-ctl's configuration: npm run db:migrate, db:make, db:status and db:rollback.
// Settings come from the environment, then .env.local, the same way Next.js reads them (a variable
// already set in the shell wins). Only the database settings are checked, and only when a command
// connects, so db:make works with no database at all.

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnvConfig(root, true, { info: () => {}, error: console.error });

export default defineConfig({
  dialect: "pg",
  dialectConfig: () => ({ pool: async () => createPool(parseDbEnv(process.env)) }),
  migrations: { migrationFolder: path.join(root, "lib/db/migrations") },
});
