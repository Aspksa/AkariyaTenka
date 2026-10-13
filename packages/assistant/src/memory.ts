import { z } from "zod";
import type { ComponentHealth } from "@akariya/core";

export const memoryIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/u);
export const memoryScopeSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,96}$/u);

export const memorySourceSchema = z.object({
  kind: z.enum(["user", "assistant", "tool", "import"]),
  reference: z.string().min(1).max(256).optional()
}).strict();

export const memoryRecordSchema = z.object({
  id: memoryIdSchema,
  scope: memoryScopeSchema,
  text: z.string().min(1).max(20_000),
  source: memorySourceSchema,
  tags: z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/u)).max(32).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export interface MemorySearch {
  readonly scope: string;
  readonly query: string;
  readonly limit?: number;
}

export interface MemoryStore {
  put(record: MemoryRecord): Promise<void>;
  get(id: string): Promise<MemoryRecord | null>;
  search(input: MemorySearch): Promise<readonly MemoryRecord[]>;
  listRecent(scope: string, limit?: number): Promise<readonly MemoryRecord[]>;
  flush(): Promise<void>;
  health(): Promise<ComponentHealth>;
}

function searchTokens(query: string): readonly string[] {
  return [...new Set(
    query.toLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  )].slice(0, 8);
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly records = new Map<string, MemoryRecord>();

  async put(record: MemoryRecord): Promise<void> {
    const safe = memoryRecordSchema.parse(record);
    this.records.set(safe.id, safe);
  }

  async get(id: string): Promise<MemoryRecord | null> {
    memoryIdSchema.parse(id);
    return this.records.get(id) ?? null;
  }

  async search(input: MemorySearch): Promise<readonly MemoryRecord[]> {
    const scope = memoryScopeSchema.parse(input.scope);
    const limit = input.limit ?? 8;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new Error("Memory search limit is out of bounds");
    const tokens = searchTokens(input.query);

    return [...this.records.values()]
      .filter((record) => record.scope === scope)
      .map((record) => ({ record, score: memoryMatchScore(record.text, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        right.score - left.score
        || right.record.updatedAt.localeCompare(left.record.updatedAt)
        || left.record.id.localeCompare(right.record.id)
      )
      .slice(0, limit)
      .map((entry) => entry.record);
  }

  async listRecent(scopeValue: string, limit = 20): Promise<readonly MemoryRecord[]> {
    const scope = memoryScopeSchema.parse(scopeValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new Error("Memory list limit is out of bounds");
    return [...this.records.values()]
      .filter((record) => record.scope === scope)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  async flush(): Promise<void> {}

  async health(): Promise<ComponentHealth> {
    return { state: "started", recoverable: true };
  }
}

export function memoryQueryTokens(query: string): readonly string[] {
  return searchTokens(query);
}

export function memoryMatchScore(textValue: string, tokens: readonly string[]): number {
  if (tokens.length === 0) return 1;
  const text = textValue.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (text.includes(token)) score += 1;
  }
  return score;
}
