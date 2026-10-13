import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const STARTUP_BUDGET_MS = 5_000;
const HEALTH_P95_BUDGET_MS = 250;
const WEB_INDEX_P95_BUDGET_MS = 100;
const WEB_REVALIDATE_P95_BUDGET_MS = 50;
const WEB_ASSET_P95_BUDGET_MS = 50;
const RSS_BUDGET_BYTES = 256 * 1024 * 1024;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate performance-test port");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

async function timedFetch(url, init = {}) {
  const started = performance.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(1_000) });
  const elapsed = performance.now() - started;
  return { response, elapsed };
}

function enforceBudget(name, value, budget) {
  if (value > budget) throw new Error(name + " budget exceeded: " + value.toFixed(2) + " ms > " + budget + " ms");
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), "akariya-perf-"));
const port = await freePort();
const base = "http://127.0.0.1:" + port;
const startedAt = performance.now();

const child = spawn(process.execPath, ["apps/server/dist/server.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    AKARIYA_HOST: "127.0.0.1",
    AKARIYA_DATA_DIR: dataDir,
    AKARIYA_LOG_LEVEL: "silent"
  }
});

let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

async function stop() {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  await rm(dataDir, { recursive: true, force: true });
}

try {
  let ready = false;
  while (performance.now() - startedAt < STARTUP_BUDGET_MS) {
    try {
      const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const startupMs = performance.now() - startedAt;
  if (!ready) throw new Error("Server did not become ready within performance budget.\n" + stderr);
  enforceBudget("Startup", startupMs, STARTUP_BUDGET_MS);

  const healthLatencies = [];
  for (let index = 0; index < 25; index += 1) {
    const { response, elapsed } = await timedFetch(base + "/api/health");
    if (!response.ok) throw new Error("Health request failed during performance budget");
    await response.arrayBuffer();
    healthLatencies.push(elapsed);
  }
  const healthP95 = percentile(healthLatencies, 0.95);
  enforceBudget("Health p95", healthP95, HEALTH_P95_BUDGET_MS);

  const indexHtml = await readFile("apps/web/dist/index.html", "utf8");
  const entryMatch = indexHtml.match(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/iu);
  const entryPath = entryMatch?.[1];
  if (!entryPath) throw new Error("Could not locate initial web entry asset");

  const indexLatencies = [];
  let indexEtag = "";
  for (let index = 0; index < 20; index += 1) {
    const { response, elapsed } = await timedFetch(base + "/", {
      headers: { "accept-encoding": "identity" }
    });
    if (!response.ok) throw new Error("Web index request failed");
    if (response.headers.get("cache-control") !== "no-cache") throw new Error("Web index must use no-cache");
    indexEtag ||= response.headers.get("etag") ?? "";
    await response.arrayBuffer();
    indexLatencies.push(elapsed);
  }
  if (!indexEtag) throw new Error("Web index did not provide ETag");
  const indexP95 = percentile(indexLatencies, 0.95);
  enforceBudget("Web index p95", indexP95, WEB_INDEX_P95_BUDGET_MS);

  const revalidateLatencies = [];
  for (let index = 0; index < 20; index += 1) {
    const { response, elapsed } = await timedFetch(base + "/", {
      headers: {
        "accept-encoding": "identity",
        "if-none-match": indexEtag
      }
    });
    if (response.status !== 304) throw new Error("Web index ETag did not return 304");
    revalidateLatencies.push(elapsed);
  }
  const revalidateP95 = percentile(revalidateLatencies, 0.95);
  enforceBudget("Web revalidation p95", revalidateP95, WEB_REVALIDATE_P95_BUDGET_MS);

  const assetLatencies = [];
  for (let index = 0; index < 20; index += 1) {
    const { response, elapsed } = await timedFetch(base + entryPath, {
      headers: { "accept-encoding": "br" }
    });
    if (!response.ok) throw new Error("Initial web asset request failed");
    if (response.headers.get("content-encoding") !== "br") throw new Error("Initial web asset was not served as Brotli");
    if (response.headers.get("cache-control") !== "public, max-age=31536000, immutable") {
      throw new Error("Hashed web asset is not immutable");
    }
    await response.arrayBuffer();
    assetLatencies.push(elapsed);
  }
  const assetP95 = percentile(assetLatencies, 0.95);
  enforceBudget("Web asset p95", assetP95, WEB_ASSET_P95_BUDGET_MS);

  const metricsResponse = await fetch(base + "/api/performance", { signal: AbortSignal.timeout(1_000) });
  if (!metricsResponse.ok) throw new Error("Performance endpoint failed");
  const metrics = await metricsResponse.json();
  const rssBytes = Number(metrics?.memory?.rssBytes ?? Number.NaN);
  if (!Number.isFinite(rssBytes) || rssBytes > RSS_BUDGET_BYTES) {
    throw new Error("RSS budget exceeded: " + String(rssBytes));
  }

  console.log(JSON.stringify({
    startupMs: Math.round(startupMs),
    healthP95Ms: Number(healthP95.toFixed(2)),
    webIndexP95Ms: Number(indexP95.toFixed(2)),
    webRevalidateP95Ms: Number(revalidateP95.toFixed(2)),
    webAssetP95Ms: Number(assetP95.toFixed(2)),
    rssMiB: Number((rssBytes / 1024 / 1024).toFixed(2)),
    budgets: {
      startupMs: STARTUP_BUDGET_MS,
      healthP95Ms: HEALTH_P95_BUDGET_MS,
      webIndexP95Ms: WEB_INDEX_P95_BUDGET_MS,
      webRevalidateP95Ms: WEB_REVALIDATE_P95_BUDGET_MS,
      webAssetP95Ms: WEB_ASSET_P95_BUDGET_MS,
      rssMiB: RSS_BUDGET_BYTES / 1024 / 1024
    }
  }, null, 2));
} finally {
  await stop();
}
