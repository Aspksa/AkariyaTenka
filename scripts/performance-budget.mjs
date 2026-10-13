import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const STARTUP_BUDGET_MS = 5_000;
const HEALTH_P95_BUDGET_MS = 250;
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
  if (startupMs > STARTUP_BUDGET_MS) throw new Error("Startup budget exceeded: " + startupMs.toFixed(1) + " ms");

  const latencies = [];
  for (let index = 0; index < 25; index += 1) {
    const before = performance.now();
    const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) throw new Error("Health request failed during performance budget");
    await response.arrayBuffer();
    latencies.push(performance.now() - before);
  }

  const p95 = percentile(latencies, 0.95);
  if (p95 > HEALTH_P95_BUDGET_MS) {
    throw new Error("Health p95 budget exceeded: " + p95.toFixed(1) + " ms");
  }

  const metricsResponse = await fetch(base + "/api/performance", { signal: AbortSignal.timeout(1_000) });
  if (!metricsResponse.ok) throw new Error("Performance endpoint failed");
  const metrics = await metricsResponse.json();
  const rssBytes = Number(metrics?.memory?.rssBytes ?? Number.NaN);
  if (!Number.isFinite(rssBytes) || rssBytes > RSS_BUDGET_BYTES) {
    throw new Error("RSS budget exceeded: " + String(rssBytes));
  }

  console.log(JSON.stringify({
    startupMs: Math.round(startupMs),
    healthP95Ms: Number(p95.toFixed(2)),
    rssMiB: Number((rssBytes / 1024 / 1024).toFixed(2)),
    budgets: {
      startupMs: STARTUP_BUDGET_MS,
      healthP95Ms: HEALTH_P95_BUDGET_MS,
      rssMiB: RSS_BUDGET_BYTES / 1024 / 1024
    }
  }, null, 2));
} finally {
  await stop();
}
