import { describe, expect, it } from "vitest";
import { RequestCache } from "../api/request-cache.js";
import { FrameBatcher } from "./frame-batcher.js";
import { TextStreamBatcher } from "./text-stream-batcher.js";
import { computeVirtualWindow } from "./virtual-window.js";

describe("web runtime performance primitives", () => {
  it("coalesces repeated state changes into one frame", () => {
    const values: number[] = [];
    let callback: FrameRequestCallback | undefined;
    const batcher = new FrameBatcher(
      (value: number) => values.push(value),
      (next) => { callback = next; return 1; },
      () => {}
    );

    batcher.push(1);
    batcher.push(2);
    batcher.push(3);
    expect(values).toEqual([]);

    callback?.(0);
    expect(values).toEqual([3]);
  });

  it("coalesces streamed text chunks into one render per frame", () => {
    const chunks: string[] = [];
    let callback: FrameRequestCallback | undefined;
    const batcher = new TextStreamBatcher(
      (chunk) => chunks.push(chunk),
      (next) => { callback = next; return 1; },
      () => {}
    );

    batcher.push("A");
    batcher.push("kari");
    batcher.push("ya");
    expect(chunks).toEqual([]);

    callback?.(0);
    expect(chunks).toEqual(["Akariya"]);
  });

  it("computes a bounded virtual window instead of rendering every item", () => {
    expect(computeVirtualWindow({
      itemCount: 10_000,
      itemHeight: 40,
      viewportHeight: 400,
      scrollTop: 4_000,
      overscan: 2
    })).toEqual({
      start: 98,
      end: 112,
      offsetTop: 3_920,
      totalHeight: 400_000
    });
  });

  it("deduplicates concurrent read requests and reuses a short cache", async () => {
    const cache = new RequestCache();
    let loads = 0;
    let resolveLoader!: (value: number) => void;
    const loader = () => {
      loads += 1;
      return new Promise<number>((resolve) => { resolveLoader = resolve; });
    };

    const first = cache.get("health", 1_000, loader);
    const second = cache.get("health", 1_000, loader);
    expect(loads).toBe(1);

    resolveLoader(7);
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);
    await expect(cache.get("health", 1_000, async () => 9)).resolves.toBe(7);
    expect(loads).toBe(1);
  });
});
