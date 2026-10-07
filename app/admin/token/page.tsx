"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { PurpleButton } from "@/components/ui/buttons";
import { PageTitle } from "@/components/ui/primitives";

type Result = { ok: true; text: string } | { ok: false; text: string } | null;

/** Paste a fresh Genesys bearer token; the live feed reconnects with it without a server restart. */
export default function TokenPage() {
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
        body: JSON.stringify({ secret, token }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; who?: string | null; error?: string };
      if (res.ok && j.ok) {
        setResult({ ok: true, text: `Token accepted for ${j.who ?? "an unnamed user"}. The live feed is reconnecting.` });
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
        Copy the Authorization header from any api.mypurecloud.com request in the browser&apos;s DevTools Network tab and paste it below.
        The token is checked with Genesys, kept on the server, and the live feed reconnects with it. The floor, ledger and strikes are kept.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
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
