import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { NetworkClient } from "./network-client.js";
import { Scheduler } from "./scheduler.js";

async function httpFixture(handler: Parameters<typeof createServer>[0]): Promise<{
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

describe("NetworkClient", () => {
  it("enforces maxResponseBytes for chunked responses without Content-Length", async () => {
    const fixture = await httpFixture((_request, response) => {
      response.write("abc");
      response.end("def");
    });
    try {
      const client = new NetworkClient();
      await expect(client.fetch(fixture.url, {}, { maxResponseBytes: 5, retries: 0 }))
        .rejects.toMatchObject({ code: "EXTERNAL_SERVICE" });
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
