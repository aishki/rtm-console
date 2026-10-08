// Builds components/bundle.js and components/bundle.css from this checkout, using its own installed tools.
// Usage: node tools/design-system/build.mjs [repo] [outDir]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] ?? path.join(here, "../.."));
const out = path.resolve(process.argv[3] ?? path.join(repo, ".design-system/out/project"));
const req = createRequire(path.join(repo, "package.json"));
const { rolldown } = req("rolldown");
const postcss = req("postcss");
const tailwind = req("@tailwindcss/postcss");

const shim = f => path.join(here, "shims", f);
const SHIMS = {
  "react/jsx-runtime": shim("jsx-runtime.js"), "next/link": shim("next-link.tsx"), "next/image": shim("next-image.tsx"), "next/navigation": shim("next-navigation.ts"),
  "@/lib/client/store": shim("store.ts"), "@/lib/client/api": shim("api.ts"), "@/lib/client/alerts": shim("alerts.ts"),
};
const CARDS = JSON.parse(readFileSync(path.join(here, "cards.json"), "utf8"));

const bundle = await rolldown({
  input: path.join(here, "entry.tsx"),
  external: ["react", "react-dom"],
  resolve: { alias: { "@": repo } },
  transform: { define: { "process.env.NODE_ENV": '"production"' } },
  plugins: [{
    name: "preview-shims",
    resolveId(source, importer) {
      if (SHIMS[source]) return SHIMS[source];
      // hooks.ts reaches the store by a relative path.
      if (source === "./store" && importer && /lib[\\/]client[\\/]hooks\.ts$/.test(importer)) return SHIMS["@/lib/client/store"];
      return null;
    },
  }],
});
const { output } = await bundle.generate({ format: "iife", name: "RTM", globals: { react: "React", "react-dom": "ReactDOM" }, minify: true });
const js = output[0].code;
if (/<\/script|<!--/i.test(js)) throw new Error("bundle holds a literal </script or <!--");
const header = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: "RTM", components: CARDS.map(name => ({ name })) })} */\n`;
mkdirSync(path.join(out, "components"), { recursive: true });
writeFileSync(path.join(out, "components/bundle.js"), header + js + "\nwindow.RTM = RTM;\n");

// The app's stylesheet, with two changes: the token block moves into a cascade layer so the design system's own
// tokens.css (unlayered) wins when a value is edited there, and Inter is named directly (next/font is not in a preview).
let css = readFileSync(path.join(repo, "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
const start = css.indexOf(":root {"), end = css.indexOf("\n}\n", start) + 3;
if (start < 0 || end < 3) throw new Error("globals.css: no :root block");
css = css.slice(0, start) + "@layer theme {\n" + css.slice(start, end) + "}\n" + css.slice(end);
if (!css.includes('@import "tailwindcss";') || !css.includes("var(--font-inter), Inter")) throw new Error("globals.css changed shape");
css = css.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components";').replace("var(--font-inter), Inter", "Inter");
const res = await postcss([tailwind()]).process(css, { from: path.join(repo, "app/__design_system_entry.css") });
if (/<\/style/i.test(res.css)) throw new Error("stylesheet holds a literal </style");
writeFileSync(path.join(out, "components/bundle.css"), res.css);
console.log("bundle.js", js.length, "bundle.css", res.css.length, "exports:", output[0].exports?.join(" "));
