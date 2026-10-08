"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { usePerms } from "@/lib/client/hooks";
import { connect, disconnect, useConsole } from "@/lib/client/store";
import { TABS } from "@/lib/ui/palette";
import { BitsLogo } from "@/components/ui/LogoLockup";
import { ContextBar } from "./ContextBar";
import { Navbar } from "./Navbar";
import { NudgePopup } from "./NudgePopup";
import { ToastStack } from "./ToastStack";

/** Notes on the left, wrapping as one block; the credit on the right, centred against however many lines the notes take. */
function Footer() {
  return (
    <footer className="flex flex-wrap items-center gap-x-10 gap-y-4 border-t border-purple bg-white px-8 py-[18px] text-xs leading-normal text-muted">
      <div className="flex min-w-0 flex-[1_1_480px] flex-wrap gap-x-8 gap-y-2">
        <span><b className="text-ink">Data source:</b> the rules engine binds to the Gencloud/NiceIEX real-time API.</span>
        <span><b className="text-ink">Escalation ladder:</b> Nudge, then Leader, then Ops (per-rule routes configurable).</span>
        <span><b className="text-ink">3× rule:</b> the third instance assigns an incident number and opens an investigation.</span>
        <span><b className="text-ink">Views:</b> TL sees direct reports · Manager sees their span, incident tiles and rules admin · Admin sees everything · Senior Leader sees dashboards · Agent sees their own pop-ups.</span>
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2">
        <span className="inline-flex items-center gap-2">Powered by <BitsLogo height={28} /></span>
        <span>© 2026 CGSPH. All rights reserved.</span>
      </div>
    </footer>
  );
}

/** Layout chrome plus the live connection. Pages render only for roles that may open them. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const status = useConsole(s => s.status);
  const perms = usePerms();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => { void connect(); return disconnect; }, []);

  const current = TABS.find(t => pathname === t.href || pathname.startsWith(t.href + "/"))?.id;
  const allowed = !!perms && !!current && perms.tabs.includes(current);
  // If the current tab is hidden for this role, open the first allowed tab.
  const fallback = perms && !allowed ? TABS.find(t => t.id === perms.tabs[0])?.href : undefined;
  useEffect(() => { if (fallback) router.replace(fallback); }, [fallback, router]);

  return (
    <div className="flex min-h-screen flex-col bg-page text-sm text-ink">
      <header className="sticky top-0 z-40 bg-white">
        <Navbar current={allowed ? current : undefined} />
        <ContextBar />
      </header>
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-4 pb-10 pt-6 sm:px-8">
        {status === "unauthorized" ? (
          <div className="panel mx-auto mt-10 max-w-[560px] p-7 text-center">
            <h1 className="panel-title">Sign-in required</h1>
            <p className="mb-0 mt-2 leading-normal text-muted">Your role and span come from single sign-on, which is not connected in this environment.</p>
          </div>
        ) : allowed ? children : null}
      </main>
      <Footer />
      <ToastStack />
      <NudgePopup />
    </div>
  );
}
