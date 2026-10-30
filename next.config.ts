import type { NextConfig } from "next";
import { parsePublicEnv } from "./lib/env";

// The NEXT_PUBLIC_* settings are built into the browser bundle, so they are checked here, at build
// time (and when the dev server starts). The server's own settings are checked at start-up (instrumentation.ts).
parsePublicEnv(process.env);

const nextConfig: NextConfig = {
  // Spreadsheet I/O for the floor data import, desktop alerts and the PostgreSQL driver run in Node,
  // loaded from node_modules at run time rather than bundled.
  serverExternalPackages: ["exceljs", "web-push", "pg"],
};

export default nextConfig;
