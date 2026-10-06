"use client";

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

/** Fixed top-right, under the header. At most four toasts, each gone after 8 seconds. */
export function ToastStack() {
  const toasts = useConsole(s => s.toasts);
  return (
    <div className="fixed right-6 top-[188px] z-[60] flex w-[360px] max-w-[calc(100vw-48px)] flex-col gap-2.5 sm:top-[205px] xl:top-[152px]">
      {toasts.map(t => <Toast key={t.id} toast={t} />)}
    </div>
  );
}
