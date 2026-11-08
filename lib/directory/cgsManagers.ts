// The CGS associate directory (the CGSAuth API's GET /api/associate), used for one thing: the
// supervisor of an agent who has none set in Genesys. Only `managerDomainId` is read from the
// record. The rest (personal email, phone, gender, hire date) is never kept or logged.
// Server-to-server only: the API key never reaches the browser.

/**
 * The manager's Domain ID for an associate. null: the directory has no record or no manager.
 * undefined: it could not be asked (outage, rate limit, rejected key), so ask again another time.
 */
export type ManagerLookup = (domainId: string) => Promise<string | null | undefined>;

/** Saved answers, so a restart does not ask the directory about the whole floor again. */
export interface ManagerCache {
  get(domainId: string): { manager: string | null; at: number } | undefined;
  set(domainId: string, manager: string | null, at: number): void;
}

export interface CgsConfig {
  baseUrl: string;
  apiKey: string;
  cache?: ManagerCache;
  fetchFn?: typeof fetch;
  /** Time between requests. The directory's limits are not published: one a second stays well clear. */
  spacingMs?: number;
  /** Wait after a 429 before trying again. */
  rateLimitPauseMs?: number;
  now?: () => number;
  /** For warnings. Never given the record, the key or a Domain ID. */
  warn?: (msg: string) => void;
}

const TIMEOUT_MS = 8000;
const SPACING_MS = 1000;
const RATE_LIMIT_PAUSE_MS = 60_000;
const RATE_LIMIT_RETRIES = 2;
/** An answer is asked again after this long: people change supervisors. */
export const CACHE_MS = 7 * 86_400_000;

const canonical = (id: string) => id.trim().toUpperCase();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function cgsManagerLookup(cfg: CgsConfig): ManagerLookup {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const fetchFn = cfg.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const spacing = cfg.spacingMs ?? SPACING_MS, pause = cfg.rateLimitPauseMs ?? RATE_LIMIT_PAUSE_MS;
  const now = cfg.now ?? Date.now;
  const warn = cfg.warn ?? (() => {});
  let nextAt = 0;
  let keyRejected = false;

  /** One request, spaced from the last. */
  async function ask(domainId: string): Promise<Response | null> {
    const t = now(), at = Math.max(t, nextAt);
    nextAt = at + spacing;
    if (at > t) await sleep(at - t);
    try {
      return await fetchFn(`${base}/api/associate?domainId=${encodeURIComponent(domainId)}`, {
        headers: { "x-api-key": cfg.apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch { return null; }
  }

  return async (raw: string) => {
    const domainId = canonical(raw);
    if (!domainId || keyRejected) return undefined;
    const saved = cfg.cache?.get(domainId);
    if (saved && now() - saved.at < CACHE_MS) return saved.manager;
    for (let attempt = 0; ; attempt++) {
      const res = await ask(domainId);
      if (!res) return undefined;
      if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) { await sleep(pause); continue; }
      if (res.status === 401 || res.status === 403) {
        keyRejected = true;
        warn(`CGS directory: HTTP ${res.status}, the API key was rejected; supervisors are not filled in from it until restart`);
        return undefined;
      }
      // No such associate: a normal answer, kept like any other.
      if (res.status === 400 || res.status === 404) { cfg.cache?.set(domainId, null, now()); return null; }
      if (res.status !== 200) return undefined;
      const body: unknown = await res.json().catch(() => undefined);
      if (body === undefined) return undefined;
      const m = body && typeof body === "object" ? (body as { managerDomainId?: unknown }).managerDomainId : undefined;
      const manager = typeof m === "string" && m.trim() ? canonical(m) : null;
      cfg.cache?.set(domainId, manager, now());
      return manager;
    }
  };
}
