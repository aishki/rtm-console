// The Node.js half of instrumentation.ts: check the settings, open the store, load the rules.
// On failure, print why and stop the process.
import { boot } from "./lib/server/store";

try {
  await boot();
} catch (e) {
  console.error(`\nRTM Console cannot start.\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
