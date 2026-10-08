export type AgentState = "oncall" | "avail" | "acw" | "auxb" | "auxp" | "outb" | "off";
export type Role = "admin" | "senior" | "mgr" | "tl" | "agent";
export type Stage = "nudge" | "lead" | "ops";
export type Route = "nudge" | "lead" | "nudgeonly" | "leadonly";
export type Severity = "warn" | "crit";
export type RuleType = "duration" | "event" | "ratio" | "queue" | "system";
export type RuleId =
  | "acw" | "auxp" | "ovbrk" | "offl" | "long" | "hold" | "outb"
  | "short" | "adh" | "xfer" | "cq" | "sl" | "aband" | "gnr";
export type TabId = "console" | "myview" | "dash" | "rules" | "ledger";
export type ToastKind = "warn" | "crit" | "esc" | "info";
/** Which adapter feeds a floor: the real Gencloud feed, the simulator, or a replayed export. */
export type FeedKind = "gencloud" | "sim" | "csv";
/** What the live floor can be switched between. */
export type FloorSource = Exclude<FeedKind, "csv">;

export interface Team { team: string; tl: string; mgr: string; lob: string }

export interface Agent {
  id: number; name: string; team: string; state: AgentState; stTime: number; aht: number;
  calls: number; shortCalls: number; transfers: number; onHold: boolean; holdTime: number; adh: number;
  strikes: Partial<Record<RuleId, number>>; fired: Partial<Record<RuleId, boolean>>;
}

export interface Rule {
  id: RuleId; name: string; type: RuleType; cond: string;
  thr: number; unit: string; sev: Severity; route: Route; on: boolean;
}

export interface Instance {
  n: number; t: number; agent: string; isFloor: boolean; team: string; rule: string; ruleId: RuleId;
  val: string; stage: Stage; sev: Severity | "esc"; status: "open" | "acked"; ackT: number | null;
  strikes: number; inc: string; cmt: string | null;
  /** Rule condition at fire time, e.g. "State ACW longer than 120s". */
  cond: string;
  /** Engine revision of the last change; the stream uses it to send deltas. */
  rev: number;
}

export interface Incident {
  inc: string; t: number; agent: string; team: string; rule: string; ruleId: RuleId;
  instances: number; status: "Open" | "Investigating" | "Closed"; disposition: string; closedT: number | null;
}

export interface View { role: Role; who: string | null }

/** Floor queue numbers. `sl` is null when the source has no service level yet (not 0%). */
export interface Queue { cq: number; sl: number | null; asa: number; ab: number }

export interface ReplayMeta { agents: number; events: number; endT: number; done: boolean }

export interface Perms {
  tabs: TabId[]; rulesEdit: boolean; invAct: boolean; export: boolean;
  ackAll: boolean; ir: boolean; replay: boolean;
  /** Switch the floor between the Gencloud feed and the simulator. */
  feed: boolean;
  desc: (who: string | null) => string;
}

export interface ToastEvent { kind: ToastKind; title: string; body: string; instance?: Instance }
export interface NudgeEvent { n: number; agent: string; team: string; first: string; body: string }
/** A desktop alert (system notification) for instance `n`. `nudge`: the nudge it stands for, which gives it the pop-up's buttons. */
export interface AlertNote { tag: string; n: number; title: string; body: string; url: string; nudge: NudgeEvent | null }

// ---------- feed ----------
export interface RosterAgent {
  name: string; team: string; state: AgentState; stTime?: number; aht?: number; calls?: number; adh?: number;
}
export interface Roster { org: Team[]; agents: RosterAgent[] }
export interface AgentStateEvent {
  agent: string;
  state: AgentState;
  /** Set when this transition released a call; drives calls, AHT and the short-call rule. */
  callEnded?: { transferred?: boolean };
  onHold?: boolean;
  /** Shift adherence from WFM, when the feed supplies it. */
  adh?: number;
}

// ---------- stream (server -> client) ----------
export interface PeopleDirectory { tls: string[]; mgrs: string[]; agentsByTeam: { team: string; agents: string[] }[] }

export interface TickMsg {
  type: "tick" | "init";
  t: number; mode: "live" | "replay"; staleFor: number; replay: ReplayMeta | null;
  queue: Queue | null; rules: Rule[]; agents: Agent[]; incidents: Incident[];
  /** The scoped team/org model. Sent on every snapshot (not just init) so clients that
   *  connected before the roster loaded still receive it — the Gencloud feed resolves the
   *  roster asynchronously, after clients have connected. */
  org: Team[];
  /** init: the whole scoped ledger (newest first). tick: only changed or new instances. */
  ledger: Instance[];
  /** `n` and `team` come from the instance behind a call-out toast; feed notices have neither. */
  toasts: (Omit<ToastEvent, "instance"> & { n?: number; team?: string })[];
  nudges: NudgeEvent[];
}
export interface InitMsg extends TickMsg {
  type: "init";
  view: View; people: PeopleDirectory | null;
  feed: FeedKind;
  /** Simulator only: the teams and agents carry real names from the Gencloud roster. */
  realNames: boolean;
  /** The viewer may switch the floor's data source (Admin only). */
  canSwitchFeed: boolean;
}
export type StreamMsg = TickMsg | InitMsg;
