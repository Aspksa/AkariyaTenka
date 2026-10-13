import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@akariya/core";
import { ShutdownController } from "./shutdown-controller.js";

describe("ShutdownController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("forces a non-zero exit when cleanup exceeds the timeout", async () => {
    vi.useFakeTimers();
    let forced = -1;
    const controller = new ShutdownController(
      new Logger("test", "silent"),
      50,
      {
        closeHttp: () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
        stopRuntime: async () => {},
        flushPersistence: async () => {}
      },
      {
        setExitCode: () => {},
        forceExit: (code) => { forced = code; }
      }
    );

    const pending = controller.shutdown(0, "SIGTERM");
    await vi.advanceTimersByTimeAsync(50);
    expect(forced).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual({ code: 0, failures: [] });
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
