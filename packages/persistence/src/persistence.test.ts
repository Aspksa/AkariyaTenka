import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { AtomicJsonStore, JsonlStore, VersionedJsonStore } from "./index.js";

describe("persistence", () => {
  it("writes and validates JSON atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-store-"));
    const file = path.join(root, "state.json");
    const store = new AtomicJsonStore(file, z.object({ value: z.number() }));
    await store.write({ value: 7 });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ value: 7 });
    expect(await store.read()).toMatchObject({ status: "ok", value: { value: 7 } });
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

  it("serializes JSONL appends", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-jsonl-"));
    const store = new JsonlStore(path.join(root, "audit.jsonl"), z.object({ id: z.number() }));
    await Promise.all([store.append({ id: 1 }), store.append({ id: 2 }), store.append({ id: 3 })]);
    expect(await store.readAll()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});
