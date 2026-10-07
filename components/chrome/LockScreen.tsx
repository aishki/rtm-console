"use client";

import { type FormEvent, useState } from "react";
import { PurpleButton } from "@/components/ui/buttons";
import { CarelonLogo, carelonClearSpace } from "@/components/ui/LogoLockup";

/** The password wall at "/". A correct password sets the unlock cookie; the console opens after. */
export function LockScreen({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next }),
      });
      const j = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
      if (res.ok && j.next) { window.location.replace(j.next); return; }
      setError(j.error ?? `Request failed (${res.status}).`);
      setPassword("");
    } catch {
      setError("Request failed. Check that the server is running.");
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--light-gray)] px-4">
      <form onSubmit={submit} className="flex w-full max-w-[400px] flex-col gap-5 rounded-16 bg-white px-8 py-9 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        {/* The wordmark pads itself by its clear space; the card's own padding already gives it room. */}
        <div style={{ margin: -carelonClearSpace(22) }}><CarelonLogo height={22} /></div>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-2xl font-medium leading-[1.15] tracking-[-0.02em] text-purple">RTM Console</h1>
          <p className="m-0 text-sm text-muted">Enter the console password to continue.</p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-strong">
          Password
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="current-password"
            aria-invalid={!!error} aria-describedby={error ? "lock-error" : undefined}
            className={`field h-10 px-3 text-sm ${error ? "border-[var(--error)]" : ""}`}
          />
        </label>
        <PurpleButton type="submit" disabled={busy || !password}>{busy ? "Checking…" : "Unlock"}</PurpleButton>
        <p id="lock-error" role="alert" className="m-0 min-h-5 text-sm" style={{ color: "var(--error)" }}>{error}</p>
      </form>
    </main>
  );
}
