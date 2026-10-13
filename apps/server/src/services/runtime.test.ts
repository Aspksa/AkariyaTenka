import { createServer, type RequestListener } from "node:http";
import type { RequestContext, RequestContextScope } from "@akariya/core";
import { describe, expect, it } from "vitest";
import { NetworkClient } from "./network-client.js";
import { Scheduler } from "./scheduler.js";

async function httpFixture(handler: RequestListener): Promise<{
  readonly url: URL;
  close(): Promise<void>;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return {
    url: new URL("http://127.0.0.1:" + address.port + "/"),
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function fixedScope(context: RequestContext): RequestContextScope {
  return {
    current: () => context,
    require: () => context,
    run: <T>(_context: RequestContext, operation: () => T): T => operation()
  };
}

describe("NetworkClient", () => {
  it("enforces maxResponseBytes for chunked responses without Content-Length", async () => {
    const fixture = await httpFixture((_request, response) => {
      response.write("abc");
      response.end("def");
    });
    try {
      await expect(new NetworkClient().fetch(fixture.url, {}, { maxResponseBytes: 5, retries: 0 }))
        .rejects.toMatchObject({ code: "EXTERNAL_SERVICE" });
    } finally {
      await fixture.close();
    }
  });

  it("propagates correlation without leaking idempotency identity outbound", async () => {
    let observedCorrelation: string | undefined;
    let observedIdempotency: string | undefined;
    const fixture = await httpFixture((request, response) => {
      observedCorrelation = request.headers["x-correlation-id"] as string | undefined;
      observedIdempotency = request.headers["idempotency-key"] as string | undefined;
      response.end("ok");
    });
    const scope = fixedScope({
      correlationId: "corr-network-1234",
      actor: "local-user",
      idempotencyKey: "request-network1"
    });
    try {
      const response = await new NetworkClient(scope).fetch(fixture.url, {}, { retries: 0 });
      expect(await response.text()).toBe("ok");
      expect(observedCorrelation).toBe("corr-network-1234");
      expect(observedIdempotency).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  it("returns a replayable buffered response when within the byte limit", async () => {
    const fixture = await httpFixture((_request, response) => {
      response.write("ab");
      response.end("cd");
    });
    try {
      const response = await new NetworkClient().fetch(fixture.url, {}, { maxResponseBytes: 4, retries: 0 });
      expect(await response.text()).toBe("abcd");
    } finally {
      await fixture.close();
    }
  });

  it("streams bounded responses without buffering the full body", async () => {
    const fixture = await httpFixture((_request, response) => {
      response.write("ab");
      setTimeout(() => response.end("cd"), 10);
    });
    try {
      const response = await new NetworkClient().fetchStream(
        fixture.url,
        {},
        { maxResponseBytes: 4, retries: 0, streamIdleTimeoutMs: 1000 }
      );
      expect(await response.text()).toBe("abcd");
    } finally {
      await fixture.close();
    }
  });

  it("enforces the byte limit while consuming a stream", async () => {
    const fixture = await httpFixture((_request, response) => {
      response.write("abc");
      response.end("def");
    });
    try {
      const response = await new NetworkClient().fetchStream(
        fixture.url,
        {},
        { maxResponseBytes: 5, retries: 0, streamIdleTimeoutMs: 1000 }
      );
      await expect(response.text()).rejects.toMatchObject({ code: "EXTERNAL_SERVICE" });
    } finally {
      await fixture.close();
    }
  });

  it("normalizes final HTTP 429 and preserves the active correlation id", async () => {
    const fixture = await httpFixture((_request, response) => {
      response.writeHead(429, { "retry-after": "2" });
      response.end("slow down");
    });
    const scope = fixedScope({ correlationId: "corr-rate-12345", actor: "local-user" });
    try {
      await expect(new NetworkClient(scope).fetch(fixture.url, {}, { retries: 0 }))
        .rejects.toMatchObject({
          code: "RATE_LIMIT",
          correlationId: "corr-rate-12345",
          details: { retryAfter: "2" }
        });
    } finally {
      await fixture.close();
    }
  });

  it("normalizes final HTTP 5xx as an external service failure", async () => {
    const fixture = await httpFixture((_request, response) => {
      response.writeHead(503);
      response.end("unavailable");
    });
    try {
      await expect(new NetworkClient().fetch(fixture.url, {}, { retries: 0 }))
        .rejects.toMatchObject({ code: "EXTERNAL_SERVICE" });
    } finally {
      await fixture.close();
    }
  });
});

describe("Scheduler", () => {
  it("uses the injected Clock for health diagnostics", async () => {
    const fixed = new Date("2026-10-14T01:02:03.000Z");
    const clock = { now: () => new Date(fixed), nowMs: () => fixed.getTime() };
    const scheduler = new Scheduler(clock);
    let markRun!: () => void;
    const ran = new Promise<void>((resolve) => { markRun = resolve; });
    scheduler.register({
      name: "clock-test",
      intervalMs: 1,
      run: async () => { markRun(); }
    });
    await scheduler.start();
    await ran;
    await scheduler.stop();
    expect(scheduler.diagnostics()[0]?.lastSuccess).toBe("2026-10-14T01:02:03.000Z");
  });
});
