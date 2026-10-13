import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Logger, Kernel, LifecycleAdapter } from "@akariya/core";
import { createHttpApplication } from "./bootstrap/server.js";
import { HealthService } from "./services/health-service.js";
import { createHealthRoute } from "./routes/health.js";

const servers: Array<ReturnType<typeof createHttpApplication>> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

describe("HTTP skeleton", () => {
  it("serves a validated health response", async () => {
    const webDist = await mkdtemp(path.join(os.tmpdir(), "akariya-web-"));
    await mkdir(webDist, { recursive: true });
    await writeFile(path.join(webDist, "index.html"), "ok", "utf8");
    class Healthy extends LifecycleAdapter {
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    const kernel = new Kernel();
    kernel.register({ name: "runtime", service: new Healthy() });
    await kernel.start();
    const health = new HealthService(kernel);
    const server = createHttpApplication(
      { host: "127.0.0.1", port: 0, dataDir: webDist, webDist, logLevel: "silent" },
      { health: createHealthRoute(health) },
      new Logger("test", "silent")
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const response = await fetch("http://127.0.0.1:" + address.port + "/api/health");
    const body = await response.json() as { status?: string };
    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    await kernel.stop();
  });
});
