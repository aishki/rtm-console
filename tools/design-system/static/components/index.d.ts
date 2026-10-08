// RTM Console components, as exported on window.RTM. Types copied from the component sources.
import type { ButtonHTMLAttributes, CSSProperties, Key, ReactNode, RefObject } from "react";

// ---------- shared data shapes ----------
export type AgentState = "oncall" | "avail" | "acw" | "auxb" | "auxp" | "outb" | "off";
export type Stage = "nudge" | "lead" | "ops";
export type Severity = "warn" | "crit";
export type Route = "nudge" | "lead" | "nudgeonly" | "leadonly";
export type ToastKind = "warn" | "crit" | "esc" | "info";
export type TabId = "console" | "myview" | "dash" | "rules" | "ledger";
export type Level = "ok" | "warn" | "crit" | "esc";
export interface Tone { bg: string; fg: string }
export interface Team { team: string; tl: string; mgr: string; lob: string }
export interface Agent {
  id: number; name: string; team: string; state: AgentState; stTime: number; aht: number;
  calls: number; shortCalls: number; transfers: number; onHold: boolean; holdTime: number; adh: number;
  strikes: Record<string, number>; fired: Record<string, boolean>;
}
export interface Rule { id: string; name: string; type: "duration" | "event" | "ratio" | "queue" | "system"; cond: string; thr: number; unit: string; sev: Severity; route: Route; on: boolean }
export interface Instance {
  n: number; t: number; agent: string; isFloor: boolean; team: string; rule: string; ruleId: string;
  val: string; stage: Stage; sev: Severity | "esc"; status: "open" | "acked"; ackT: number | null;
  strikes: number; inc: string; cmt: string | null; cond: string; rev: number;
}
export interface Incident { inc: string; t: number; agent: string; team: string; rule: string; ruleId: string; instances: number; status: "Open" | "Investigating" | "Closed"; disposition: string; closedT: number | null }
export interface ToastItem { id: number; kind: ToastKind; title: string; body: string }

// ---------- actions ----------
export interface PurpleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "solid" | "outline";
  /** 32px tall, for dense rows (trigger cards, tables, the nudge). Default is 38px. */
  compact?: boolean;
}
export function PurpleButton(props: PurpleButtonProps): JSX.Element;
export type TertiaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
export function TertiaryButton(props: TertiaryButtonProps): JSX.Element;

// ---------- forms ----------
export interface SelectOption<T extends string = string> { value: T; label: string }
export interface SelectGroup<T extends string = string> { label: string; items: SelectOption<T>[] }
export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: (SelectOption<T> | SelectGroup<T>)[];
  "aria-label"?: string;
  disabled?: boolean;
  /** Size and skin of the trigger, e.g. "field h-10 px-3". */
  className?: string;
  style?: CSSProperties;
  /** For pill triggers: the menu floats 4px away with every corner rounded instead of joining the trigger. */
  detached?: boolean;
}
export function Select<T extends string>(props: SelectProps<T>): JSX.Element;

export interface MultiOption<T extends string = string> { value: T; label: string; /** Dot shown before the label. */ color?: string }
export interface MultiSelectProps<T extends string = string> {
  /** Checked values. Empty means no filter. */
  value: T[];
  onChange: (value: T[]) => void;
  options: MultiOption<T>[];
  /** Trigger text and first row when nothing is checked, e.g. "Any state". */
  anyLabel: string;
  /** Trigger text for several checked values, e.g. n => `${n} states`. */
  countLabel: (n: number) => string;
  "aria-label"?: string;
  /** Size and skin of the trigger, e.g. "field h-10 px-3". */
  className?: string;
}
export function MultiSelect<T extends string>(props: MultiSelectProps<T>): JSX.Element;

export interface FilterChipProps { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; /** 18px box with a 13px label, for rows short on width. */ compact?: boolean }
export function FilterChip(props: FilterChipProps): JSX.Element;

export interface ToggleProps { checked: boolean; onChange: (next: boolean) => void; /** Accessible name; not drawn. */ label: string; disabled?: boolean }
export function Toggle(props: ToggleProps): JSX.Element;

export interface PersonGroup { label: string; items: string[] }
export interface PersonSearchProps {
  value: string;
  groups: PersonGroup[];
  onChange: (who: string) => void;
  /** Each person's current state, shown at the right end of their row and of the box. Omit for people without one. */
  states?: Record<string, AgentState> | null;
  /** Lets the caller load `states` only while the list is on screen. */
  onOpenChange?: (open: boolean) => void;
  "aria-label"?: string;
}
export function PersonSearch(props: PersonSearchProps): JSX.Element;

// ---------- status ----------
export interface StatusPillProps { tone: Tone; children: ReactNode; className?: string }
export function StatusPill(props: StatusPillProps): JSX.Element;

export interface Kpi { label: string; value: ReactNode; sub: string; level: Level; muted?: boolean }
export interface KpiTileProps { kpi: Kpi }
export function KpiTile(props: KpiTileProps): JSX.Element;

export interface LadderProps { /** The stage the call-out reached. */ stage: Stage }
export function Ladder(props: LadderProps): JSX.Element;

export interface ToastProps { toast: ToastItem }
export function Toast(props: ToastProps): JSX.Element;
/** The fixed stack that draws the store's toasts. Takes no props. */
export function ToastStack(): JSX.Element;

// ---------- layout and data ----------
export interface PageTitleProps { eyebrow: string; title: string }
export function PageTitle(props: PageTitleProps): JSX.Element;

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Extra classes for the header cell (e.g. a stage text color or a min width). */
  thClass?: string;
  /** Extra classes for body cells. */
  tdClass?: string;
}
export interface DataTableProps<T = unknown> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => Key;
  rowStyle?: (row: T) => CSSProperties | undefined;
  /** Keep the header visible while the surrounding container scrolls. */
  stickyHeader?: boolean;
  /** Vertical cell padding in px. Default 10. */
  padY?: number;
  /** Horizontal padding of inner cells in px. The first and last columns use 20px. Default 14. */
  padX?: number;
  /** Default 10. */
  headPadY?: number;
  /** Shown under the header when there are no rows. */
  empty?: ReactNode;
}
export function DataTable<T>(props: DataTableProps<T>): JSX.Element;

export interface RuleRowProps { rule: Rule; canEdit: boolean; onPatch: (rule: Rule, patch: Partial<Pick<Rule, "thr" | "sev" | "route" | "on">>) => void }
export function RuleRow(props: RuleRowProps): JSX.Element;

// ---------- console ----------
export interface AgentCardProps { agent: Agent; rules: Rule[]; /** Lower-cased search text to highlight in the name. */ query: string; showMetrics: boolean }
export function AgentCard(props: AgentCardProps): JSX.Element;

export interface TeamGroupProps {
  team: Team;
  /** Every agent on the team in span (drives the mix and breach count). */
  all: Agent[];
  /** The agents to show after filtering and sorting. */
  shown: Agent[];
  rules: Rule[];
  open: boolean;
  filtering: boolean;
  query: string;
  showMetrics: boolean;
  onToggle: () => void;
}
export function TeamGroup(props: TeamGroupProps): JSX.Element;

export type SortBy = "state" | "team" | "time" | "strikes" | "name";
export type QuickKey = "breach" | "strikes" | "hold";
/** `states` holds the ticked states; empty means any state. */
export interface GridFilters { q: string; team: string; states: AgentState[]; quick: Partial<Record<QuickKey, boolean>>; sortBy: SortBy }
export const NO_FILTERS: GridFilters;
export interface AgentGridToolbarProps {
  filters: GridFilters;
  onChange: (patch: Partial<GridFilters>) => void;
  onClear: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Team options grouped by "{Manager} · {LOB}". */
  teamGroups: { label: string; items: { value: string; label: string }[] }[];
  teamCount: number;
  quickCounts: Record<QuickKey, number>;
  filtering: boolean;
  resultText: string;
  showExpandControls: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}
export function AgentGridToolbar(props: AgentGridToolbarProps): JSX.Element;

export interface TriggerCardProps { alert: Instance; onAck: (n: number) => void; onDraft: (alert: Instance) => void }
export function TriggerCard(props: TriggerCardProps): JSX.Element;

export interface IncidentTilesProps { incidents: Incident[]; agents: Agent[]; org: Team[] }
export function IncidentTiles(props: IncidentTilesProps): JSX.Element;

// ---------- chrome ----------
export interface NavbarProps { /** The tab to underline; undefined when the current page is not allowed for the role. */ current: TabId | undefined }
export function Navbar(props: NavbarProps): JSX.Element;
/** Reads everything from the console store. Takes no props. */
export function ContextBar(): JSX.Element;
/** Reads the current nudge from the console store. Takes no props. */
export function NudgePopup(): JSX.Element | null;
export interface CsvImportDialogProps { onClose: () => void; onStarted: () => void }
export function CsvImportDialog(props: CsvImportDialogProps): JSX.Element;
export interface LockScreenProps { /** Where to go after a correct password. */ next: string }
export function LockScreen(props: LockScreenProps): JSX.Element;
export interface ConsoleShellProps { children: ReactNode }
export function ConsoleShell(props: ConsoleShellProps): JSX.Element;

// ---------- brand ----------
export interface CarelonLogoProps { /** Height of the wordmark in px. Default 22. */ height?: number }
export function CarelonLogo(props: CarelonLogoProps): JSX.Element;
export interface CarelonMarkProps { /** Default 32. */ size?: number; alt?: string }
export function CarelonMark(props: CarelonMarkProps): JSX.Element;
export interface BitsLogoProps { /** Default 28. */ height?: number }
export function BitsLogo(props: BitsLogoProps): JSX.Element;
/** Clear space the wordmark needs on every side: the size of its own icon. */
export function carelonClearSpace(height: number): number;

export interface IconProps { size?: number }
export function SearchIcon(props: IconProps): JSX.Element;
export function CloseIcon(props: IconProps): JSX.Element;
export function FilterClearIcon(props: IconProps & { active?: boolean }): JSX.Element;

// ---------- palette maps (status colours picked at runtime) ----------
export const SEV: Record<Severity | "esc", Tone & { label: string }>;
export const STAGE: Record<Stage, Tone & { label: string; solid: string }>;
export const LVL: Record<Level, { fg: string; dot: string }>;
export const TGT: Record<"ok" | "watch" | "breach" | "off", Tone>;
export const INC: Record<Incident["status"], Tone>;
export const TOAST: Record<ToastKind, { dot: string; fg: string }>;
export const STATES: Record<AgentState, { label: string; color: string }>;
