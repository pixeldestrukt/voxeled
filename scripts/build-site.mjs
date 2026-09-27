// Build the static site: the viewer + the modules it imports + the example layouts and assets,
// laid out so the page's relative imports (../src/…, ../examples/…) resolve exactly as in the repo.
//   node scripts/build-site.mjs [out=site]
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || "site");
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const d of ["viewer", "src", "examples/mobius-heart/layouts", "examples/mobius-heart/assets", "examples/lx"]) cpSync(path.join(ROOT, d), path.join(out, d), { recursive: true, filter: (f) => !/node_modules|\.test\.mjs$/.test(f) });
cpSync(path.join(ROOT, "index.html"), path.join(out, "index.html"));
writeFileSync(path.join(out, ".nojekyll"), "");
const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
writeFileSync(path.join(out, "site.json"), JSON.stringify({ voxeled: version, built: new Date().toISOString() }));
console.log(`site → ${out}`);
