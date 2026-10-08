# Design system sync

Scripts that turn this repo's components and tokens into the files of the **RTM Console** design system on claude.ai:
https://claude.ai/artifact/Kpd3Lb6FXFS1tKrVqRVSR9 (private to its owner until shared).

Nothing in the app imports this folder. Run it only when the components or `app/globals.css` have changed and the design system should match.

## Run

From the repo root, after `npm install`:

```sh
node tools/design-system/build.mjs   # components -> bundle.js and bundle.css
node tools/design-system/gen.mjs     # tokens.json, component notes and previews, the index
node tools/design-system/check.mjs   # optional: writes .design-system/check/sheet.html to look at locally
```

Output goes to `.design-system/` (gitignored). The files to publish are under `.design-system/out/project/`.

## Publish

The scripts do not upload anything. Ask Claude Code to "re-sync the RTM Console design system from `tools/design-system`" and give it the link above. It publishes the changed files from `.design-system/out/project/` to that artifact.

Before publishing `design-system.json`, read the live one first and keep anything changed on the page (asset records, section titles). The generated copy only knows what was true at the first sync.

## What is here

| File | What it does |
| --- | --- |
| `build.mjs` | Bundles `entry.tsx` into one script (`window.RTM`) with rolldown, and compiles `app/globals.css` with Tailwind into the stylesheet. |
| `gen.mjs` | Reads the `:root` and `@theme` blocks of `app/globals.css` into `tokens.json`, and writes each component's README and preview. Usage notes, text styles and component docs are written by hand in this file. |
| `check.mjs` | Lays every preview out on one local page for a quick look. |
| `entry.tsx` | The components that are exported to the design system. |
| `cards.json` | The components that get a card, in display order. |
| `demo.ts` | Sample floor for the previews. Every name, ID and number is invented; keep it that way. |
| `shims/` | Stand-ins for what a preview cannot run: the console store, the API client, desktop alerts, and Next.js `Link`, `Image` and navigation. |
| `static/` | Hand-written files copied as they are: the brand book, the cover, the types and the logo notes. |

## When something changes

- **A new component:** export it from `entry.tsx`, add its name to `cards.json`, add a `card(...)` block in `gen.mjs` and its props to `static/components/index.d.ts`.
- **A new token in `globals.css`:** add a usage note for it in the `USAGE` map in `gen.mjs`; the script stops if one is missing.
- **A new logo:** upload it to the artifact, then add its path and returned id to `shims/next-image.tsx` and its record to the index in `gen.mjs`.
- **A component starts reading a new store field or API call:** add it to `shims/store.ts` or `shims/api.ts`.
