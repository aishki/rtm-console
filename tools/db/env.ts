import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import { type DbEnv, parseDbEnv } from "../../lib/env";

/** The repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The database settings, from the shell then .env.local (as Next.js reads them). Exits with the problems listed when they are not valid. */
export function dbEnv(): DbEnv {
  loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });
  try {
    return parseDbEnv(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

/** Stop unless this is a developer's machine or a test run. */
export function localOnly(e: DbEnv, what: string): void {
  if (e.APP_ENV !== "development" && e.APP_ENV !== "test") {
    console.error(`${what} is for local work only, and APP_ENV is ${e.APP_ENV}. In production, fix a bad migration with a new one.`);
    process.exit(1);
  }
}
