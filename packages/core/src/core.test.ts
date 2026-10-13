import { describe, expect, it } from "vitest";
import type { Clock, LogEntry, RequestContext, RequestContextScope } from "./index.js";
import { EventBus, Kernel, LifecycleAdapter, Logger, err, ok } from "./index.js";

describe("core primitives", () => {
  it("represents success and failure explicitly", () => {
    expect(ok(2)).toEqual({ ok: true, value: 2 });
    expect(err("x")).toEqual({ ok: false, error: "x" });
  });

  it("isolates throwing event handlers", async () => {
    const failures: unknown[] = [];
    const bus = new EventBus<{ tick: number }>((_event, error) => failures.push(error));
    let observed = 0;
    bus.on("tick", () => { throw new Error("boom"); });
    bus.on("tick", (value) => { observed = value; });
    await bus.emit("tick", 7);
    expect(observed).toBe(7);
    expect(failures).toHaveLength(1);
  });

  it("starts dependencies first and stops in reverse", async () => {
    const calls: string[] = [];
    class Service extends LifecycleAdapter {
      constructor(private readonly name: string) { super(); }
      async start(): Promise<void> { calls.push("start:" + this.name); }
      async stop(): Promise<void> { calls.push("stop:" + this.name); }
    }
    const kernel = new Kernel();
    kernel.register({ name: "db", service: new Service("db") });
    kernel.register({ name: "api", dependencies: ["db"], service: new Service("api") });
    await kernel.start();
    await kernel.stop();
    expect(calls).toEqual(["start:db", "start:api", "stop:api", "stop:db"]);
  });

  it("uses injected clock and active correlation id in log entries", () => {
    const entries: LogEntry[] = [];
    const clock: Clock = {
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      nowMs: () => Date.parse("2026-01-02T03:04:05.000Z")
    };
    let active: RequestContext | undefined;
    const scope: RequestContextScope = {
      current: () => active,
      require: () => {
        if (active === undefined) throw new Error("missing context");
        return active;
      },
      run: <T>(context: RequestContext, operation: () => T): T => {
        const previous = active;
        active = context;
        try { return operation(); }
        finally { active = previous; }
      }
    };
    const logger = new Logger("test", "debug", [(entry) => entries.push(entry)], (value) => value, clock, scope);
    scope.run({ correlationId: "corr-logger12", actor: "test" }, () => logger.info("hello"));
    expect(entries).toEqual([{
      level: "info",
      scope: "test",
      message: "hello",
      timestamp: "2026-01-02T03:04:05.000Z",
      correlationId: "corr-logger12"
    }]);
  });
});
