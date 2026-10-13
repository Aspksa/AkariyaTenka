import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Logger, Kernel, LifecycleAdapter } from "@akariya/core";
import { AsyncLocalRequestContextScope } from "./adapters/request-context-scope.js";
import { createHttpApplication } from "./bootstrap/server.js";
import { HealthService } from "./services/health-service.js";
import { createHealthRoute } from "./routes/health.js";

const servers: Array<ReturnType<typeof createHttpApplication>> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

async function webFixture(): Promise<string> {
  const webDist = await mkdtemp(path.join(os.tmpdir(), "akariya-web-"));
  await mkdir(webDist, { recursive: true });
  await writeFile(path.join(webDist, "index.html"), "ok", "utf8");
  return webDist;
}

function config(webDist: string) {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir: webDist,
    webDist,
    logLevel: "silent" as const,
    supervised: false,
    idempotencyTtlMs: 60_000,
    idempotencyMaxEntries: 100,
    auditMaxBytes: 1_000_000,
    auditMaxArchives: 2,
    shutdownTimeoutMs: 1_000
  };
}

async function listen(server: ReturnType<typeof createHttpApplication>): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return address.port;
}

describe("HTTP skeleton", () => {
  it("serves a validated health response", async () => {
    const webDist = await webFixture();
    class Healthy extends LifecycleAdapter {
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    const kernel = new Kernel();
    kernel.register({ name: "runtime", service: new Healthy() });
    await kernel.start();
    const health = new HealthService(kernel);
    const server = createHttpApplication(
      config(webDist),
      { health: createHealthRoute(health) },
      new Logger("test", "silent")
    );
    const port = await listen(server);
    const response = await fetch("http://127.0.0.1:" + port + "/api/health");
    const body = await response.json() as { status?: string };
    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    await kernel.stop();
  });

  it("allows only the supervised launcher token to request shutdown", async () => {
    const webDist = await webFixture();
    let shutdowns = 0;
    const server = createHttpApplication(
      {
        ...config(webDist),
        supervised: true,
        supervisorToken: "0123456789abcdef0123456789abcdef"
      },
      {
        health: async () => "{}",
        supervisorShutdown: async () => { shutdowns += 1; }
      },
      new Logger("test", "silent")
    );
    const port = await listen(server);

    const denied = await fetch("http://127.0.0.1:" + port + "/api/_supervisor/shutdown", { method: "POST" });
    expect(denied.status).toBe(403);
    expect(shutdowns).toBe(0);

    const accepted = await fetch("http://127.0.0.1:" + port + "/api/_supervisor/shutdown", {
      method: "POST",
      headers: { authorization: "Bearer 0123456789abcdef0123456789abcdef" }
    });
    expect(accepted.status).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    expect(shutdowns).toBe(1);
  });

  it("serves local performance metrics without secrets", async () => {
    const webDist = await webFixture();
    const server = createHttpApplication(
      config(webDist),
      {
        health: async () => "{}",
        performance: async (context) => JSON.stringify({
          timestamp: "2026-10-14T00:00:00.000Z",
          correlationId: context.correlationId,
          uptimeMs: 1,
          memory: { rssBytes: 1, heapUsedBytes: 1, heapTotalBytes: 1 },
          eventLoop: { meanMs: 0, p95Ms: 0, maxMs: 0 },
          metrics: {}
        })
      },
      new Logger("test", "silent")
    );
    const port = await listen(server);
    const response = await fetch("http://127.0.0.1:" + port + "/api/performance", {
      headers: { "x-correlation-id": "corr-performance-1234" }
    });
    const body = await response.json() as { correlationId?: string; memory?: { rssBytes?: number } };
    expect(response.status).toBe(200);
    expect(body.correlationId).toBe("corr-performance-1234");
    expect(body.memory?.rssBytes).toBe(1);
  });

  it("reports recoverable storage failures as degraded health", async () => {
    const webDist = await webFixture();
    class Healthy extends LifecycleAdapter {
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    const kernel = new Kernel();
    kernel.register({ name: "runtime", service: new Healthy() });
    await kernel.start();
    const health = new HealthService(kernel, undefined, {
      "storage.audit": async () => ({ state: "degraded", recoverable: true, lastError: "disk unavailable" })
    });
    const server = createHttpApplication(
      config(webDist),
      { health: createHealthRoute(health) },
      new Logger("test", "silent")
    );
    const port = await listen(server);
    const response = await fetch("http://127.0.0.1:" + port + "/api/health");
    const body = await response.json() as {
      status?: string;
      modules?: Record<string, { state?: string; lastError?: string }>;
    };
    expect(body.status).toBe("degraded");
    expect(body.modules?.["storage.audit"]).toMatchObject({
      state: "degraded",
      lastError: "disk unavailable"
    });
    await kernel.stop();
  });

  it("propagates correlation and idempotency context through AsyncLocalStorage", async () => {
    const webDist = await webFixture();
    const scope = new AsyncLocalRequestContextScope();
    let observed: unknown;
    const server = createHttpApplication(
      config(webDist),
      {
        health: async (context) => {
          observed = { context, current: scope.require() };
          return "{}";
        }
      },
      new Logger("test", "silent"),
      scope
    );
    const port = await listen(server);
    const response = await fetch("http://127.0.0.1:" + port + "/api/health", {
      headers: {
        "x-correlation-id": "corr-context-1234",
        "idempotency-key": "request-12345678"
      }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("corr-context-1234");
    expect(observed).toEqual({
      context: { correlationId: "corr-context-1234", actor: "local-user", idempotencyKey: "request-12345678" },
      current: { correlationId: "corr-context-1234", actor: "local-user", idempotencyKey: "request-12345678" }
    });
  });

  it("rejects malformed idempotency keys at the HTTP boundary", async () => {
    const webDist = await webFixture();
    const server = createHttpApplication(
      config(webDist),
      { health: async () => "{}" },
      new Logger("test", "silent")
    );
    const port = await listen(server);
    const response = await fetch("http://127.0.0.1:" + port + "/api/health", {
      headers: { "idempotency-key": "bad key" }
    });
    const body = await response.json() as { error?: { code?: string } };
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION");
  });
});
