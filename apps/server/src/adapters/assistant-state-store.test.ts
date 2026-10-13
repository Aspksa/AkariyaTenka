import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  JsonAssistantStateStore,
  SqliteAssistantStateStore,
  type AssistantStateStore
} from "./assistant-state-store.js";

async function exercise(store: AssistantStateStore): Promise<void> {
  await store.createSession({
    id: "session-test-0001",
    createdAt: "2026-10-14T01:00:00.000Z",
    updatedAt: "2026-10-14T01:00:00.000Z",
    version: 1
  });
  await store.appendMessage({
    id: "message-test-0001",
    sessionId: "session-test-0001",
    turnId: "turn-test-0001",
    role: "user",
    content: "remember stable runtime",
    createdAt: "2026-10-14T01:00:01.000Z",
    correlationId: "corr-store-0001"
  });
  await store.put({
    id: "memory-test-0001",
    scope: "assistant",
    text: "Stable runtime uses bounded assistant loops.",
    source: { kind: "user", reference: "turn-test-0001" },
    tags: ["runtime", "stability"],
    createdAt: "2026-10-14T01:00:02.000Z",
    updatedAt: "2026-10-14T01:00:02.000Z"
  });

  expect(await store.getSession("session-test-0001")).toMatchObject({ version: 2 });
  expect(await store.listTurnMessages("session-test-0001", "turn-test-0001")).toHaveLength(1);
  expect(await store.search({
    scope: "assistant",
    query: "stable runtime",
    limit: 5
  })).toMatchObject([{ id: "memory-test-0001" }]);
  expect(await store.health()).toMatchObject({ state: "started" });
  await store.flush();
}

describe("assistant state persistence", () => {
  it("persists conversations and memory with atomic JSON fallback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-assistant-json-"));
    const file = path.join(root, "assistant-state.json");
    const first = new JsonAssistantStateStore(file);
    await exercise(first);
    await first.close();

    const reopened = new JsonAssistantStateStore(file);
    expect(await reopened.listMessages("session-test-0001")).toMatchObject([
      { id: "message-test-0001", content: "remember stable runtime" }
    ]);
    expect(await reopened.get("memory-test-0001")).toMatchObject({
      text: "Stable runtime uses bounded assistant loops."
    });
    await reopened.close();
  });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const sqliteIt = nodeMajor >= 22 ? it : it.skip;

  sqliteIt("persists conversations and memory in SQLite WAL", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-assistant-sqlite-"));
    const file = path.join(root, "assistant.sqlite");
    const first = await SqliteAssistantStateStore.open(file);
    await exercise(first);
    expect(first.backend).toBe("sqlite-wal");
    await first.close();

    const reopened = await SqliteAssistantStateStore.open(file);
    expect(await reopened.listMessages("session-test-0001")).toMatchObject([
      { id: "message-test-0001", content: "remember stable runtime" }
    ]);
    expect(await reopened.get("memory-test-0001")).toMatchObject({
      text: "Stable runtime uses bounded assistant loops."
    });
    expect(await reopened.health()).toMatchObject({ state: "started" });
    await reopened.close();
  });
});
