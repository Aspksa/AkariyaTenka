import { describe, expect, it } from "vitest";
import { Logger } from "@akariya/core";
import { ShutdownController } from "./shutdown-controller.js";

describe("ShutdownController", () => {
  it("runs cleanup once in deterministic order", async () => {
    const calls: string[] = [];
    const exitCodes: number[] = [];
    const controller = new ShutdownController(
      new Logger("test", "silent"),
      1000,
      {
        closeHttp: async () => { calls.push("http"); },
        stopRuntime: async () => { calls.push("runtime"); },
        flushPersistence: async () => { calls.push("persistence"); }
      },
      {
        setExitCode: (code) => { exitCodes.push(code); },
        forceExit: () => { throw new Error("unexpected force exit"); }
      }
    );

    const [first, second] = await Promise.all([
      controller.shutdown(0, "SIGTERM"),
      controller.shutdown(1, "duplicate")
    ]);

    expect(calls).toEqual(["http", "runtime", "persistence"]);
    expect(first).toEqual({ code: 0, failures: [] });
    expect(second).toEqual(first);
    expect(exitCodes).toEqual([0]);
  });

  it("returns a non-zero exit code when graceful cleanup fails", async () => {
    let exitCode = -1;
    const controller = new ShutdownController(
      new Logger("test", "silent"),
      1000,
      {
        closeHttp: async () => {},
        stopRuntime: async () => { throw new Error("stop failed"); },
        flushPersistence: async () => {}
      },
      {
        setExitCode: (code) => { exitCode = code; },
        forceExit: () => { throw new Error("unexpected force exit"); }
      }
    );

    const result = await controller.shutdown(0, "SIGINT");
    expect(result.code).toBe(1);
    expect(result.failures).toEqual(["runtime: stop failed"]);
    expect(exitCode).toBe(1);
  });
});
