RTM Console is the real-time monitoring and escalation console for a contact-centre floor. It is built on the BITS design tokens: brand purple on white cards over a light-gray page, with colour reserved for agent state and severity.

## Voice and copy

- Write to the person, plainly and without blame. A nudge opens with the first name and a soft lead: "Carlo, quick heads up". Its buttons answer in the agent's own words: "Got it", "On a case, 2 min", "Send reason".
- Use sentence case everywhere: "Import floor data", "Enable desktop alerts", "Clear filters". Only product and screen names are capitalised: "RTM Console", "Rules Engine", "Instance Ledger".
- Buttons start with a verb and say what happens: "Acknowledge", "Start replay", "Download template", "Exit replay".
- Join facts on one line with a middle dot, not a dash or a comma: "Extended ACW · 3:11 in ACW · strike 2", "TL Sample, Tessa · 6 agents".
- A toast is a short title and one sentence that says what happened and where it shows: "Reason sent to your TL" / "Logged on the instance. It shows in the TL feed, the ledger and exports."
- Errors say what went wrong and what to do: "Could not read the file: fewer than 2 rows found. Upload the .xlsx template or a .csv export."
- Keep the floor's own abbreviations: TL, ACW, Aux, AHT, Adh, IR, Ops. Strikes are written "×2".
- No emoji. No exclamation marks.

## Colour

- The page is `surface-page`; cards, panels, the navbar and dialogs are `surface-card`. Do not put a card on a card: inside a panel, rows are separated by `border-row`.
- `purple` is the one brand colour. Use it for headings (`text-heading`), the primary action (`action-primary`), links, the active tab and selected values. Hover is `action-primary-hover`, pressed is `action-primary-active`.
- Body copy is `text-body`; longer explanatory copy is `text-strong`; sub-lines, captions and labels are `text-muted`. Text on `purple`, `dark-purple` and `error` is `text-inverse`.
- Tinted bands (table headers, an open team header, an agent's comment) are `surface-tint`, with `purple-900` text.
- Severity always comes as a pair, tint under text, plus a word: Warning is `warning-text` on `warning-tint`, Critical is `error-text` on `error-tint`, Escalated is `purple` on `pale-purple`, done or on target is `success-text` on `success-tint`.
- The solid colours `turquoise`, `success`, `warning`, `light-purple`, `cyan` and `neutral-500` are for 8 to 10px state dots, ladder pips and the mix bar only. They are too light for text, so every dot sits beside its label: On Call, Available, ACW, Aux Break, Outbound, Offline. Aux Personal uses `purple`.
- Escalation stages have fixed colours: Nudge is `turquoise`, Leader is `warning`, Ops is `purple`.
- An agent card that is breaching gets a 2px inset ring in `warning` on `warning-fill`; a critical one gets `error` on `error-fill`. Nothing else uses those fills.
- There is one theme, light. The source defines no dark values.

## Type

- Two families. `brand` (Elevance Sans, falling back to the system UI font) sets everything people read. `ui` (Inter) sets everything people compare: numbers, timers, table headers, IDs, badges. Add `font-variant-numeric: tabular-nums` wherever digits line up.
- Headings are medium weight, purple and slightly tight: `heading-page` for a screen, `heading-dialog` for a dialog, `heading-panel` for a panel.
- Body is `copy-body` (14px). Sub-lines are `copy-small` (13px), captions `copy-caption` (12px). Emphasis inside copy is weight 600, never italic.
- A screen title carries an eyebrow in `copy-lead` and `text-muted` above it.

## Shape, borders and elevation

- Cards and panels have no border and no drop shadow. They are outlined by `ring-card`, a 1px inset line in `border-card`.
- Shadows mark floating layers only: `shadow-toast` for toasts and open menus, `shadow-nudge` for the nudge.
- Radii step with size: `radius-8` for fields, selects and menus; `radius-15` for agent cards, trigger cards and toasts; `radius-16` for KPI tiles; `radius-20` for panels, dialogs and buttons; `radius-pill` for pills, badges and the switch.
- Fields and selects are 1px `border-neutral` on white, turning `purple` while open or filled.
- Every control shows a 2px `focus-ring` outline, offset 2px, on keyboard focus.

## Layout

- Spacing follows a 4px scale. Page gutters are `space-8` (`space-4` on phones), sections are `space-6` apart, panels pad `space-5`, cards in a grid sit `space-3` apart.
- The navbar is `navbar-height` tall and sticky, with the context bar under it. Tabs drop to their own scrolling row below 1280px; the wordmark gives way to the icon mark below `w720`.
- Grids fill with `repeat(auto-fill, minmax(…, 1fr))`: 190px for agent cards, 260px for incident tiles.

## Motion

- Colour and position changes take 200ms; a filter chip takes 120ms. Both use the easing `cubic-bezier(0.2, 0, 0.2, 1)`. Nothing bounces or slides in.

## Iconography

- Icons are inline SVG, not a font or image files. `SearchIcon`, `CloseIcon` and `FilterClearIcon` are Material Symbols glyphs filled with `purple`.
- Chevrons, check marks and the tertiary arrow are small 1.5 to 1.8px round-capped strokes that take the text colour.
- State is shown by a coloured dot plus a word, never by an icon alone.

## Logos

- The navbar carries the Carelon Global Solutions wordmark at 22px tall, padded on every side by the width of its own icon (`CarelonLogo` does this). Where it does not fit, use `CarelonMark`.
- The BITS mark appears once, in the footer credit "Powered by".
- Use the files in Logos as they are. Never redraw, recolour or crop them.

## Not synced

- Motion variables (`--bits-ease`, `--duration-fast`, `--duration-base`) have no token family here; their values are in the stylesheet and under Motion above.
- Elevance Sans font files are not in the repository, so previews fall back to the system UI font. Inter loads from Google Fonts.
- `opssup-logo.png` is in the repository folder but untracked and unused, so it was left out.
- Components were built from source into the bundle. `Navbar`, `ContextBar`, `NudgePopup`, `ToastStack`, `ConsoleShell`, `LockScreen` and `CsvImportDialog` read the app's store and API; in previews those are replaced by stand-ins with invented sample data, and Next.js `Link` and `Image` by plain elements.
- Border radii and the Tailwind spacing scale are compiled into the stylesheet as literal values, so editing those tokens here does not change the component previews. Colour and shadow tokens do.
