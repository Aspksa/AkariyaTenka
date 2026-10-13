import path from "node:path";
import { z } from "zod";
import type { ComponentHealth } from "@akariya/core";
import {
  conversationIdSchema,
  conversationMessageSchema,
  conversationSessionSchema,
  memoryIdSchema,
  memoryQueryTokens,
  memoryRecordSchema,
  memoryScopeSchema,
  turnIdSchema,
  type ConversationMessage,
  type ConversationSession,
  type ConversationStore,
  type MemoryRecord,
  type MemorySearch,
  type MemoryStore
} from "@akariya/assistant";
import { AtomicJsonStore, SerializedQueue } from "@akariya/persistence";

export interface AssistantStateStore extends ConversationStore, MemoryStore {
  readonly backend: "json" | "sqlite-wal";
  close(): Promise<void>;
}

const stateSchema = z.object({
  schemaVersion: z.literal(1),
  sessions: z.record(z.string(), conversationSessionSchema),
  messages: z.array(conversationMessageSchema),
  memories: z.record(z.string(), memoryRecordSchema)
}).strict();

type JsonState = z.infer<typeof stateSchema>;

function emptyState(): JsonState {
  return { schemaVersion: 1, sessions: {}, messages: [], memories: {} };
}

function assertLimit(value: number, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(label + " is out of bounds");
  }
}

function memoryMatches(record: MemoryRecord, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const text = record.text.toLowerCase();
  return tokens.every((token) => text.includes(token));
}

export class JsonAssistantStateStore implements AssistantStateStore {
  readonly backend = "json" as const;
  private readonly store: AtomicJsonStore<JsonState>;
  private readonly queue = new SerializedQueue();
  private lastError: string | undefined;

  constructor(filePath: string) {
    this.store = new AtomicJsonStore(filePath, stateSchema);
  }

  async createSession(session: ConversationSession): Promise<void> {
    const safe = conversationSessionSchema.parse(session);
    await this.mutate((state) => {
      if (state.sessions[safe.id] !== undefined) throw new Error("Conversation session already exists");
      return { ...state, sessions: { ...state.sessions, [safe.id]: safe } };
    });
  }

  async getSession(sessionId: string): Promise<ConversationSession | null> {
    conversationIdSchema.parse(sessionId);
    const state = await this.read();
    return state.sessions[sessionId] ?? null;
  }

  async appendMessage(message: ConversationMessage): Promise<void> {
    const safe = conversationMessageSchema.parse(message);
    await this.mutate((state) => {
      const session = state.sessions[safe.sessionId];
      if (session === undefined) throw new Error("Conversation session does not exist");
      if (state.messages.some((entry) => entry.id === safe.id)) throw new Error("Conversation message already exists");

      return {
        ...state,
        sessions: {
          ...state.sessions,
          [safe.sessionId]: {
            ...session,
            updatedAt: safe.createdAt,
            version: session.version + 1
          }
        },
        messages: [...state.messages, safe]
      };
    });
  }

  async listMessages(sessionId: string, limit = 64): Promise<readonly ConversationMessage[]> {
    conversationIdSchema.parse(sessionId);
    assertLimit(limit, 1, 512, "Conversation limit");
    const state = await this.read();
    return state.messages.filter((entry) => entry.sessionId === sessionId).slice(-limit);
  }

  async listTurnMessages(sessionId: string, turnId: string): Promise<readonly ConversationMessage[]> {
    conversationIdSchema.parse(sessionId);
    turnIdSchema.parse(turnId);
    const state = await this.read();
    return state.messages.filter((entry) => entry.sessionId === sessionId && entry.turnId === turnId);
  }

  async put(record: MemoryRecord): Promise<void> {
    const safe = memoryRecordSchema.parse(record);
    await this.mutate((state) => ({
      ...state,
      memories: { ...state.memories, [safe.id]: safe }
    }));
  }

  async get(id: string): Promise<MemoryRecord | null> {
    memoryIdSchema.parse(id);
    const state = await this.read();
    return state.memories[id] ?? null;
  }

  async search(input: MemorySearch): Promise<readonly MemoryRecord[]> {
    const scope = memoryScopeSchema.parse(input.scope);
    const limit = input.limit ?? 8;
    assertLimit(limit, 1, 64, "Memory search limit");
    const tokens = memoryQueryTokens(input.query);
    const state = await this.read();
    return Object.values(state.memories)
      .filter((record) => record.scope === scope && memoryMatches(record, tokens))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  async listRecent(scopeValue: string, limit = 20): Promise<readonly MemoryRecord[]> {
    const scope = memoryScopeSchema.parse(scopeValue);
    assertLimit(limit, 1, 128, "Memory list limit");
    const state = await this.read();
    return Object.values(state.memories)
      .filter((record) => record.scope === scope)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  async flush(): Promise<void> {
    await this.queue.idle();
    await this.store.flush();
  }

  async close(): Promise<void> {
    await this.flush();
  }

  async health(): Promise<ComponentHealth> {
    try {
      await this.read();
      return this.lastError === undefined
        ? { state: "started", recoverable: true }
        : { state: "degraded", recoverable: true, lastError: this.lastError };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      return { state: "degraded", recoverable: true, lastError: message };
    }
  }

  private async read(): Promise<JsonState> {
    const result = await this.store.read();
    if (result.status === "missing") return emptyState();
    if (result.status === "degraded") {
      this.lastError = result.error.message;
      throw result.error;
    }
    this.lastError = undefined;
    return result.value;
  }

  private mutate(operation: (state: JsonState) => JsonState): Promise<void> {
    return this.queue.run(async () => {
      const state = await this.read();
      await this.store.write(stateSchema.parse(operation(state)));
      this.lastError = undefined;
    });
  }
}

type SqlValue = string | number | bigint | Uint8Array | null;
type Row = Readonly<Record<string, SqlValue>>;

interface StatementLike {
  get(...params: readonly SqlValue[]): Row | undefined;
  all(...params: readonly SqlValue[]): Row[];
  run(...params: readonly SqlValue[]): { readonly changes: number | bigint };
}

interface DatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  close(): void;
}

interface SqliteModuleLike {
  readonly DatabaseSync: new (filePath: string) => DatabaseLike;
}

export class SqliteAssistantStateStore implements AssistantStateStore {
  readonly backend = "sqlite-wal" as const;
  private readonly queue = new SerializedQueue();
  private lastError: string | undefined;

  private constructor(private readonly db: DatabaseLike) {}

  static async open(filePath: string): Promise<SqliteAssistantStateStore> {
    const specifier = "node:sqlite";
    const sqlite = await import(specifier) as unknown as SqliteModuleLike;
    const db = new sqlite.DatabaseSync(filePath);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA synchronous=NORMAL;");
    db.exec("PRAGMA busy_timeout=5000;");
    db.exec("PRAGMA foreign_keys=ON;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        tool_call_id TEXT,
        tool_name TEXT,
        tool_calls_json TEXT
      );
      CREATE INDEX IF NOT EXISTS conversation_messages_session_idx
        ON conversation_messages(session_id, rowid);
      CREATE INDEX IF NOT EXISTS conversation_messages_turn_idx
        ON conversation_messages(session_id, turn_id, rowid);
      CREATE TABLE IF NOT EXISTS assistant_memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        text TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_reference TEXT,
        tags_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assistant_memories_scope_updated_idx
        ON assistant_memories(scope, updated_at DESC, id ASC);
    `);
    return new SqliteAssistantStateStore(db);
  }

  createSession(session: ConversationSession): Promise<void> {
    const safe = conversationSessionSchema.parse(session);
    return this.queue.run(async () => {
      this.db.prepare(
        "INSERT INTO conversation_sessions(id, created_at, updated_at, version) VALUES (?, ?, ?, ?)"
      ).run(safe.id, safe.createdAt, safe.updatedAt, safe.version);
      this.lastError = undefined;
    });
  }

  getSession(sessionId: string): Promise<ConversationSession | null> {
    conversationIdSchema.parse(sessionId);
    return this.queue.run(async () => {
      const row = this.db.prepare(
        "SELECT id, created_at, updated_at, version FROM conversation_sessions WHERE id = ?"
      ).get(sessionId);
      return row === undefined ? null : this.sessionFromRow(row);
    });
  }

  appendMessage(message: ConversationMessage): Promise<void> {
    const safe = conversationMessageSchema.parse(message);
    return this.queue.run(async () => {
      this.transaction(() => {
        this.db.prepare(`
          INSERT INTO conversation_messages(
            id, session_id, turn_id, role, content, created_at, correlation_id,
            tool_call_id, tool_name, tool_calls_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          safe.id,
          safe.sessionId,
          safe.turnId,
          safe.role,
          safe.content,
          safe.createdAt,
          safe.correlationId,
          safe.toolCallId ?? null,
          safe.toolName ?? null,
          safe.toolCalls === undefined ? null : JSON.stringify(safe.toolCalls)
        );
        const updated = this.db.prepare(
          "UPDATE conversation_sessions SET updated_at = ?, version = version + 1 WHERE id = ?"
        ).run(safe.createdAt, safe.sessionId);
        if (Number(updated.changes) !== 1) throw new Error("Conversation session does not exist");
      });
      this.lastError = undefined;
    });
  }

  listMessages(sessionId: string, limit = 64): Promise<readonly ConversationMessage[]> {
    conversationIdSchema.parse(sessionId);
    assertLimit(limit, 1, 512, "Conversation limit");
    return this.queue.run(async () => {
      const rows = this.db.prepare(`
        SELECT id, session_id, turn_id, role, content, created_at, correlation_id,
               tool_call_id, tool_name, tool_calls_json
        FROM conversation_messages
        WHERE session_id = ?
        ORDER BY rowid DESC
        LIMIT ?
      `).all(sessionId, limit);
      return rows.reverse().map((row) => this.messageFromRow(row));
    });
  }

  listTurnMessages(sessionId: string, turnId: string): Promise<readonly ConversationMessage[]> {
    conversationIdSchema.parse(sessionId);
    turnIdSchema.parse(turnId);
    return this.queue.run(async () => this.db.prepare(`
      SELECT id, session_id, turn_id, role, content, created_at, correlation_id,
             tool_call_id, tool_name, tool_calls_json
      FROM conversation_messages
      WHERE session_id = ? AND turn_id = ?
      ORDER BY rowid ASC
    `).all(sessionId, turnId).map((row) => this.messageFromRow(row)));
  }

  put(record: MemoryRecord): Promise<void> {
    const safe = memoryRecordSchema.parse(record);
    return this.queue.run(async () => {
      this.db.prepare(`
        INSERT INTO assistant_memories(
          id, scope, text, source_kind, source_reference, tags_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scope = excluded.scope,
          text = excluded.text,
          source_kind = excluded.source_kind,
          source_reference = excluded.source_reference,
          tags_json = excluded.tags_json,
          updated_at = excluded.updated_at
      `).run(
        safe.id,
        safe.scope,
        safe.text,
        safe.source.kind,
        safe.source.reference ?? null,
        JSON.stringify(safe.tags),
        safe.createdAt,
        safe.updatedAt
      );
      this.lastError = undefined;
    });
  }

  get(id: string): Promise<MemoryRecord | null> {
    memoryIdSchema.parse(id);
    return this.queue.run(async () => {
      const row = this.db.prepare(`
        SELECT id, scope, text, source_kind, source_reference, tags_json, created_at, updated_at
        FROM assistant_memories WHERE id = ?
      `).get(id);
      return row === undefined ? null : this.memoryFromRow(row);
    });
  }

  search(input: MemorySearch): Promise<readonly MemoryRecord[]> {
    const scope = memoryScopeSchema.parse(input.scope);
    const limit = input.limit ?? 8;
    assertLimit(limit, 1, 64, "Memory search limit");
    const tokens = memoryQueryTokens(input.query);
    return this.queue.run(async () => {
      const candidates = this.db.prepare(`
        SELECT id, scope, text, source_kind, source_reference, tags_json, created_at, updated_at
        FROM assistant_memories
        WHERE scope = ?
        ORDER BY updated_at DESC, id ASC
        LIMIT 512
      `).all(scope).map((row) => this.memoryFromRow(row));
      return candidates.filter((record) => memoryMatches(record, tokens)).slice(0, limit);
    });
  }

  listRecent(scopeValue: string, limit = 20): Promise<readonly MemoryRecord[]> {
    const scope = memoryScopeSchema.parse(scopeValue);
    assertLimit(limit, 1, 128, "Memory list limit");
    return this.queue.run(async () => this.db.prepare(`
      SELECT id, scope, text, source_kind, source_reference, tags_json, created_at, updated_at
      FROM assistant_memories
      WHERE scope = ?
      ORDER BY updated_at DESC, id ASC
      LIMIT ?
    `).all(scope, limit).map((row) => this.memoryFromRow(row)));
  }

  async flush(): Promise<void> {
    await this.queue.idle();
    await this.queue.run(async () => {
      this.db.exec("PRAGMA wal_checkpoint(PASSIVE);");
    });
  }

  async close(): Promise<void> {
    await this.queue.idle();
    await this.queue.run(async () => {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      this.db.close();
    });
  }

  health(): Promise<ComponentHealth> {
    return this.queue.run(async () => {
      try {
        const mode = this.db.prepare("PRAGMA journal_mode").get();
        const check = this.db.prepare("PRAGMA quick_check").get();
        const journalMode = String(mode?.journal_mode ?? "").toLowerCase();
        const quickCheck = String(check?.quick_check ?? "");
        if (journalMode !== "wal" || quickCheck !== "ok") {
          this.lastError = journalMode !== "wal"
            ? "SQLite journal_mode is not WAL"
            : "SQLite quick_check failed";
          return { state: "degraded", recoverable: true, lastError: this.lastError };
        }
        this.lastError = undefined;
        return { state: "started", recoverable: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        return { state: "degraded", recoverable: true, lastError: message };
      }
    });
  }

  private transaction(operation: () => void): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      operation();
      this.db.exec("COMMIT;");
    } catch (error) {
      try { this.db.exec("ROLLBACK;"); } catch {}
      throw error;
    }
  }

  private sessionFromRow(row: Row): ConversationSession {
    return conversationSessionSchema.parse({
      id: String(row.id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      version: Number(row.version)
    });
  }

  private messageFromRow(row: Row): ConversationMessage {
    const toolCallsRaw = row.tool_calls_json;
    const toolCalls: unknown = toolCallsRaw === null || toolCallsRaw === undefined
      ? undefined
      : JSON.parse(String(toolCallsRaw));
    return conversationMessageSchema.parse({
      id: String(row.id),
      sessionId: String(row.session_id),
      turnId: String(row.turn_id),
      role: String(row.role),
      content: String(row.content),
      createdAt: String(row.created_at),
      correlationId: String(row.correlation_id),
      ...(row.tool_call_id === null || row.tool_call_id === undefined ? {} : { toolCallId: String(row.tool_call_id) }),
      ...(row.tool_name === null || row.tool_name === undefined ? {} : { toolName: String(row.tool_name) }),
      ...(toolCalls === undefined ? {} : { toolCalls })
    });
  }

  private memoryFromRow(row: Row): MemoryRecord {
    return memoryRecordSchema.parse({
      id: String(row.id),
      scope: String(row.scope),
      text: String(row.text),
      source: {
        kind: String(row.source_kind),
        ...(row.source_reference === null || row.source_reference === undefined
          ? {}
          : { reference: String(row.source_reference) })
      },
      tags: JSON.parse(String(row.tags_json)) as unknown,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    });
  }
}

export async function createAssistantStateStore(dataDir: string): Promise<AssistantStateStore> {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isInteger(major) && major >= 22) {
    return await SqliteAssistantStateStore.open(path.join(dataDir, "assistant.sqlite"));
  }
  return new JsonAssistantStateStore(path.join(dataDir, "assistant-state.json"));
}
