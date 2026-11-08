import { createDb } from "@/lib/db/client";
import { type Env, env } from "@/lib/env";
import type { QueueMapRow } from "@/lib/import/queueMap";
import type { OrgId } from "@/lib/orgs";
import { memoryStore } from "@/lib/store/memory";
import { postgresStore } from "@/lib/store/postgres";
import type { BootData, RosterNames, SavedSubscription, Store } from "@/lib/store/store";
import type { Rule } from "@/lib/types";

// The process's store, opened once at start-up (instrumentation.ts), before any request.
// Kept on globalThis so route handlers and the runtime share it, as they share the registry.

const g = globalThis as typeof globalThis & { __rtmStore?: Store; __rtmBoot?: BootData };

export function openStore(e: Env): Store {
  return e.PERSISTENCE_MODE === "postgres" ? postgresStore(createDb(e)) : memoryStore();
}

/**
 * Check the settings, open the store and load what it keeps. Throws when anything is wrong: the
 * server must not take requests without knowing its current rules.
 */
export async function boot(): Promise<void> {
  const s = (g.__rtmStore ??= openStore(env()));
  const rules = await s.loadRules();
  g.__rtmBoot = { rules, ...(await s.loadBoot()) };
}

/** The store opened at start-up. Outside a server (unit tests) it is the memory store, where that is allowed. */
export function store(): Store {
  if (g.__rtmStore) return g.__rtmStore;
  if (env().PERSISTENCE_MODE === "postgres") throw new Error("The store was not opened at start-up (instrumentation.ts).");
  return (g.__rtmStore = memoryStore());
}

// What the store loaded at start-up. Each is undefined before then (outside a server, unit tests).

export const bootRules = (): Rule[] | undefined => g.__rtmBoot?.rules;
export const bootQueueMap = (): QueueMapRow[] | undefined => g.__rtmBoot?.queueMap;
/** Undefined when the store left it to be read on first use (the memory store). */
export const bootRoster = (org: OrgId): RosterNames | null | undefined => g.__rtmBoot?.rosters[org];
export const bootSubscriptions = (): SavedSubscription[] => g.__rtmBoot?.subscriptions ?? [];
export const bootActiveOrg = (): OrgId | undefined => g.__rtmBoot?.activeOrg;
