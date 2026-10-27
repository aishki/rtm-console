"use client";

import { type FormEvent, use, useState } from "react";
import Link from "next/link";
import { PurpleButton } from "@/components/ui/buttons";
import { PageTitle } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { DEFAULT_ORG, ORGS, type OrgId, isOrgId, orgOf } from "@/lib/orgs";

const ORG_OPTIONS = ORGS.map(o => ({ value: o.id, label: `${o.name} · Genesys ${o.region}` }));

type Result = { ok: true; text: string } | { ok: false; text: string } | null;

/** Paste a fresh Genesys bearer token for one org; that org's live feed reconnects with it without a server restart. */
export default function TokenPage({ searchParams }: { searchParams: Promise<{ org?: string | string[] }> }) {
  // The feed pill's "Refresh token" link names the org on screen.
  const asked = use(searchParams).org;
  const [org, setOrg] = useState<OrgId>(isOrgId(asked) ? asked : DEFAULT_ORG);
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, token, org }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; who?: string | null; genesysOrg?: string | null; queues?: number; forbidden?: number; error?: string };
      if (res.ok && j.ok) {
        setResult({ ok: true, text: `Token accepted for ${j.who ?? "an unnamed user"}${j.genesysOrg ? ` in ${j.genesysOrg}` : ""}, watching ${j.queues ?? 0} queues${j.forbidden ? ` (${j.forbidden} left out: no permission to read their statistics)` : ""}. ${orgOf(org).name}'s live feed is reconnecting.` });
        setToken("");
      } else {
        setResult({ ok: false, text: j.error ?? `Request failed (${res.status}).` });
      }
    } catch {
      setResult({ ok: false, text: "Request failed. Check that the server is running." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-[560px] flex-col gap-6 px-4 py-10">
      <PageTitle eyebrow="Admin" title="Refresh Genesys token" />
      <p className="m-0 text-sm leading-normal text-strong">
        Pick the org, then copy the Authorization header from any Genesys API request in that org (api.mypurecloud.com for US East, api.usw2.pure.cloud for US West) in the browser&apos;s DevTools Network tab and paste it below.
        The token is checked with Genesys (it must be able to see the watched queues and their statistics), kept on the server, and the live feed reconnects with it. The floor, ledger and strikes are kept.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 text-sm font-medium text-strong">
          <span>Genesys org</span>
          <Select value={org} onChange={setOrg} options={ORG_OPTIONS} aria-label="Genesys org" className="h-10" />
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-strong">
          Admin secret
          <input type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="off" className="field h-10 px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-strong">
          Bearer token
          <textarea value={token} onChange={e => setToken(e.target.value)} rows={6} autoComplete="off" spellCheck={false} className="field resize-y px-3 py-2.5 font-ui text-[13px]" />
        </label>
        <div className="flex items-center gap-4">
          <PurpleButton type="submit" disabled={busy || !secret || !token}>{busy ? "Checking…" : "Save token"}</PurpleButton>
          <Link href="/console" className="text-sm font-medium text-purple">Back to the console</Link>
        </div>
      </form>
      <p role="status" className="m-0 min-h-5 text-sm" style={{ color: result ? (result.ok ? "var(--turquoise-text)" : "var(--error)") : undefined }}>
        {result?.text}
      </p>
    </main>
  );
}
