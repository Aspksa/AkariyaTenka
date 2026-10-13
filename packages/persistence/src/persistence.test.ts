import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  AtomicJsonStore,
  FileIdempotencyStore,
  IdempotencyConflictError,
  JsonlStore,
  VersionedJsonStore,
  idempotencyFingerprint
} from "./index.js";

describe("persistence", () => {
  it("writes and validates JSON atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-store-"));
    const file = path.join(root, "state.json");
    const store = new AtomicJsonStore(file, z.object({ value: z.number() }));
    await store.write({ value: 7 });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ value: 7 });
    expect(await store.read()).toMatchObject({ status: "ok", value: { value: 7 } });
  });

  it("serializes concurrent atomic JSON writes deterministically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-concurrent-"));
    const file = path.join(root, "state.json");
    const store = new AtomicJsonStore(file, z.object({ value: z.number().int() }));
    await Promise.all(Array.from({ length: 40 }, (_, value) => store.write({ value })));
    expect(await store.read()).toMatchObject({ status: "ok", value: { value: 39 } });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ value: 39 });
  });

  it("quarantines corrupt state instead of crashing unrelated startup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-corrupt-"));
    const file = path.join(root, "state.json");
    await writeFile(file, "not-json", "utf8");
    const store = new AtomicJsonStore(file, z.object({ value: z.number() }));
    const result = await store.read();
    expect(result.status).toBe("degraded");
  });

  it("runs explicit sequential migrations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-migrate-"));
    const file = path.join(root, "state.json");
    await writeFile(file, JSON.stringify({ schemaVersion: 1, data: { name: "A" } }), "utf8");
    const store = new VersionedJsonStore(file, 2, z.object({ name: z.string(), active: z.boolean() }), [
      { from: 1, to: 2, migrate: (input) => ({ ...(input as { name: string }), active: true }) }
    ]);
    const result = await store.read();
    expect(result).toMatchObject({ status: "ok", migrated: true, value: { schemaVersion: 2, data: { name: "A", active: true } } });
  });

  it("quarantines state when migration output fails runtime validation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-bad-migrate-"));
    const file = path.join(root, "state.json");
    await writeFile(file, JSON.stringify({ schemaVersion: 1, data: { name: "A" } }), "utf8");
    const store = new VersionedJsonStore(file, 2, z.object({ name: z.string(), active: z.boolean() }), [
      { from: 1, to: 2, migrate: () => ({ name: 42, active: "wrong" }) }
    ]);
    const result = await store.read();
    expect(result.status).toBe("degraded");
    expect((await readdir(root)).some((name) => name.startsWith("state.json.corrupt-"))).toBe(true);
  });

  it("serializes JSONL appends", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-jsonl-"));
    const store = new JsonlStore(path.join(root, "audit.jsonl"), z.object({ id: z.number() }));
    await Promise.all([store.append({ id: 1 }), store.append({ id: 2 }), store.append({ id: 3 })]);
    expect(await store.readAll()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(await store.readRecent(2)).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it("executes a concurrent idempotent side effect once and replays its durable result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-idempotency-"));
    const store = new FileIdempotencyStore(
      path.join(root, "idempotency.json"),
      z.object({ receipt: z.string() })
    );
    const key = "request-12345678";
    const fingerprint = idempotencyFingerprint({ amount: 25, currency: "EUR" });
    let executions = 0;
    const operation = async () => {
      executions += 1;
      await Promise.resolve();
      return { receipt: "r-" + executions };
    };

    const [first, second] = await Promise.all([
      store.executeOnce(key, fingerprint, "2026-10-14T00:00:00.000Z", operation),
      store.executeOnce(key, fingerprint, "2026-10-14T00:00:00.000Z", operation)
    ]);

    expect(executions).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(first.record.value).toEqual(second.record.value);
  });

  it("rejects idempotency-key reuse with different arguments", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-idempotency-conflict-"));
    const store = new FileIdempotencyStore(
      path.join(root, "idempotency.json"),
      z.object({ ok: z.boolean() })
    );
    const key = "request-conflict1";
    await store.executeOnce(
      key,
      idempotencyFingerprint({ value: 1 }),
      "2026-10-14T00:00:00.000Z",
      async () => ({ ok: true })
    );
    await expect(store.executeOnce(
      key,
      idempotencyFingerprint({ value: 2 }),
      "2026-10-14T00:00:01.000Z",
      async () => ({ ok: false })
    )).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("bounds idempotency state by age and entry count", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-idempotency-retention-"));
    let now = Date.parse("2026-10-14T12:00:00.000Z");
    const store = new FileIdempotencyStore(
      path.join(root, "idempotency.json"),
      z.object({ ok: z.boolean() }),
      { ttlMs: 60 * 60 * 1000, maxEntries: 2, nowMs: () => now }
    );

    for (const [key, createdAt] of [
      ["request-retain01", "2026-10-14T11:30:00.000Z"],
      ["request-retain02", "2026-10-14T11:40:00.000Z"],
      ["request-retain03", "2026-10-14T11:50:00.000Z"]
    ] as const) {
      await store.executeOnce(
        key,
        idempotencyFingerprint({ key }),
        createdAt,
        async () => ({ ok: true })
      );
    }

    expect(await store.get("request-retain01")).toBeNull();
    expect((await store.probe()).entries).toBe(2);

    now = Date.parse("2026-10-14T13:00:01.000Z");
    expect(await store.get("request-retain02")).toBeNull();
    expect(await store.get("request-retain03")).toBeNull();
    expect((await store.probe()).entries).toBe(0);
  });

  it("rotates JSONL files without exceeding the archive limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-jsonl-rotate-"));
    const file = path.join(root, "audit.jsonl");
    const store = new JsonlStore(
      file,
      z.object({ id: z.number(), text: z.string() }),
      { maxBytes: 48, maxArchives: 2 }
    );

    for (let id = 1; id <= 6; id += 1) {
      await store.append({ id, text: "xxxxxxxxxxxxxxxx" });
    }

    expect((await readdir(root)).filter((name) => name.startsWith("audit.jsonl")).sort())
      .toEqual(["audit.jsonl", "audit.jsonl.1", "audit.jsonl.2"]);
    expect((await store.probe()).archives).toBe(2);
  });

  it("fails closed when durable idempotency state is corrupt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-idempotency-corrupt-"));
    const file = path.join(root, "idempotency.json");
    await writeFile(file, "not-json", "utf8");
    const store = new FileIdempotencyStore(file, z.object({ ok: z.boolean() }));
    await expect(store.executeOnce(
      "request-corrupt1",
      idempotencyFingerprint({ ok: true }),
      "2026-10-14T00:00:00.000Z",
      async () => ({ ok: true })
    )).rejects.toThrow(/degraded/i);
    expect((await readdir(root)).some((name) => name.startsWith("idempotency.json.corrupt-"))).toBe(true);
  });
});
