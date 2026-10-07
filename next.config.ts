import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spreadsheet I/O for the floor data import runs in Node, not in the bundle.
  serverExternalPackages: ["exceljs", "web-push"],
};

export default nextConfig;
