"use client";

import { DEV_TOOLS } from "@/lib/client/devSettings";
import { type ToastItem, useConsole } from "@/lib/client/store";
import { TOAST } from "@/lib/ui/palette";

export function Toast({ toast }: { toast: ToastItem }) {
  const c = TOAST[toast.kind];
  return (
    <div role="status" className="flex gap-3 rounded-15 bg-white px-4 py-3.5 shadow-[var(--shadow-toast)]">
      <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.dot }} />
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-sm font-semibold" style={{ color: c.fg }}>{toast.title}</span>
        <span className="text-[13px] leading-[1.45] text-muted">{toast.body}</span>
      </div>
    </div>
  );
}

/**
 * Fixed bottom-right on wide screens, clear of the KPI tiles and the top of the Trigger feed; the newest sits nearest the corner.
 * Below lg the nudge pop-up owns the bottom edge, so the stack stays top-right under the header.
 * At most four toasts, each gone after 8 seconds on screen.
 */
export function ToastStack() {
  const toasts = useConsole(s => s.toasts);
  return (
    // In development the dev bar (about 92px tall when it wraps) sits above the header. TODO(prod): drop the DEV_TOOLS branch.
    <div className={`fixed right-6 z-[60] flex w-[360px] max-w-[calc(100vw-48px)] flex-col gap-2.5 lg:bottom-6 lg:top-auto ${DEV_TOOLS ? "top-[280px] sm:top-[297px]" : "top-[188px] sm:top-[205px]"}`}>
      {toasts.map(t => <Toast key={t.id} toast={t} />)}
    </div>
  );
}
