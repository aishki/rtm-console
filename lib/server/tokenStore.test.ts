import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { genesysToken, loadActiveOrg, saveActiveOrg, saveGenesysToken, tokenFile, validAdminSecret } from "./tokenStore";

describe("genesys token store", () => {
  const dirs: string[] = [];
  const tmpDir = () => { const d = mkdtempSync(path.join(tmpdir(), "rtm-token-")); dirs.push(d); return path.join(d, "sub"); };
  afterEach(() => { vi.unstubAllEnvs(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it("falls back to GENESYS_TOKEN for Commercial until a token is saved", () => {
    vi.stubEnv("GENESYS_TOKEN", "from-env");
    const dir = tmpDir();
    expect(genesysToken("commercial", dir)).toBe("from-env");
    saveGenesysToken("commercial", "  pasted  \n", dir);
    expect(readFileSync(tokenFile("commercial", dir), "utf8")).toBe("pasted");
    expect(genesysToken("commercial", dir)).toBe("pasted");
  });

  it("keeps each org's token apart, each seeded by its own env variable", () => {
    vi.stubEnv("GENESYS_TOKEN", "from-env");
    vi.stubEnv("GBD_TOKEN", "Bearer gbd-from-env");
    vi.stubEnv("SPECIALTY_TOKEN", "");
    const dir = tmpDir();
    expect(genesysToken("gbd", dir)).toBe("gbd-from-env");
    saveGenesysToken("gbd", "gbd-token", dir);
    expect(genesysToken("gbd", dir)).toBe("gbd-token");
    expect(genesysToken("specialty", dir)).toBeUndefined();
    expect(genesysToken("commercial", dir)).toBe("from-env");
    expect(tokenFile("commercial", dir)).toBe(path.join(dir, "genesys-token"));
  });

  it("is undefined with neither a saved token nor GENESYS_TOKEN", () => {
    vi.stubEnv("GENESYS_TOKEN", "");
    expect(genesysToken("commercial", tmpDir()) || undefined).toBeUndefined();
  });
});

describe("active org", () => {
  it("is Commercial until another is saved, and ignores an unknown id", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rtm-org-"));
    try {
      expect(loadActiveOrg(dir)).toBe("commercial");
      saveActiveOrg("gbd", dir);
      expect(loadActiveOrg(dir)).toBe("gbd");
      writeFileSync(path.join(dir, "genesys-org"), "elsewhere");
      expect(loadActiveOrg(dir)).toBe("commercial");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("admin secret", () => {
  it("matches only the configured secret", () => {
    expect(validAdminSecret("s3cret", "s3cret")).toBe(true);
    expect(validAdminSecret("s3cre", "s3cret")).toBe(false);
    expect(validAdminSecret("other!", "s3cret")).toBe(false);
  });

  it("refuses everything while no secret is configured", () => {
    expect(validAdminSecret("", "")).toBe(false);
    expect(validAdminSecret("anything", "")).toBe(false);
  });
});
