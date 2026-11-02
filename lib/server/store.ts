import { createDb } from "@/lib/db/client";
import { type Env, env } from "@/lib/env";
import { memoryStore } from "@/lib/store/memory";
import { postgresStore } from "@/lib/store/postgres";
import type { Store } from "@/lib/store/store";
import type { Rule } from "@/lib/types";

// The process's store, opened once at start-up (instrumentation.ts), before any request.
// Kept on globalThis so route handlers and the runtime share it, as they share the registry.

const g = globalThis as typeof globalThis & { __rtmStore?: Store; __rtmBootRules?: Rule[] };

export function openStore(e: Env): Store {
  return e.PERSISTENCE_MODE === "postgres" ? postgresStore(createDb(e)) : memoryStore();
}

/**
 * Check the settings, open the store and load the rules. Throws when anything is wrong: the
 * server must not take requests without knowing its current rules.
 */
export async function boot(): Promise<void> {
  const s = (g.__rtmStore ??= openStore(env()));
  g.__rtmBootRules = await s.loadRules();
}

/** The store opened at start-up. Outside a server (unit tests) it is the memory store, where that is allowed. */
export function store(): Store {
  if (g.__rtmStore) return g.__rtmStore;
  if (env().PERSISTENCE_MODE === "postgres") throw new Error("The store was not opened at start-up (instrumentation.ts).");
  return (g.__rtmStore = memoryStore());
}

/** The rules as loaded at start-up, or undefined before then. */
export const bootRules = (): Rule[] | undefined => g.__rtmBootRules;
