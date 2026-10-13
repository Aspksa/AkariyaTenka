import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const DIST = path.resolve("apps/web/dist");
const JS_BROTLI_BUDGET = 150 * 1024;
const CSS_BROTLI_BUDGET = 50 * 1024;
const TOTAL_INITIAL_BROTLI_BUDGET = 200 * 1024;

function assetPaths(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
}

async function compressedSize(relative) {
  const file = path.join(DIST, relative.replace(/^\/+/, ""));
  const br = file + ".br";
  try {
    return { size: (await stat(br)).size, representation: "br" };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { size: (await stat(file)).size, representation: "identity" };
  }
}

const html = await readFile(path.join(DIST, "index.html"), "utf8");
const scripts = assetPaths(html, /<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/giu);
const styles = assetPaths(html, /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+\.css)["'][^>]*>/giu);

if (scripts.length === 0) throw new Error("No initial JavaScript entry found in built index.html");

let jsBytes = 0;
let cssBytes = 0;
const initial = [];

for (const relative of scripts) {
  const compressed = await compressedSize(relative);
  jsBytes += compressed.size;
  initial.push({ type: "js", path: relative, ...compressed });
}
for (const relative of styles) {
  const compressed = await compressedSize(relative);
  cssBytes += compressed.size;
  initial.push({ type: "css", path: relative, ...compressed });
}

const totalBytes = jsBytes + cssBytes;
if (jsBytes > JS_BROTLI_BUDGET) {
  throw new Error("Initial JavaScript budget exceeded: " + jsBytes + " > " + JS_BROTLI_BUDGET);
}
if (cssBytes > CSS_BROTLI_BUDGET) {
  throw new Error("Initial CSS budget exceeded: " + cssBytes + " > " + CSS_BROTLI_BUDGET);
}
if (totalBytes > TOTAL_INITIAL_BROTLI_BUDGET) {
  throw new Error("Initial web transfer budget exceeded: " + totalBytes + " > " + TOTAL_INITIAL_BROTLI_BUDGET);
}

const assetsDirectory = path.join(DIST, "assets");
const builtAssets = await readdir(assetsDirectory).catch(() => []);
const jsChunks = builtAssets.filter((name) => name.endsWith(".js"));
if (jsChunks.length <= scripts.length) {
  throw new Error("Expected at least one lazy JavaScript chunk for deferred features");
}

console.log(JSON.stringify({
  initial,
  initialJsBrotliKiB: Number((jsBytes / 1024).toFixed(2)),
  initialCssBrotliKiB: Number((cssBytes / 1024).toFixed(2)),
  initialTotalBrotliKiB: Number((totalBytes / 1024).toFixed(2)),
  lazyJsChunks: jsChunks.length - scripts.length,
  budgetsKiB: {
    initialJs: JS_BROTLI_BUDGET / 1024,
    initialCss: CSS_BROTLI_BUDGET / 1024,
    initialTotal: TOTAL_INITIAL_BROTLI_BUDGET / 1024
  }
}, null, 2));
