// Build the static site: the viewer + the modules it imports + the example layouts and assets
// (laid out so the page's relative imports resolve exactly as in the repo), the docs rendered to
// HTML with a nav, and the landing page.   node scripts/build-site.mjs [out=site]
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || "site");
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const d of ["viewer", "src", "examples/mobius-heart/layouts", "examples/mobius-heart/assets", "examples/lx", "integrations"]) if (statSync(path.join(ROOT, d), { throwIfNoEntry: false })) cpSync(path.join(ROOT, d), path.join(out, d), { recursive: true, filter: (f) => !/node_modules|\.test\.mjs$|__pycache__/.test(f) });
writeFileSync(path.join(out, ".nojekyll"), "");
const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
writeFileSync(path.join(out, "site.json"), JSON.stringify({ voxeled: version, built: new Date().toISOString() }));

// ── docs: Markdown → HTML (the subset these docs use), with links rewritten .md → .html ──────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s) {
  const code = []; s = s.replace(/`([^`]+)`/g, (_, c) => (code.push(`<code>${esc(c)}</code>`), `\u0000${code.length - 1}\u0000`));
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1<i>$2</i>").replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${h.replace(/^(\.\.\/)?docs\//, "").replace(/\.md(#|$)/, ".html$1").replace(/^\.\.\/integrations\/([\w-]+)\/?$/, "https://github.com/pixeldestrukt/voxeled/tree/main/integrations/$1")}">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => code[+i]);
}
const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
function markdown(md) {
  const lines = md.split("\n"), html = []; let i = 0, list = null;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { closeList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; html.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const t = inline(h[2]); html.push(`<h${h[1].length} id="${slug(h[2])}">${t}</h${h[1].length}>`); i++; continue; }
    if (/^\s*---+\s*$/.test(l)) { closeList(); html.push("<hr/>"); i++; continue; }
    if (/^\|/.test(l)) { closeList(); const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const body = rows.filter((r) => !/^\|\s*-+/.test(r)); html.push(`<div class="tbl"><table><tr>${cells(body[0]).map((c) => `<th>${c}</th>`).join("")}</tr>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table></div>`); continue; }
    const li = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) { const kind = /\d/.test(li[2]) ? "ol" : "ul"; if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; } let t = li[3]; while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i + 1])) t += " " + lines[++i].trim(); html.push(`<li>${inline(t)}</li>`); i++; continue; }
    if (/^>\s?/.test(l)) { closeList(); const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, "")); html.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`); continue; }
    if (!l.trim()) { closeList(); i++; continue; }
    closeList(); const buf = []; while (i < lines.length && lines[i].trim() && !/^(#|```|\||>|\s*([-*]|\d+\.)\s|\s*---)/.test(lines[i])) buf.push(lines[i++]); html.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  closeList(); return html.join("\n");
}
const NAV = [["START", "Getting started"], ["EDITOR", "The editor"], ["GUIDE", "Authoring guide"], ["STATIC", "The static page"], ["FORMAT", "Formats"], ["interop/protocols", "Protocols"], ["interop/lxm", "Chromatik .lxm"], ["visibility", "Visibility & simulator"], ["DEMO-mobius-heart", "Demo walkthrough"], ["LANDSCAPE", "Where voxeled sits"], ["DESIGN", "Design"]];
const CSS = `:root{color-scheme:dark light}body{margin:0;background:#0b0d16;color:#dfe4ff;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}a{color:#ff8fb0}
.wrap{display:flex;gap:32px;max-width:1180px;margin:0 auto;padding:24px 20px}nav{flex:0 0 200px;position:sticky;top:20px;align-self:flex-start;font-size:13.5px}nav a{display:block;color:#aab3d8;padding:3px 0;text-decoration:none}nav a.on,nav a:hover{color:#ff8fb0}nav .top{font-weight:700;color:#ff5e87;margin-bottom:10px;font-size:15px}
main{flex:1;min-width:0}main h1{font-size:28px;margin:0 0 12px}main h2{margin-top:36px;border-bottom:1px solid #232b48;padding-bottom:4px}code{background:#171c30;padding:1px 5px;border-radius:4px;font-size:.9em}pre{background:#0d1020;border:1px solid #232b48;border-radius:8px;padding:12px 14px;overflow:auto}pre code{background:none;padding:0}
.tbl{overflow-x:auto}table{border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #232b48;vertical-align:top}th{color:#aab3d8}blockquote{border-left:3px solid #ff5e87;margin:0;padding:4px 14px;color:#aab3d8}hr{border:0;border-top:1px solid #232b48;margin:28px 0}
@media(max-width:800px){.wrap{flex-direction:column}nav{position:static;flex:none}}`;
const page = (title, body, cur) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · voxeled</title><style>${CSS}</style></head><body><div class="wrap"><nav><a class="top" href="../">♥ voxeled</a><a href="../viewer/?static=1">open the viewer ↗</a><hr/>${NAV.map(([f, t]) => `<a href="${f}.html"${f === cur ? ' class="on"' : ""}>${t}</a>`).join("")}<hr/><a href="https://github.com/pixeldestrukt/voxeled">GitHub ↗</a></nav><main>${body}</main></div></body></html>`;
const docsOut = path.join(out, "docs"); mkdirSync(path.join(docsOut, "interop"), { recursive: true });
for (const [f, t] of NAV) { const md = readFileSync(path.join(ROOT, "docs", f + ".md"), "utf8"); const body = markdown(md).replace(/href="([^"]+)"/g, (m, h) => (f.includes("/") && !/^(https?:|#|\.\.\/)/.test(h) && !h.startsWith("interop/") ? `href="../${h}"` : m)); writeFileSync(path.join(docsOut, f + ".html"), page(t, body, f)); }
// landing
writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>voxeled</title><style>${CSS}.hero{max-width:760px;margin:60px auto;padding:0 20px}.hero h1{font-size:40px;margin:0}.hero p.lead{font-size:18px;color:#aab3d8}.cta a{display:inline-block;background:#ff5e87;color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px;margin:6px 8px 6px 0}.cta a.alt{background:#232b48}.ex a{margin-right:12px}</style></head><body><div class="hero">
<h1>♥ voxeled</h1><p class="lead">Open, integration-friendly volumetric LED show control. Describe an LED piece once — every LED's position, normal and wiring — and get a browser preview, a simulator that renders the LEDs as they'll really look, spatial patterns in real millimetres, a builder, and real output over Art-Net / DDP / sACN / dan-mx.</p>
<p class="cta"><a href="viewer/?static=1">Open the viewer</a><a class="alt" href="docs/START.html">Getting started</a><a class="alt" href="docs/EDITOR.html">The editor</a><a class="alt" href="docs/GUIDE.html">Authoring guide</a></p>
<p>The viewer runs the whole authoring side <b>in your browser</b> — the files you add stay there, nothing is uploaded. Run the hub next to your LEDs for real output.</p>
<p class="ex">Examples: <a href="viewer/?example=columns&sim=1">columns</a><a href="viewer/?example=two-hearts">two hearts</a><a href="viewer/?example=site&stand=sidewalk">at a site</a><a href="viewer/?example=ropes&ui=bar&sim=1">ropes on paths</a><a href="viewer/?example=grid-3x3">a 3×3 array</a></p>
<p class="ex">In the wild: <a href="https://dnuke.art/thread/">Thread</a> — 7,200 LEDs on twelve diffused ropes, live from the sculpture's own controller, running on this viewer.</p>
<p><a href="docs/STATIC.html">The static page</a> · <a href="docs/FORMAT.html">Formats</a> · <a href="docs/interop/protocols.html">Protocols</a> · <a href="docs/LANDSCAPE.html">Where voxeled sits</a> · <a href="https://github.com/pixeldestrukt/voxeled">GitHub</a> · v${version}</p></div></body></html>`);
console.log(`site → ${out} (${NAV.length} docs)`);
