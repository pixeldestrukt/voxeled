// Vendor the viewer into another site: copies viewer/ + src/ (what the page imports, nothing
// else) to <dest>/, so a page on that site can embed it —
//   <iframe src="/voxeled/viewer/?project=/thread/thread.yaml&ui=bar&sim=1">
// Re-run to update. `node scripts/vendor.mjs ../dnuke.art/voxeled`
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.resolve(process.argv[2] || "");
if (!process.argv[2]) { console.error("usage: node scripts/vendor.mjs <dest>"); process.exit(2); }
rmSync(dest, { recursive: true, force: true }); mkdirSync(dest, { recursive: true });
for (const d of ["viewer", "src"]) cpSync(path.join(ROOT, d), path.join(dest, d), { recursive: true, filter: (f) => !/node_modules|\.test\.mjs$|__pycache__|\/cli\//.test(f) });
const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
let commit = ""; try { commit = readFileSync(path.join(ROOT, ".git/HEAD"), "utf8").trim(); if (commit.startsWith("ref:")) commit = readFileSync(path.join(ROOT, ".git", commit.slice(5)), "utf8").trim(); } catch {}
writeFileSync(path.join(dest, "voxeled.json"), JSON.stringify({ voxeled: version, commit, vendored: new Date().toISOString(), from: "https://github.com/pixeldestrukt/voxeled" }, null, 2) + "\n");
console.log(`✓ vendored viewer + src → ${dest} (voxeled ${version}${commit ? " @ " + commit.slice(0, 7) : ""})`);
