import { z } from "zod";
import type { Clock } from "@akariya/core";
import type { MemoryStore } from "./memory.js";
import { ToolRegistry } from "./tools.js";

export interface ReadOnlyToolDependencies {
  readonly clock: Clock;
  readonly memory: MemoryStore;
}

export function registerReadOnlyTools(
  registry: ToolRegistry,
  dependencies: ReadOnlyToolDependencies
): readonly (() => void)[] {
  const unregister: Array<() => void> = [];

  unregister.push(registry.register({
    name: "system.time",
    description: "Read the current Akariya runtime clock in ISO-8601 format.",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ now: z.string().datetime() }).strict(),
    capabilities: ["read_local"],
    risk: "read",
    execute: async () => ({ now: dependencies.clock.now().toISOString() })
  }));

  unregister.push(registry.register({
    name: "system.runtime",
    description: "Read non-sensitive runtime platform and Node.js version information.",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({
      platform: z.string().min(1).max(32),
      arch: z.string().min(1).max(32),
      node: z.string().min(1).max(64)
    }).strict(),
    capabilities: ["read_local"],
    risk: "read",
    execute: async () => ({
      platform: process.platform,
      arch: process.arch,
      node: process.version
    })
  }));

  unregister.push(registry.register({
    name: "memory.search",
    description: "Search explicit Akariya memory records in the assistant scope. This tool is read-only.",
    inputSchema: z.object({
      query: z.string().min(1).max(2_000),
      limit: z.number().int().min(1).max(10).default(5)
    }).strict(),
    outputSchema: z.array(z.object({
      id: z.string(),
      text: z.string(),
      sourceKind: z.enum(["user", "assistant", "tool", "import"]),
      updatedAt: z.string().datetime(),
      tags: z.array(z.string())
    }).strict()).max(10),
    capabilities: ["read_local"],
    risk: "read",
    execute: async (input) => {
      const records = await dependencies.memory.search({
        scope: "assistant",
        query: input.query,
        limit: input.limit
      });
      return records.map((record) => ({
        id: record.id,
        text: record.text,
        sourceKind: record.source.kind,
        updatedAt: record.updatedAt,
        tags: record.tags
      }));
    }
  }));

  return unregister;
}
