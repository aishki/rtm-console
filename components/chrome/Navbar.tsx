"use client";

import Link from "next/link";
import { ROLE_LABEL } from "@/lib/engine/rules";
import { useOpenCounts, usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import { TABS } from "@/lib/ui/palette";
import type { TabId } from "@/lib/types";
import { CarelonLogo, CarelonMark, carelonClearSpace } from "@/components/ui/LogoLockup";

const LOGO_HEIGHT = 22;

/** Sticky white bar: logos, product name, role-filtered tabs with badges, viewer chip. */
export function Navbar({ current }: { current: TabId | undefined }) {
  const view = useConsole(s => s.view);
  const perms = usePerms();
  const { openInstances, openInvestigations } = useOpenCounts();
  const tabs = TABS.filter(t => perms?.tabs.includes(t.id));
  const name = view ? view.who ?? (view.role === "admin" ? "WFM Admin" : "Senior Leader") : "";
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-x-7 px-4 shadow-[inset_0_-1px_0_var(--border-hairline)] sm:px-8">
      <div className="order-none flex h-16 min-w-0 shrink-0 items-center gap-5 sm:h-[81px]">
        {/* The logo carries its own clear space; the page gutter already covers its left side. */}
        <div className="hidden items-center w720:flex" style={{ marginLeft: -carelonClearSpace(LOGO_HEIGHT) }}>
          <CarelonLogo height={LOGO_HEIGHT} />
          <div className="h-8 w-px bg-hairline" />
        </div>
        <div className="w720:hidden"><CarelonMark size={32} /></div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="whitespace-nowrap text-lg font-semibold leading-normal tracking-[-0.01em] text-purple">RTM Console</span>
          <span className="hidden whitespace-nowrap text-xs text-muted w900:inline">Real-Time Monitoring &amp; Escalation</span>
        </div>
      </div>

      <nav
        aria-label="Console sections"
        className="scrollbar-none order-3 -mx-4 flex h-[52px] min-w-0 flex-[1_1_100%] gap-1 overflow-x-auto overflow-y-hidden px-1 shadow-[inset_0_1px_0_var(--border-hairline)] sm:-mx-8 sm:px-5 xl:order-1 xl:mx-0 xl:h-[81px] xl:flex-[1_1_auto] xl:px-0 xl:shadow-none"
      >
        {tabs.map(t => {
          const active = t.id === current;
          const badge = t.id === "ledger" ? openInstances : t.id === "dash" ? openInvestigations : 0;
          return (
            <Link
              key={t.id} href={t.href} aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-3 text-[15px] font-semibold no-underline transition-colors duration-200 ease-standard xl:px-4 xl:text-base ${active ? "text-purple shadow-[inset_0_-3px_0_var(--purple)] hover:text-purple" : "text-strong hover:text-purple"}`}
            >
              <span>{t.label}</span>
              {badge > 0 && (
                <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-pill px-[7px] font-ui text-xs font-semibold text-white" style={{ background: t.id === "ledger" ? "var(--error)" : "var(--purple)" }}>
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="order-2 ml-auto flex h-16 shrink-0 items-center gap-3 sm:h-[81px]">
        <div className="flex h-10 w-10 items-center justify-center rounded-30 bg-primary-300 text-sm font-semibold text-purple">{initials}</div>
        <div className="hidden flex-col gap-0.5 w560:flex">
          <span className="whitespace-nowrap text-sm font-semibold">{name}</span>
          <span className="whitespace-nowrap text-xs text-muted">{view ? ROLE_LABEL[view.role] : ""}</span>
        </div>
      </div>
    </div>
  );
}
