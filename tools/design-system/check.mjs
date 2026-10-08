// Usage: node tools/design-system/check.mjs [outDir], then open .design-system/check/sheet.html
// Local render check only: wraps each preview the way the design-system page does and lays them out on one sheet.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "../../.design-system/out/project"));
const dir = path.join(out, "../../check");
mkdirSync(dir, { recursive: true });
const cards = JSON.parse(readFileSync(path.join(dir, "cards-built.json"), "utf8"));
const rel = p => path.relative(dir, p).replace(/\\/g, "/");
const head = `<link rel="stylesheet" href="${rel(path.join(dir, "check-tokens.css"))}">
<link rel="stylesheet" href="${rel(path.join(out, "components/bundle.css"))}">
<script>window.onerror = function (m) { var d = document.createElement('pre'); d.style.cssText = 'color:#fff;background:#c00;padding:8px;position:fixed;top:0;left:0;z-index:9999;margin:0'; d.textContent = 'ERROR ' + m; document.documentElement.appendChild(d); };</script>
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="${rel(path.join(out, "components/bundle.js"))}"></script>`;
let sheet = "<!doctype html><meta charset=utf-8><body style='margin:0;font:12px sans-serif;background:#ddd'>";
for (const name of cards) {
  const html = readFileSync(path.join(out, "components", name, "preview.html"), "utf8");
  const height = Number(/height=(\d+)/.exec(html)[1]);
  writeFileSync(path.join(dir, name + ".html"), html.replace("<head>", '<head>' + head).replace("<html", '<html data-theme="light"'));
  sheet += `<div style="padding:4px 8px">${name} · ${height}px</div><iframe src="${name}.html" style="display:block;border:0;width:960px;height:${height}px;background:#fff"></iframe>`;
}
writeFileSync(path.join(dir, "sheet.html"), sheet + "</body>");
console.log(path.join(dir, "sheet.html"));
