import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { genesysToken, saveGenesysToken, validAdminSecret } from "./tokenStore";

describe("genesys token store", () => {
  const dirs: string[] = [];
  const tmpFile = () => { const d = mkdtempSync(path.join(tmpdir(), "rtm-token-")); dirs.push(d); return path.join(d, "sub", "genesys-token"); };
  afterEach(() => { vi.unstubAllEnvs(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it("falls back to GENESYS_TOKEN until a token is saved", () => {
    vi.stubEnv("GENESYS_TOKEN", "from-env");
    const file = tmpFile();
    expect(genesysToken(file)).toBe("from-env");
    saveGenesysToken("  pasted  \n", file);
    expect(readFileSync(file, "utf8")).toBe("pasted");
    expect(genesysToken(file)).toBe("pasted");
  });

  it("is undefined with neither a saved token nor GENESYS_TOKEN", () => {
    vi.stubEnv("GENESYS_TOKEN", "");
    expect(genesysToken(tmpFile()) || undefined).toBeUndefined();
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
