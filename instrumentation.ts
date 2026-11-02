// Runs once when the server starts, before it takes a request (Next.js calls register() and waits).
// The settings are checked and the store opened here, so a broken deployment stops now with one
// readable message instead of failing when a feature is first used.

export async function register() {
  // NEXT_RUNTIME is Next.js's own: register() also runs for the edge runtime, which has no database.
  // The Node-only code lives in its own file so the edge build never sees it.
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
