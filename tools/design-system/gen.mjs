// Writes tokens.json, the component READMEs and previews, and the index, from this checkout.
// Usage: node tools/design-system/gen.mjs [repo] [outDir]
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] ?? path.join(here, "../.."));
const out = path.resolve(process.argv[3] ?? path.join(repo, ".design-system/out/project"));
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const sha = git("rev-parse", "--short", "HEAD"), branch = git("rev-parse", "--abbrev-ref", "HEAD");
// Local-only files for check.mjs; never published.
const work = path.join(out, "../../check");
mkdirSync(work, { recursive: true });
// The hand-written files: brand book, cover, types, logo notes.
cpSync(path.join(here, "static"), out, { recursive: true });
const put = (rel, text) => { const f = path.join(out, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };

// ---------------------------------------------------------------- tokens
const css = readFileSync(path.join(repo, "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
const rootStart = css.indexOf(":root {");
const root = css.slice(rootStart, css.indexOf("\n}\n", rootStart));
const vars = [...root.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map(m => [m[1], m[2].trim()]);
const raw = Object.fromEntries(vars);
const lower = v => v.replace(/#[0-9a-fA-F]{3,8}\b/g, h => h.toLowerCase());
const literal = v => lower(v.replace(/var\(--([\w-]+)\)/g, (_, n) => literal(raw[n])));

const USAGE = {
  purple: "Brand purple: headings, primary buttons, links, the active tab and selected values. On white, light-gray, pale-purple and primary-300 (7.7:1 or better).",
  white: "Card, panel, navbar and dialog surface. Text on purple, dark-purple and error.",
  "light-purple": "Aux Break state dot and the aux segment of the team mix bar. A mark, not a text colour.",
  cyan: "Outbound state dot. 2.2:1 on white, so it always sits beside its label.",
  turquoise: "On Call state dot, Nudge stage pip and connector, live-feed dot. 2.4:1 on white, so it always sits beside its label.",
  "dark-purple": "Backing of the \"Your screen · live nudge\" label, under white text.",
  "pale-purple": "Card ring, hovered option row, strike badge, and the Escalated and replay pill background under purple text.",
  "pale-cyan": "Palette colour from the BITS colors file. No console component uses it yet.",
  "pale-turquoise": "Nudge stage and live-feed pill background. turquoise-text on it is 4.05:1, under the 4.5:1 its 13px label needs; kept as the source has it.",
  "light-gray": "Page background, neutral pill background, closed incident tile.",
  "dark-gray": "Body text on white, light-gray and the tints (16:1 on white).",
  "cyan-text": "Focus ring colour. 4.5:1 on white, 4.2:1 on light-gray.",
  "turquoise-text": "Text on pale-turquoise pills and the import summary line on white (4.6:1 on white).",
  "purple-900": "Pressed primary button, table header text on purple-050, text of a highlighted search match.",
  "purple-700": "Same value as purple; the scale name from the BITS colors file.",
  "purple-600": "Fill of a ticked checkbox, filter chip and switch, under a white check or knob (6.7:1).",
  "purple-500": "Same value as light-purple; the scale name from the BITS colors file.",
  "primary-300": "Avatar chip background, table header underline, pressed outline button, search-match highlight.",
  "primary-500": "Dashed drop-zone border and the thin scrollbar thumb in menus.",
  "primary-600": "Scale step from the BITS colors file. No console component uses it yet.",
  "purple-050": "Tinted surface: table header band, open team header, agent comment, hovered outline button.",
  "purple-025": "Scale step from the BITS colors file. No console component uses it yet.",
  "neutral-50": "Same value as white; the scale name from the BITS colors file.",
  "neutral-100": "Same value as light-gray; the scale name from the BITS colors file.",
  "neutral-150": "Row dividers and the empty track of the team mix bar.",
  "neutral-300": "Unreached ladder connector and the ring of a closed incident tile.",
  "neutral-350": "Field and select border. 1.5:1 on white, under the 3:1 a control border needs; kept as the source has it.",
  "neutral-400": "Unreached ladder pip border and the dot of a muted KPI tile.",
  "neutral-500": "Offline state dot and the connecting-feed dot. 3.1:1 on white.",
  "neutral-700": "Subtle text and unreached ladder labels on white. 3.8:1, under the 4.5:1 that 12px text needs; kept as the source has it.",
  "neutral-800": "Muted text: sub-lines, captions, labels. 6.5:1 on white, 6.0:1 on light-gray, 5.9:1 on purple-050.",
  "neutral-900": "Strong body text on white: dialog copy, tab labels, rule conditions.",
  "neutral-1000": "Scale step from the BITS colors file. No console component uses it yet.",
  success: "Available state dot, OK KPI dot, info toast dot. 3.4:1 on white; text uses success-text. Success and error differ mostly by hue (1.6:1 between them), so each always carries a word.",
  info: "Palette colour from the BITS colors file. No console component uses it yet.",
  warning: "ACW state dot, Leader stage pip, warning toast and KPI dot, and the 2px ring of a breaching agent card. 1.7:1 on white and on warning-fill, so the card also changes its fill and shows the timer in warning-text.",
  error: "Critical KPI and toast dot, the ledger badge under white text (5.5:1), the 2px ring of a critical agent card and an open incident tile, lock-screen error text on white.",
  "text-heading": "Headings and titles on white and light-gray.",
  "text-body": "Default text on white, light-gray and the tints.",
  "text-strong": "Longer explanatory copy on white.",
  "text-muted": "Sub-lines, captions and field labels on white, light-gray and purple-050.",
  "text-subtle": "Quietest text on white. 3.8:1: use for 24px+ or non-essential text only.",
  "text-inverse": "Text on purple, dark-purple and error fills.",
  "surface-page": "The page behind every card and panel.",
  "surface-card": "Cards, panels, the navbar, dialogs, toasts and menus.",
  "surface-tint": "Tinted bands inside a card: table header, open team header, comment box.",
  "surface-tint-strong": "Stronger tint: avatar chip, pressed outline button.",
  "border-card": "The 1px inset ring of cards and panels, and the panel head divider. Decorative: 1.2:1 on white.",
  "border-hairline": "Bottom line of the navbar and context bar, and the divider beside the logo.",
  "border-neutral": "Field, select and search box border while idle.",
  "border-row": "Divider between table rows and above the agent card metrics.",
  "action-primary": "Primary button fill, outline button ring and text.",
  "action-primary-hover": "Hovered primary button and hovered link (12.8:1 on white).",
  "action-primary-active": "Pressed primary button.",
  "action-on-primary": "Label on a primary button.",
  "control-selected": "Ticked checkbox, filter chip and switch fill.",
  "control-unselected": "Empty checkbox, filter chip and switch-off fill, on white.",
  "focus-ring": "2px keyboard-focus outline, offset 2px, on every control.",
  "success-text": "Acknowledged line on white (6.2:1) and On target pill text on success-tint (5.4:1).",
  "success-tint": "Background of On target and Closed pills.",
  "warning-text": "Warning pill, hold badge and breaching timer text. 6.2:1 on warning-tint, 6.6:1 on warning-fill.",
  "warning-tint": "Background of Warning, Leader and Investigating pills, the hold badge and the stale-feed pill.",
  "warning-fill": "Background of a breaching agent card.",
  "error-text": "Critical pill and timer text, required marks, error messages. 5.9:1 on error-tint, 6.7:1 on error-fill.",
  "error-tint": "Background of Critical, Open and breaching pills.",
  "error-fill": "Background of a critical agent card and an open incident tile.",
  "ring-card": "Outline of every card and panel, in place of a border or a shadow.",
  "ring-button": "Outline of the pill button, solid and outline variants.",
  "shadow-toast": "Toasts. Open menus use the same 0 12px 32px drop.",
  "shadow-nudge": "The agent's nudge pop-up, the highest layer.",
  "navbar-height": "Height of the sticky navbar from 640px up (64px below).",
  "radius-4": "Team mix bar.",
  "radius-8": "Fields, selects, menus, the agent comment box.",
  "radius-15": "Agent cards, trigger cards, toasts, team groups, the drop zone.",
  "radius-16": "KPI tiles and the lock-screen card.",
  "radius-20": "Panels, dialogs, the nudge, pill buttons and the search box.",
  "radius-30": "Avatar chip.",
  "radius-41": "Label of a full-size filter chip.",
  "radius-pill": "Status pills, badges, the feed pill and the switch.",
  "breakpoint-w560": "The viewer's name and role appear beside the avatar.",
  "breakpoint-w720": "The Carelon wordmark replaces the icon mark in the navbar.",
  "breakpoint-w900": "The product sub-line \"Real-Time Monitoring & Escalation\" appears.",
};
const note = n => { if (!USAGE[n]) throw new Error("no usage note for " + n); return USAGE[n]; };

const SHADOWS = ["ring-card", "ring-button", "shadow-toast", "shadow-nudge"];
const SKIP = ["bits-font-brand", "bits-font-ui", "bits-ease", "duration-fast", "duration-base", "navbar-height"];
const colors = vars.filter(([n]) => !SHADOWS.includes(n) && !SKIP.includes(n)).map(([name, v]) => {
  const alias = /^var\(--([\w-]+)\)$/.exec(v);
  return { name, value: alias ? `{${alias[1]}}` : lower(v), usage: note(name) };
});
const theme = css.slice(css.indexOf("@theme inline {"));
const grab = prefix => [...theme.matchAll(new RegExp(`^\\s*--(${prefix}[\\w-]+):\\s*([^;]+);`, "gm"))].map(m => ({ name: m[1], value: m[2].trim(), usage: note(m[1]) }));
const stack = v => v.replace("var(--font-inter), ", "");

const tokens = {
  name: "RTM Console", version: 1,
  color: { themes: [{ id: "light", name: "Light" }], tokens: colors },
  type: {
    fonts: [],
    families: { brand: stack(raw["bits-font-brand"]), ui: stack(raw["bits-font-ui"]) },
    groups: [
      { name: "Reading", family: "brand", styles: [
        { name: "heading-page", fontSize: "36px", lineHeight: 1.15, fontWeight: 500, letterSpacing: "-0.02em", sample: "Shift dashboards", usage: "Screen title, in text-heading, under an eyebrow." },
        { name: "heading-dialog", fontSize: "24px", fontWeight: 500, letterSpacing: "-0.02em", sample: "Import floor data", usage: "Dialog and lock-screen title, in text-heading." },
        { name: "heading-panel", fontSize: "20px", fontWeight: 500, letterSpacing: "-0.01em", sample: "Agents with incident reports", usage: "Panel title, in text-heading." },
        { name: "heading-product", fontSize: "18px", fontWeight: 600, letterSpacing: "-0.01em", sample: "RTM Console", usage: "Product name in the navbar." },
        { name: "copy-lead", fontSize: "16px", fontWeight: 500, sample: "Review", usage: "Page eyebrow in text-muted; team name and nudge greeting at weight 600." },
        { name: "copy-body", fontSize: "14px", fontWeight: 400, sample: "Enter the console password to continue.", usage: "Default text: table cells, dialog copy, field values. Names and labels use weight 600." },
        { name: "copy-small", fontSize: "13px", fontWeight: 400, sample: "Your span · why each incident was opened", usage: "Sub-lines, toast bodies, state labels, result counts." },
        { name: "copy-caption", fontSize: "12px", fontWeight: 400, sample: "TL Sample, Tessa · 6 agents", usage: "Captions and footer notes in text-muted; pills at weight 600." },
      ] },
      { name: "Data", family: "ui", styles: [
        { name: "data-kpi", fontSize: "30px", lineHeight: 1.1, fontWeight: 600, letterSpacing: "-0.02em", sample: "42s", usage: "The big number on a KPI tile, tabular figures." },
        { name: "data-clock", fontSize: "16px", fontWeight: 600, sample: "10:08:20", usage: "Shift clock, tabular figures." },
        { name: "data-timer", fontSize: "13px", fontWeight: 600, sample: "3:11", usage: "Time in state on an agent card, tabular figures." },
        { name: "data-header", fontSize: "12px", fontWeight: 600, sample: "Threshold", usage: "Table header cells in purple-900 on purple-050; badges and counts." },
        { name: "data-id", fontSize: "11px", fontWeight: 400, sample: "AH10003", usage: "Domain IDs and agent card metrics in text-muted." },
        { name: "data-group", fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", sample: "TEAM LEADS", usage: "Uppercase group heading inside a menu, in text-muted." },
      ] },
    ],
  },
  spacing: { note: "The components use Tailwind's 4px spacing scale; these are the steps the layout rules name. navbar-height comes from the BITS spacing file.", tokens: [
    { name: "space-2", value: "8px", usage: "Gap inside a card or button row; gap between tiles." },
    { name: "space-3", value: "12px", usage: "Gap between cards in a grid; toolbar control gap." },
    { name: "space-4", value: "16px", usage: "Card and toast padding; page gutter on phones." },
    { name: "space-5", value: "20px", usage: "Panel padding and the outer padding of table rows." },
    { name: "space-6", value: "24px", usage: "Gap between page sections; offset of the nudge and toasts from the screen edge." },
    { name: "space-8", value: "32px", usage: "Page gutter from 640px up." },
    { name: "navbar-height", value: raw["navbar-height"], usage: note("navbar-height") },
  ] },
  radius: { tokens: grab("radius-") },
  shadow: { tokens: SHADOWS.map(name => ({ name, value: literal(raw[name]), usage: note(name) })) },
  breakpoint: { note: "Navbar breakpoints. 640px and 1280px are Tailwind's own sm and xl.", tokens: grab("breakpoint-") },
  meta: {
    source: "github", repo: "aishki/rtm-console", ref: `${branch}@${sha}`, package: ".",
    paths: { tokens: ["app/globals.css", "lib/ui/palette.ts"], fonts: [], assets: ["public/assets/logos"], docs: ["README.md"] },
    components: {}, synced: new Date().toISOString().slice(0, 10),
  },
};

// ---------------------------------------------------------------- components
const PRE = "var R = window.RTM, h = React.createElement, S = React.useState;\nfunction mount(el) { ReactDOM.createRoot(document.getElementById('root')).render(el); }\nfunction row(kids, gap) { return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: gap || 12, alignItems: 'center' } }, kids); }\nfunction grid(min, kids) { return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(' + min + 'px, 1fr))', gap: 12 } }, kids); }\n";
const FIELD = "'field h-10 max-w-full px-3'";
const C = [];
const card = (name, group, height, src, pad, doc, script) => C.push({ name, group, height, src, pad, doc: doc.trim(), script: script.trim() });

card("PurpleButton", "Actions", 88, "components/ui/buttons.tsx", 20, `
The pill button in brand purple, solid or outline. Use solid for the one action a card, dialog or row is for ("Acknowledge", "Start replay", "Unlock") and outline for everything beside it ("Cancel", "Send reason", "Exit replay").

- You provide the label as children, starting with a verb, plus any native button attribute (\`onClick\`, \`disabled\`, \`type\`).
- \`compact\` makes it 32px tall for dense rows: trigger cards, tables, the nudge. The default is 38px.
- Disabled buttons drop to 40% opacity; do not hide them.
- At most one solid button per group.
`, `
mount(row([
  h(R.PurpleButton, { key: 1 }, 'Start replay'),
  h(R.PurpleButton, { key: 2, variant: 'outline' }, 'Cancel'),
  h(R.PurpleButton, { key: 3, compact: true }, 'Acknowledge'),
  h(R.PurpleButton, { key: 4, compact: true, variant: 'outline' }, 'Send reason'),
  h(R.PurpleButton, { key: 5, disabled: true }, 'Start replay')
]));`);

card("TertiaryButton", "Actions", 72, "components/ui/buttons.tsx", 20, `
A text button in purple with a trailing arrow, for a secondary route out of a dialog or panel, such as "Download sample CSV".

- You provide the label as children and any native button attribute. The arrow is added for you.
- Use it for the least important action in a group, placed away from the pill buttons. Do not use it inside running text; that is a link.
`, `
mount(row([h(R.TertiaryButton, { key: 1 }, 'Download sample CSV')]));`);

card("Select", "Forms", 300, "components/ui/Select.tsx", 20, `
The single-choice dropdown: a trigger sized to its widest option, and a list that opens joined to it. Use it wherever one value is picked from a known list: sort order, team, role, severity, escalation route.

- You provide \`value\`, \`onChange\`, and \`options\` (plain options, or groups of them with a label), plus an \`aria-label\` when no visible label wraps it.
- The trigger has no skin of its own. Pass it through \`className\`: \`field h-10 px-3\` for a standard field, or a pill skin with \`detached\` so the menu floats 4px away with every corner rounded.
- The list is portalled to the body, so a scrolling table or dialog never clips it. It opens upward when there is no room below.
- Keyboard: arrows move, Enter or Space picks, typing jumps to a label, Escape closes the list only.
`, `
function Demo() {
  var a = S('state'), b = S(''), c = S('warn');
  var sev = R.SEV[c[0]];
  return row([
    h(R.Select, { key: 1, value: a[0], onChange: a[1], 'aria-label': 'Sort agents', className: ${FIELD}, options: [
      { value: 'state', label: 'Sort: status, On Call first' }, { value: 'team', label: 'Sort: roster order' }, { value: 'time', label: 'Sort: longest in state' },
      { value: 'strikes', label: 'Sort: most strikes' }, { value: 'name', label: 'Sort: name A\\u2013Z' }] }),
    h(R.Select, { key: 2, value: b[0], onChange: b[1], 'aria-label': 'Filter by team', className: ${FIELD}, options: [
      { value: '', label: 'All teams (2)' },
      { label: 'Sample, Morgan \\u00b7 Member Services', items: [{ value: 'Member Services A', label: 'Member Services A' }] },
      { label: 'Sample, Morgan \\u00b7 Provider Support', items: [{ value: 'Provider Support B', label: 'Provider Support B' }] }] }),
    h(R.Select, { key: 3, value: c[0], onChange: c[1], detached: true, 'aria-label': 'Severity', className: 'h-[34px] rounded-pill border px-3 text-[13px] font-semibold',
      style: { borderColor: sev.fg, background: sev.bg, color: sev.fg }, options: [{ value: 'warn', label: 'Warning' }, { value: 'crit', label: 'Critical' }] })
  ]);
}
mount(h(Demo));`);

card("MultiSelect", "Forms", 360, "components/ui/MultiSelect.tsx", 20, `
The dropdown for ticking several values. The list stays open while rows are ticked, and its first row clears them all. Use it for a filter where any combination is valid, such as agent states.

- You provide \`value\` (the ticked values; empty means no filter), \`onChange\`, \`options\` (each may carry a \`color\` for a dot), \`anyLabel\` for the empty state ("Any state") and \`countLabel\` for several ("3 states").
- Pass the trigger skin through \`className\`, as with Select.
- The trigger keeps one width whatever is ticked, and turns its border purple while a filter is on.
- Keyboard: arrows move, Space or Enter ticks, Escape or a click outside closes.
`, `
function Demo() {
  var v = S(['oncall', 'acw']);
  var options = Object.keys(R.STATES).map(function (id) { return { value: id, label: R.STATES[id].label, color: R.STATES[id].color }; });
  return h(R.MultiSelect, { value: v[0], onChange: v[1], options: options, anyLabel: 'Any state', countLabel: function (n) { return n + ' states'; }, 'aria-label': 'Filter by state', className: ${FIELD} });
}
mount(h(Demo));`);

card("FilterChip", "Forms", 110, "components/ui/FilterChip.tsx", 20, `
A checkbox drawn as a rounded purple box with its label, for quick filters that switch on and off independently: "Breaching now", "Has strikes", "On hold".

- You provide a unique \`id\`, the \`label\` (put the live count in it: "Breaching now (2)"), \`checked\` and \`onChange\`.
- \`compact\` is an 18px box with a 13px label, for a row that must stay on one line. The default is a 24 by 25px box with a 15px label.
- Use Toggle, not a chip, for a setting that takes effect on a record.
`, `
function Demo() {
  var a = S(true), b = S(false), c = S(true), d = S(false);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    row([h(R.FilterChip, { key: 1, id: 'c1', label: 'Breaching now (2)', checked: a[0], onChange: a[1] }), h(R.FilterChip, { key: 2, id: 'c2', label: 'Has strikes (3)', checked: b[0], onChange: b[1] })], 16),
    row([h(R.FilterChip, { key: 3, id: 'c3', label: 'Breaching now (2)', checked: c[0], onChange: c[1], compact: true }), h(R.FilterChip, { key: 4, id: 'c4', label: 'On hold (1)', checked: d[0], onChange: d[1], compact: true })], 16));
}
mount(h(Demo));`);

card("Toggle", "Forms", 72, "components/ui/primitives.tsx", 20, `
A 44 by 24px switch for turning one thing on or off with immediate effect, such as enabling a rule.

- You provide \`checked\`, \`onChange\` and a \`label\`. The label is the accessible name and is not drawn, so name what the switch controls: "Enable Extended ACW".
- \`disabled\` halves its opacity; use it when the viewer may see the setting but not change it.
`, `
function Demo() {
  var a = S(true), b = S(false);
  return row([
    h(R.Toggle, { key: 1, checked: a[0], onChange: a[1], label: 'Enable Extended ACW' }),
    h(R.Toggle, { key: 2, checked: b[0], onChange: b[1], label: 'Enable Overbreak' }),
    h(R.Toggle, { key: 3, checked: true, onChange: function () {}, label: 'Enable Long call', disabled: true })
  ], 16);
}
mount(h(Demo));`);

card("PersonSearch", "Forms", 400, "components/chrome/PersonSearch.tsx", 20, `
A search box for picking one person from a long list: type part of a name or a domain ID to narrow it, then pick with the mouse or the arrow keys and Enter. It is the person box beside "View as".

- You provide \`value\` (the current person, written "Last, First - ID"), \`groups\` (labelled lists of names) and \`onChange\`.
- Pass \`states\` to show each person's current state at the right end of their row and of the box; \`onOpenChange\` lets you load them only while the list is open.
- At most 80 matches are drawn; the list says how many more there are. Escape or clicking away keeps the current person.
`, `
function Demo() {
  var v = S('Example, Carlo - AH10003');
  var groups = [R.demo.org[0], R.demo.org[1]].map(function (t) { return { label: t.team, items: R.demo.agents.filter(function (a) { return a.team === t.team; }).map(function (a) { return a.name; }) }; });
  var states = {}; R.demo.agents.forEach(function (a) { states[a.name] = a.state; });
  return h(R.PersonSearch, { value: v[0], onChange: v[1], groups: groups, states: states, 'aria-label': 'Person' });
}
mount(h(Demo));`);

card("StatusPill", "Status", 72, "components/ui/primitives.tsx", 20, `
A small rounded label for a severity or status: Warning, Critical, Escalated, Open, Investigating, Closed.

- You provide a \`tone\` (a background and a text colour) and the word as children. Take tones from the palette maps on the bundle (\`SEV\`, \`STAGE\`, \`TGT\`, \`INC\`); do not mix your own.
- One or two words, sentence case. The word carries the meaning; the colour only supports it.
`, `
mount(row([
  h(R.StatusPill, { key: 1, tone: R.SEV.warn }, 'Warning'), h(R.StatusPill, { key: 2, tone: R.SEV.crit }, 'Critical'), h(R.StatusPill, { key: 3, tone: R.SEV.esc }, 'Escalated'),
  h(R.StatusPill, { key: 4, tone: R.INC.Open }, 'Open'), h(R.StatusPill, { key: 5, tone: R.INC.Investigating }, 'Investigating'), h(R.StatusPill, { key: 6, tone: R.INC.Closed }, 'Closed')
], 8));`);

card("KpiTile", "Status", 150, "components/ui/primitives.tsx", 20, `
A headline number for the top of a screen: a status dot and label, the figure, and one sub-line.

- You provide one \`kpi\` object: \`label\`, \`value\`, \`sub\` and a \`level\` (\`ok\`, \`warn\`, \`crit\` or \`esc\`) that colours the dot and the figure.
- Set \`muted\` when the figure is not available from the current data, so it reads as inactive instead of healthy.
- Lay tiles out in one row of equal columns. Keep the sub-line to a few words that say what the number counts.
`, `
var kpis = [
  { label: 'Open call-outs', value: 3, sub: '1 at Ops stage', level: 'crit' },
  { label: 'Breaching now', value: 2, sub: 'of 10 agents in span', level: 'warn' },
  { label: 'Avg response', value: '42s', sub: 'fire to acknowledge', level: 'ok' },
  { label: 'Open investigations', value: 1, sub: 'IR-0003', level: 'esc' },
  { label: 'Calls in queue', value: '\\u2014', sub: 'not in this data', level: 'ok', muted: true }
];
mount(grid(170, kpis.map(function (k) { return h(R.KpiTile, { key: k.label, kpi: k }); })));`);

card("Ladder", "Status", 120, "components/console/TriggerCard.tsx", 20, `
The escalation ladder: Nudge, Leader and Ops pips joined by a line, filled up to the stage a call-out has reached.

- You provide \`stage\`: \`nudge\`, \`lead\` or \`ops\`.
- It stretches to its container, so give it the width of the card it sits in.
- Stage colours are fixed: Nudge turquoise, Leader yellow, Ops purple.
`, `
mount(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 330 } },
  h(R.Ladder, { stage: 'nudge' }), h(R.Ladder, { stage: 'lead' }), h(R.Ladder, { stage: 'ops' })));`);

card("Toast", "Status", 370, "components/chrome/ToastStack.tsx", 20, `
A short notice that floats over the page: a coloured dot, a title and one sentence. Leaders get one for each escalation; everyone gets one to confirm an action.

- You provide a \`toast\` object: \`kind\` (\`warn\`, \`crit\`, \`esc\` or \`info\`), \`title\` and \`body\`.
- In the app, call the store's \`toast(kind, title, body)\`; \`ToastStack\` draws them 360px wide, bottom-right on wide screens, at most four at a time, each gone after 8 seconds on screen.
- The title says what happened; the body adds where it shows or what to do next. No buttons.
`, `
var toasts = [
  { id: 1, kind: 'warn', title: 'Extended ACW \\u00b7 Example, Bea', body: '3:11 in ACW. Strike 2 this shift; raised to the Team Lead.' },
  { id: 2, kind: 'crit', title: 'Prolonged offline \\u00b7 Example, Eli', body: '12:22 offline mid-shift.' },
  { id: 3, kind: 'esc', title: 'IR-0003 opened', body: 'Third instance for Example, Eli. An investigation is open.' },
  { id: 4, kind: 'info', title: 'Reason sent to your TL', body: 'Logged on the instance. It shows in the TL feed, the ledger and exports.' }
];
mount(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, width: 360, maxWidth: '100%' } }, toasts.map(function (t) { return h(R.Toast, { key: t.id, toast: t }); })));`);

card("PageTitle", "Layout", 120, "components/ui/primitives.tsx", 24, `
The title block at the top of a review screen: a muted eyebrow over a purple heading.

- You provide \`eyebrow\` (one word for the kind of screen: "Review", "Detect") and \`title\`.
- One per screen, at the top left of the content, above the KPI tiles.
`, `
mount(h(R.PageTitle, { eyebrow: 'Review', title: 'Shift dashboards' }));`);

card("DataTable", "Layout", 290, "components/ui/DataTable.tsx", 20, `
The console table: a tinted header band in Inter, row dividers and 14px body text. Use it for any list of records inside a panel.

- You provide \`columns\` (each with a \`key\`, a \`header\` and a \`cell\` function that renders one row), \`rows\` and \`rowKey\`.
- Right-align number columns with \`align: "right"\` and set them in the \`num\` class so digits line up.
- \`stickyHeader\` keeps the header visible inside a scrolling container. \`empty\` is shown under the header when there are no rows; say what would appear there.
- The first and last columns pad 20px to line up with the panel head. Place the table directly inside a \`panel\`, with no card around it.
`, `
function clock(t) { function p(n) { return String(n).padStart(2, '0'); } return p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60); }
var columns = [
  { key: 't', header: 'Time', cell: function (r) { return h('span', { className: 'num' }, clock(r.t)); } },
  { key: 'agent', header: 'Agent', cell: function (r) { return h('b', null, r.agent); } },
  { key: 'rule', header: 'Rule', cell: function (r) { return r.rule; } },
  { key: 'sev', header: 'Severity', cell: function (r) { return h(R.StatusPill, { tone: R.SEV[r.sev] }, R.SEV[r.sev].label); } },
  { key: 'val', header: 'Value', align: 'right', cell: function (r) { return h('span', { className: 'num' }, r.val); } }
];
mount(h('div', { className: 'panel', style: { overflow: 'hidden' } },
  h('div', { className: 'panel-head' }, h('h2', { className: 'panel-title' }, 'Instance ledger'), h('span', { className: 'panel-sub' }, 'Newest first')),
  h(R.DataTable, { columns: columns, rows: R.demo.ledger, rowKey: function (r) { return r.n; } })));`);

card("RuleRow", "Layout", 300, "components/rules/RuleRow.tsx", 20, `
One rule in the Rules Engine table: its name, type, condition, an editable threshold, severity, escalation route and an on/off switch.

- You provide the \`rule\`, \`canEdit\`, and \`onPatch(rule, patch)\`, called with the one field that changed (\`thr\`, \`sev\`, \`route\` or \`on\`).
- It renders a \`<tr>\` with seven cells, so place it in a table body under matching header cells with the \`th\` class.
- Without \`canEdit\` every control is disabled but still shows its value. A rule that is off is drawn at 60% opacity.
- The threshold saves on blur or Enter and never goes below 1.
`, `
function Demo() {
  var s = S(R.demo.rules.slice(0, 4));
  function patch(rule, p) { s[1](s[0].map(function (r) { return r.id === rule.id ? Object.assign({}, r, p) : r; })); }
  var heads = ['Rule', 'Type', 'Condition', 'Threshold', 'Severity', 'Escalation route', 'On'];
  return h('div', { className: 'panel', style: { overflow: 'auto' } }, h('table', { className: 'w-full border-collapse text-sm', style: { minWidth: 1040 } },
    h('thead', null, h('tr', null, heads.map(function (t, i) { return h('th', { key: t, scope: 'col', className: 'th text-left', style: { padding: '10px ' + (i === 0 || i === 6 ? 20 : 14) + 'px' } }, t); }))),
    h('tbody', null, s[0].map(function (r) { return h(R.RuleRow, { key: r.id, rule: r, canEdit: true, onPatch: patch }); }))));
}
mount(h(Demo));`);

card("AgentCard", "Console", 190, "components/console/AgentCard.tsx", 20, `
One agent on the floor grid: name and ID, a state dot with its label, time in state, and a strike count. A breach changes the card's ring and fill, yellow for a warning and red for a critical one.

- You provide the \`agent\`, the current \`rules\` (they decide whether the agent is breaching), \`query\` (lower-cased search text to highlight in the name; empty for none) and \`showMetrics\`.
- \`showMetrics\` adds two rows of small figures: AHT, calls, adherence, short calls, transfers. Turn it on for a single team, off for a whole floor.
- Cards carry no team line; always place them under their team's header, in a grid of \`minmax(190px, 1fr)\` columns.
`, `
var A = R.demo.agents;
mount(grid(190, [
  h(R.AgentCard, { key: 1, agent: A[0], rules: R.demo.rules, query: '', showMetrics: true }),
  h(R.AgentCard, { key: 2, agent: A[1], rules: R.demo.rules, query: 'bea', showMetrics: true }),
  h(R.AgentCard, { key: 3, agent: A[2], rules: R.demo.rules, query: '', showMetrics: true }),
  h(R.AgentCard, { key: 4, agent: A[4], rules: R.demo.rules, query: '', showMetrics: true })
]));`);

card("TeamGroup", "Console", 300, "components/console/TeamGroup.tsx", 20, `
A collapsible team on the agent grid. Its header shows the team name, its leaders and head count, how many agents are breaching, and the state mix as counts and a bar; opened, it shows the team's agent cards.

- You provide the \`team\`, \`all\` its agents in span (for the mix and the breach count), \`shown\` (the agents to draw after filtering and sorting), the \`rules\`, and \`open\` with \`onToggle\`.
- Set \`filtering\` while a filter is on, so the header reads "3 of 6 agents"; pass \`query\` and \`showMetrics\` through to the cards.
- Stack groups 12px apart. The header drops the counts and keeps the bar when the panel is narrow.
`, `
function Demo() {
  var o = S(true), t = R.demo.org[0];
  var all = R.demo.agents.filter(function (a) { return a.team === t.team; });
  return h(R.TeamGroup, { team: t, all: all, shown: all, rules: R.demo.rules, open: o[0], filtering: false, query: '', showMetrics: false, onToggle: function () { o[1](!o[0]); } });
}
mount(h(Demo));`);

card("AgentGridToolbar", "Console", 330, "components/console/AgentGridToolbar.tsx", 20, `
The filter bar above the agent grid: a search box, team, state and sort selects, quick-filter chips, the result line and Clear filters.

- You own the state. Provide \`filters\` (start from \`NO_FILTERS\`), \`onChange(patch)\` and \`onClear\`, plus a \`searchRef\` for the search input so "/" can focus it.
- Provide the data it reports: \`teamGroups\` and \`teamCount\` for the team select (hidden with one team), \`quickCounts\` for the chips, \`resultText\` for the result line, and \`filtering\` to show Clear filters.
- \`showExpandControls\` adds Expand all and Collapse all, wired to \`onExpandAll\` and \`onCollapseAll\`.
- Place it as the first thing inside the grid's panel, above the team groups.
`, `
function Demo() {
  var f = S(R.NO_FILTERS), ref = React.useRef(null);
  var filtering = !!(f[0].q || f[0].team || f[0].states.length || f[0].quick.breach || f[0].quick.strikes || f[0].quick.hold);
  var groups = R.demo.org.map(function (t) { return { label: t.mgr + ' \\u00b7 ' + t.lob, items: [{ value: t.team, label: t.team }] }; });
  return h('div', { className: 'panel' }, h(R.AgentGridToolbar, {
    filters: f[0], onChange: function (p) { f[1](Object.assign({}, f[0], p)); }, onClear: function () { f[1](R.NO_FILTERS); }, searchRef: ref,
    teamGroups: groups, teamCount: 2, quickCounts: { breach: 2, strikes: 3, hold: 1 }, filtering: filtering,
    resultText: filtering ? 'Filtered view of 10 agents' : '10 agents in 2 teams', showExpandControls: true, onExpandAll: function () {}, onCollapseAll: function () {}
  }));
}
mount(h(Demo));`);

card("TriggerCard", "Console", 440, "components/console/TriggerCard.tsx", 20, `
One call-out in the trigger feed: who, the severity, when, the rule and its value, the agent's reason if they sent one, the escalation ladder, and the actions.

- You provide the \`alert\` (a ledger instance), \`onAck(n)\` and \`onDraft(alert)\`.
- An open call-out shows Acknowledge; one that has reached Ops also shows "Open incident draft". An acknowledged one fades to 60% and shows how long the response took.
- Stack cards in a single column, newest first, 8 to 12px apart.
`, `
mount(grid(300, R.demo.ledger.map(function (r) { return h(R.TriggerCard, { key: r.n, alert: r, onAck: function () {}, onDraft: function () {} }); })));`);

card("IncidentTiles", "Console", 230, "components/console/IncidentTiles.tsx", 20, `
A panel listing the agents who have incident reports, one tile each, with the count and why each incident was opened.

- You provide \`incidents\`, the \`agents\` and the \`org\` (teams with their leaders), all already scoped to the viewer's span.
- A tile with an open incident is ringed red on the error fill; one whose incidents are all closed is grey and dimmed.
- Show it to managers on the Console, under the agent grid. Leave it out when there are no incidents.
`, `
mount(h(R.IncidentTiles, { incidents: R.demo.incidents, agents: R.demo.agents, org: R.demo.org }));`);

card("Navbar", "Chrome", 150, "components/chrome/Navbar.tsx", 0, `
The white top bar: the Carelon logo, the product name, the tabs the viewer's role may open, with count badges, and the viewer's initials, name and role.

- You provide \`current\`, the tab to underline. Everything else comes from the console store: the viewer, their permissions, and the open counts behind the badges.
- The ledger badge is red and counts open call-outs; the dashboards badge is purple and counts open investigations.
- Place it first in a sticky header, with ContextBar directly under it. Below 1280px the tabs move to their own scrolling row.
- This preview runs on a stand-in store with invented sample data.
`, `
R.demo.use();
mount(h('div', { style: { background: 'var(--surface-card)' } }, h(R.Navbar, { current: 'console' })));`);

card("ContextBar", "Chrome", 220, "components/chrome/ContextBar.tsx", 0, `
The strip under the navbar: who the console is being viewed as, what that role can see, the data source, the feed status pill and the shift clock.

- It takes no props; everything comes from the console store.
- The "View as" selectors appear only when the store carries a people directory (a development setting). The Data switch appears for viewers allowed to change the source.
- The feed pill is turquoise for the live feed, purple for a simulation or replay, yellow when the feed has gone stale, grey while connecting.
- This preview runs on a stand-in store with invented sample data; changing "View as" changes the role description.
`, `
R.demo.use({ view: { role: 'tl', who: 'Sample, Tessa' }, canSwitchFeed: true });
mount(h('div', { style: { background: 'var(--surface-card)' } }, h(R.ContextBar)));`);

card("NudgePopup", "Chrome", 360, "components/chrome/NudgePopup.tsx", 0, `
The agent's private nudge, fixed to the bottom-left of their screen: a greeting by first name, what the console noticed, an optional reason for their Team Lead, and three replies.

- It takes no props. It shows the store's current nudge, and only when the viewer is the agent it is about.
- "Got it" acknowledges. "On a case, 2 min" closes it without acknowledging. "Send reason" logs up to 140 characters on the instance, or acknowledges if the box is empty.
- It leaves by itself after 14 seconds on screen, but never while the agent is typing or the tab is in the background.
- Keep the copy factual and free of blame: say what was seen and offer a way to explain.
- This preview runs on a stand-in store and brings the nudge back after it closes.
`, `
function show() { R.demo.use({ view: { role: 'agent', who: R.demo.nudge.agent }, nudge: R.demo.nudge }); }
show();
setInterval(show, 16000);
mount(h(R.NudgePopup));`);

card("CsvImportDialog", "Chrome", 640, "components/chrome/CsvImportDialog.tsx", 0, `
The dialog for importing a day of floor data and replaying it through the rules engine. It takes the filled-in Excel template or a raw agent-status CSV, and for a CSV asks which column is which and how each status maps to a console state.

- You provide \`onClose\` and \`onStarted\` (called once the replay has begun, so you can close the dialog and show the replay).
- It is modal over a dimmed page and closes on Escape. Problems with the file are listed in red above the buttons.
- "Start replay" stays disabled until a file has been read.
- In this preview the server calls are stand-ins, so an uploaded file is not checked or replayed.
`, `
mount(h(R.CsvImportDialog, { onClose: function () {}, onStarted: function () {} }));`);

card("LockScreen", "Chrome", 520, "components/chrome/LockScreen.tsx", 0, `
The password wall shown before the console: the Carelon wordmark, the product name, one password field and Unlock.

- You provide \`next\`, the path to open after a correct password.
- It fills the screen and centres a 400px card. The error line under the button keeps its height, so the card does not jump when a message appears.
- It posts the password to the app's unlock route; in this preview there is no server, so submitting shows the request-failed message.
`, `
mount(h(R.LockScreen, { next: '/console' }));`);

card("ConsoleShell", "Chrome", 760, "components/chrome/ConsoleShell.tsx", 0, `
The page frame for every console screen: the sticky header (Navbar and ContextBar), the main column with its gutters, the footer with the data-source notes and the "Powered by BITS" credit, and the toast and nudge layers.

- You provide the screen as \`children\`. The shell opens the live connection and renders the screen only for roles allowed to open it.
- Screens stack their sections 24px apart inside the main column; do not add your own page padding.
- When nobody is signed in it shows a "Sign-in required" panel instead of the screen.
- This preview runs on a stand-in store with invented sample data and no live connection.
`, `
R.demo.use();
mount(h(R.ConsoleShell, null,
  h(R.PageTitle, { eyebrow: 'Detect', title: 'Live floor' }),
  h(R.IncidentTiles, { incidents: R.demo.incidents, agents: R.demo.agents, org: R.demo.org })));`);

card("CarelonLogo", "Brand", 120, "components/ui/LogoLockup.tsx", 0, `
The Carelon Global Solutions wordmark, padded on all four sides by the width of its own icon so nothing crowds it.

- You provide \`height\` in px (default 22, the navbar size). The clear space scales with it.
- Place it on white. Where the wordmark does not fit, use CarelonMark.
- When a container already supplies the room on one side, pull the logo back by \`carelonClearSpace(height)\`, as the navbar and lock screen do.
`, `
mount(h('div', { style: { background: 'var(--surface-card)', display: 'flex', alignItems: 'center', gap: 24, padding: 16 } }, h(R.CarelonLogo, { height: 22 }), h(R.CarelonLogo, { height: 32 })));`);

card("CarelonMark", "Brand", 96, "components/ui/LogoLockup.tsx", 0, `
The Carelon icon mark on its own, for places the wordmark does not fit: the navbar on narrow screens, and the head of the nudge.

- You provide \`size\` in px (default 32) and, where the mark is decorative beside text, \`alt=""\`.
- Place it on white, and never beside the full wordmark.
`, `
mount(h('div', { style: { background: 'var(--surface-card)', display: 'flex', alignItems: 'center', gap: 24, padding: 24 } }, h(R.CarelonMark, { size: 32 }), h(R.CarelonMark, { size: 28 })));`);

card("BitsLogo", "Brand", 96, "components/ui/LogoLockup.tsx", 0, `
The BITS mark, for the "Powered by" credit in the footer.

- You provide \`height\` in px (default 28).
- Use it once per page, in the footer, after the words "Powered by". It is not a navigation logo.
`, `
mount(h('div', { style: { background: 'var(--surface-card)', display: 'flex', alignItems: 'center', gap: 8, padding: 24, fontSize: 12, color: 'var(--text-muted)' } }, 'Powered by', h(R.BitsLogo, { height: 28 })));`);

card("Icons", "Brand", 80, "components/ui/primitives.tsx", 20, `
The three icon components: \`SearchIcon\`, \`CloseIcon\` and \`FilterClearIcon\`. Each is a Material Symbols glyph drawn inline and filled with brand purple.

- You provide \`size\` in px (20, 16 and 24 by default). \`FilterClearIcon\` takes \`active\`; without it the icon is drawn at 55% opacity.
- They are decorative (\`aria-hidden\`), so the button around one needs its own text or \`aria-label\`: "Clear search", "Clear filters".
`, `
mount(row([h(R.SearchIcon, { key: 1 }), h(R.CloseIcon, { key: 2 }), h(R.FilterClearIcon, { key: 3, active: true }), h(R.FilterClearIcon, { key: 4 })], 20));`);

const header = JSON.parse(readFileSync(path.join(here, "cards.json"), "utf8"));
for (const c of C) {
  if (c.name !== "Icons" && !header.includes(c.name)) throw new Error(c.name + " missing from cards.json");
  put(`components/${c.name}/README.md`, c.doc + "\n");
  put(`components/${c.name}/preview.html`, `<!-- @dsCard group="${c.group}" height=${c.height} -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${c.name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>body { padding: ${c.pad}px; }</style>
</head>
<body>
<div id="root"></div>
<script>
${PRE}${c.script}
</script>
</body>
</html>
`);
  if (c.name !== "Icons") tokens.meta.components[c.name] = c.src;
}
for (const n of header) if (!C.some(c => c.name === n)) throw new Error("no card for " + n);
put("tokens.json", JSON.stringify(tokens, null, 2) + "\n");

// ---------------------------------------------------------------- index
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const logo = (name, blob, size) => ({ name, blob, size, type: "image/png" });
put("design-system.json", JSON.stringify({
  v: 3, layout: "files", createdOnFiles: { v: 1, at: "2026-10-08T06:44:49Z" }, title: "RTM Console", namespace: "RTM",
  libraries: [{ name: "react", version: "18" }, { name: "react-dom", version: "18" }],
  sections: {}, groups: ["Logos"],
  assetGroups: { Logos: { name: "Logos", tile: "l", order: ["carelon-global-solutions.png", "carelon-icon-mark.png", "bits-logo.png"], files: {
    "carelon-global-solutions.png": logo("carelon-global-solutions.png", "657ea3b1296373c954231203d9004307", 69447),
    "carelon-icon-mark.png": logo("carelon-icon-mark.png", "34a5d215e86bb2a324526ded54b19a3b", 25431),
    "bits-logo.png": logo("bits-logo.png", "1a991f5f95c160e2d7905ee2de2086f2", 2769355),
  } } },
  blobs: {}, docs: { sections: [] },
  lastChange: { by: "Arielle Jimera", at: now, via: `GitHub · aishki/rtm-console@${sha}`, note: `Synced from ${branch}@${sha}: tokens, ${header.length} components, 3 logos.` },
}, null, 2) + "\n");

// ---------------------------------------------------------------- local check page (not published)
const val = t => (/^\{/.test(t.value) ? `var(--${t.value.slice(1, -1)})` : t.value);
const tokensCss = `:root{${[...tokens.color.tokens, ...tokens.shadow.tokens, ...tokens.spacing.tokens, ...tokens.radius.tokens].map(t => `--${t.name}:${val(t)}`).join(";")};--font-brand:${tokens.type.families.brand};--font-ui:${tokens.type.families.ui}}`;
writeFileSync(path.join(work, "check-tokens.css"), tokensCss);
writeFileSync(path.join(work, "cards-built.json"), JSON.stringify(["Cover", ...C.map(c => c.name)]));
console.log(`tokens: ${colors.length} colours, ${tokens.radius.tokens.length} radii, ${tokens.shadow.tokens.length} shadows, ${tokens.breakpoint.tokens.length} breakpoints; ${C.length} cards`);
