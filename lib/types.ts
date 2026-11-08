import type { QueueMapRow } from "@/lib/import/queueMap";
import type { OrgId } from "@/lib/orgs";
export type AgentState = "oncall" | "avail" | "acw" | "auxb" | "auxp" | "outb" | "off";
export type Role = "admin" | "senior" | "mgr" | "tl" | "agent";
export type Stage = "nudge" | "lead" | "ops";
export type Route = "nudge" | "lead" | "nudgeonly" | "leadonly" | "critical";
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

/**
 * Someone in the reporting lines: an agent, or a leader above one. `supervisor` is their
 * supervisor's uid (Genesys first, then the CGS directory), null when neither has one.
 * An agent's supervisor is their Team Lead; the Team Lead's supervisor is their Manager.
 */
export interface OrgPerson { uid: string; name: string; supervisor: string | null }

export interface Agent {
  /** The engine's index for this roster, used in queue membership sent to screens. */
  id: number;
  /** The agent's key, which never changes: the Genesys user ID, or a made-up one for the simulator (sim:…) and imports (csv:…). Names are for display only. */
  uid: string;
  name: string; team: string; state: AgentState; stTime: number; aht: number;
  calls: number; shortCalls: number; transfers: number; onHold: boolean; holdTime: number; adh: number;
  /** AHT is the feed's handle time for the day (talk, hold and ACW), not estimated from calls seen. */
  ahtFromFeed?: boolean;
  strikes: Partial<Record<RuleId, number>>; fired: Partial<Record<RuleId, boolean>>;
}

export interface Rule {
  id: RuleId; name: string; type: RuleType; cond: string;
  thr: number; unit: string; sev: Severity; route: Route; on: boolean;
}

export interface Instance {
  n: number; t: number;
  /** The agent's name for display ("Queue" on a floor call-out); `agentId` says whose it is. */
  agent: string;
  /** The agent's uid; null on a floor call-out. */
  agentId: string | null;
  isFloor: boolean; team: string; rule: string; ruleId: RuleId;
  val: string; stage: Stage; sev: Severity | "esc"; status: "open" | "acked"; ackT: number | null;
  strikes: number; inc: string; cmt: string | null;
  /** Rule condition at fire time, e.g. "State ACW longer than 120s". */
  cond: string;
  /** Engine revision of the last change; the stream uses it to send deltas. */
  rev: number;
}

/** What a leader can do to an investigation: start it, send it back to Open, record a disposition, close it. */
export type InvAction = "start" | "reopen" | "record" | "close";

export interface Incident {
  inc: string; t: number;
  /** The agent's name for display; `agentId` says whose it is. */
  agent: string; agentId: string; team: string; rule: string; ruleId: RuleId;
  instances: number; status: "Open" | "Investigating" | "Closed"; disposition: string; closedT: number | null;
}

/** Who the console is viewed as. `who` is the person's uid (agent, Team Lead or Manager); null for Admin and Senior Leader. */
export interface View { role: Role; who: string | null }

/** Floor queue numbers. `sl` is null when the source has no service level yet (not 0%). */
export interface Queue { cq: number; sl: number | null; asa: number; ab: number }

/** One queue's raw call counts, kept so any group of queues can be rolled up by calls. */
export interface QueueCounts {
  waiting: number; offered: number; answered: number; abandoned: number;
  /** Total answer time, seconds. */
  answerSec: number;
  /** Calls answered within target, out of `slCounted`. */
  slWithin: number; slCounted: number;
}

export interface ReplayMeta { agents: number; events: number; endT: number; done: boolean }

/** What an admin gets back after uploading the queue-to-LOB mapping. */
export interface QueueMapResult {
  queues: number;
  towers: string[];
  unmappedWatched: string[];
  skipped: { row: number; reason: string }[];
  duplicates: { queue: string; kept: string; dropped: string }[];
}

export interface Perms {
  tabs: TabId[]; rulesEdit: boolean; invAct: boolean; export: boolean;
  ackAll: boolean; ir: boolean; replay: boolean;
  /** Switch the floor between the Gencloud feed and the simulator. */
  feed: boolean;
  /** Upload the WFM queue-to-LOB mapping. */
  mapping: boolean;
  desc: (who: string | null) => string;
}

export interface ToastEvent { kind: ToastKind; title: string; body: string; instance?: Instance }
/** `agentId` is the agent's uid; `agent` their name, for display. */
export interface NudgeEvent { n: number; agentId: string; agent: string; team: string; first: string; body: string }
/** A desktop alert (system notification) for instance `n`. `nudge`: the nudge it stands for, which gives it the pop-up's buttons. */
export interface AlertNote { tag: string; n: number; title: string; body: string; url: string; nudge: NudgeEvent | null }

// ---------- feed ----------
export interface RosterAgent {
  /** See Agent.uid. */
  uid: string;
  name: string; team: string; state: AgentState; stTime?: number; aht?: number; calls?: number; adh?: number;
}
export interface Roster {
  org: Team[]; agents: RosterAgent[];
  /** Queue name to the uids of everyone in it. An agent in two queues is listed under both; `team` is only the first. */
  members?: Record<string, string[]>;
  /** The reporting lines: the agents and the leaders above them. Left out when the feed has none yet. */
  people?: OrgPerson[];
}
/** An agent's figures for the day from the feed's own reporting. */
export interface AgentStats {
  /** The agent's uid. */
  uid: string;
  /** Average handle time, seconds: talk, hold and after-call work. */
  aht: number;
}

export interface AgentStateEvent {
  /** The agent's uid. */
  uid: string;
  state: AgentState;
  /**
   * Set when this transition released a call; drives calls, AHT and the short-call rule.
   * `durationSec` is the call's length when the feed knows it; otherwise the time in On Call.
   */
  callEnded?: { transferred?: boolean; durationSec?: number };
  onHold?: boolean;
  /** Seconds the current hold has already run, when the feed knows (hold began before this event). */
  holdElapsed?: number;
  /** Shift adherence from WFM, when the feed supplies it. */
  adh?: number;
  /**
   * Seconds the agent has already been in `state`, when the feed knows (the Genesys snapshot
   * at connect). Without it the state timer starts at 0.
   */
  elapsed?: number;
  /**
   * A state read at connect, not a change seen live: rules the agent is already past are
   * marked as fired without raising call-outs, so a restart does not flood the floor.
   */
  seed?: boolean;
}

// ---------- stream (server -> client) ----------
/** Someone to view the console as: `key` goes in View.who, `name` is shown. */
export interface Person { key: string; name: string }
export interface PeopleDirectory { tls: Person[]; mgrs: Person[]; agentsByTeam: { team: string; agents: Person[] }[] }

/** An agent's Team Lead and Manager by name; null where Genesys and the CGS directory have none. */
export interface AgentLeads { tl: string | null; mgr: string | null }

/** An agent on the floor with no supervisor in Genesys or the CGS directory, for admins to have fixed. */
export interface Unsupervised { uid: string; name: string; team: string }

export interface TickMsg {
  type: "tick" | "init";
  t: number; mode: "live" | "replay"; staleFor: number; replay: ReplayMeta | null;
  /** The agents are the last saved roster, or their states have not all arrived: an Offline agent may not be. */
  agentsLoading: boolean;
  queue: Queue | null; rules: Rule[]; agents: Agent[]; incidents: Incident[];
  /** The scoped team/org model. Sent on every snapshot (not just init) so clients that
   *  connected before the roster loaded still receive it — the Gencloud feed resolves the
   *  roster asynchronously, after clients have connected. */
  org: Team[];
  /** init: the whole scoped ledger (newest first). tick: only changed or new instances. */
  ledger: Instance[];
  /** Every queue's call counts, same for every viewer: queue numbers are floor-visible to all leaders. */
  queues: Record<string, QueueCounts>;
  /** Queue name to the ids of the viewer's agents in it. Sent on a snapshot and whenever the roster reloads; otherwise left out. */
  members?: Record<string, number[]>;
  /** Each of the viewer's agents' Team Lead and Manager, by uid. Sent with `members`. */
  leads?: Record<string, AgentLeads>;
  /** Admin only: how many agents on the floor have no supervisor. Sent with `members`. */
  unsupervised?: number;
  /** The name of the person the console is viewed as; null for Admin and Senior Leader, or while it is not known yet. */
  viewerName: string | null;
  /** The uploaded queue-to-LOB mapping. Sent on a snapshot and whenever it changes; otherwise left out. */
  queueMap?: QueueMapRow[];
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
  /** The Genesys org on screen; null on the simulator and in a replay. */
  genesysOrg: OrgId | null;
  /** The viewer may switch the floor's data source (Admin only). */
  canSwitchFeed: boolean;
}
export type StreamMsg = TickMsg | InitMsg;
