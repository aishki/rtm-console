import { Fragment, memo } from "react";
import { clock } from "@/lib/engine/format";
import { SEV, STAGE, STAGE_ORDER } from "@/lib/ui/palette";
import type { Instance, Stage } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { StatusPill } from "@/components/ui/primitives";

/** Nudge / Leader / Ops pips, filled up to the stage the call-out reached. */
export function Ladder({ stage }: { stage: Stage }) {
  const hit = STAGE_ORDER.indexOf(stage);
  return (
    <div className="flex items-center">
      {STAGE_ORDER.map((s, i) => {
        const on = i <= hit, c = STAGE[s];
        return (
          <Fragment key={s}>
            {i > 0 && <span className="mx-2 h-0.5 min-w-3.5 flex-1" style={{ background: on ? c.solid : "#D9D9D9" }} />}
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: on ? c.fg : "#828294" }}>
              <span className="box-border h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: on ? c.solid : "#BEBFC3", background: on ? c.solid : "#FFFFFF" }} />
              {c.label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

interface Props { alert: Instance; onAck: (n: number) => void; onDraft: (alert: Instance) => void }

/** One call-out in the trigger feed. */
export const TriggerCard = memo(function TriggerCard({ alert: r, onAck, onDraft }: Props) {
  const open = r.status === "open";
  return (
    <div className="flex flex-col gap-2 rounded-15 bg-white p-3.5 ring-card" style={{ opacity: open ? 1 : 0.6 }}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{r.agent}</span>
        <StatusPill tone={SEV[r.sev]} className="!px-2 !py-px">{SEV[r.sev].label}</StatusPill>
        <span className="num ml-auto text-xs text-muted">{clock(r.t)}</span>
      </div>
      <div className="text-pretty text-[13px] leading-normal text-strong">
        <b className="text-ink">{r.rule}</b> · {r.val}{r.strikes > 1 ? ` · strike ${r.strikes}` : ""}
        {r.inc && <> · <span className="font-ui font-semibold text-purple">{r.inc}</span></>}
      </div>
      {r.cmt && (
        <div className="rounded-8 bg-tint px-2.5 py-2 text-[13px] leading-[1.45] text-purple-900"><b>Agent:</b> “{r.cmt}”</div>
      )}
      <Ladder stage={r.stage} />
      {open ? (
        <div className="flex flex-wrap gap-2 pt-0.5">
          <PurpleButton compact onClick={() => onAck(r.n)}>Acknowledge</PurpleButton>
          {r.stage === "ops" && <PurpleButton compact variant="outline" onClick={() => onDraft(r)}>Open incident draft</PurpleButton>}
        </div>
      ) : (
        <span className="text-xs font-semibold text-success-text">Acknowledged · {r.ackT !== null ? `+${r.ackT - r.t}s` : ""}</span>
      )}
    </div>
  );
});
