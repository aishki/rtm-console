import { useConsole } from "./store";

// Preview stand-in for the app's API client: nothing is sent; view and data-source changes update the sample state.
export class ApiError extends Error {
  details: string[];
  constructor(message: string, details: string[] = [message]) { super(message); this.details = details; }
}
export async function attempt<T>(action: Promise<T>): Promise<T | undefined> {
  try { return await action; } catch { return undefined; }
}
const ok = async () => true;
export const api = new Proxy({
  async setView(role: string, who: string | null) {
    const p = useConsole.getState().people;
    const first = role === "tl" ? p?.tls[0] : role === "mgr" ? p?.mgrs[0] : role === "agent" ? p?.agentsByTeam[0]?.agents[0] : null;
    useConsole.setState({ view: { role, who: who ?? first ?? null } });
    return true;
  },
  async setFeed(feed: string) { useConsole.setState({ feed }); return { feed, realNames: false }; },
  async peopleStates() { return { states: Object.fromEntries(useConsole.getState().agents.map((a: { name: string; state: string }) => [a.name, a.state])) }; },
  async validateImport() { throw new ApiError("This preview is not connected to a server, so the file was not checked."); },
  async startReplay() { throw new ApiError("This preview is not connected to a server, so no replay was started."); },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as Record<string, (...args: any[]) => Promise<any>>, { get: (t, k: string) => t[k] ?? ok });
export function download(): void {}
export function downloadText(): void {}
