import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ZodType } from "zod";
import { SerializedQueue } from "./serialized-queue.js";

export interface JsonlRotationOptions {
  readonly maxBytes?: number;
  readonly maxArchives?: number;
}

export interface JsonlProbe {
  readonly status: "ok" | "degraded";
  readonly bytes: number;
  readonly archives: number;
  readonly lastError?: string;
}

export class JsonlStore<T> {
  private readonly queue = new SerializedQueue();
  private readonly maxBytes: number | undefined;
  private readonly maxArchives: number;

  constructor(readonly filePath: string, private readonly schema: ZodType<T>, options: JsonlRotationOptions = {}) {
    this.maxBytes = options.maxBytes;
    this.maxArchives = options.maxArchives ?? 0;
    if (this.maxBytes !== undefined && (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1)) {
      throw new Error("JSONL maxBytes must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.maxArchives) || this.maxArchives < 0) {
      throw new Error("JSONL maxArchives must be a non-negative safe integer");
    }
  }

  append(value: T): Promise<void> {
    const safe = this.schema.parse(value);
    const line = JSON.stringify(safe) + "\n";
    const bytes = Buffer.byteLength(line);
    return this.queue.run(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      if (this.maxBytes !== undefined) {
        if (bytes > this.maxBytes) throw new Error("JSONL record exceeds configured maxBytes");
        await this.rotateIfNeeded(bytes);
      }
      const handle = await open(this.filePath, "a", 0o600);
      try {
        await handle.writeFile(line, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
  }

  readAll(): Promise<readonly T[]> {
    return this.queue.run(() => this.readStream());
  }

  readRecent(limit: number): Promise<readonly T[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("JSONL read limit must be a positive safe integer");
    return this.queue.run(() => this.readStream(limit));
  }

  probe(): Promise<JsonlProbe> {
    return this.queue.run(async () => {
      try {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const handle = await open(this.filePath, "a", 0o600);
        await handle.close();
        const bytes = (await stat(this.filePath)).size;
        let archives = 0;
        for (let index = 1; index <= this.maxArchives; index += 1) {
          try {
            await stat(this.archivePath(index));
            archives += 1;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        return { status: "ok", bytes, archives };
      } catch (error) {
        return {
          status: "degraded",
          bytes: 0,
          archives: 0,
          lastError: error instanceof Error ? error.message : String(error)
        };
      }
    });
  }

  async flush(): Promise<void> { await this.queue.idle(); }

  private async readStream(limit?: number): Promise<readonly T[]> {
    const stream = createReadStream(this.filePath, { encoding: "utf8" });
    try {
      await new Promise<void>((resolve, reject) => {
        stream.once("open", () => resolve());
        stream.once("error", reject);
      });
    } catch (error) {
      stream.destroy();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    const output: T[] = [];
    try {
      for await (const line of lines) {
        if (!line) continue;
        const value: unknown = JSON.parse(line);
        const safe = this.schema.parse(value);
        if (limit === undefined) {
          output.push(safe);
        } else {
          if (output.length === limit) output.shift();
          output.push(safe);
        }
      }
      return output;
    } finally {
      lines.close();
      stream.destroy();
    }
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentBytes = 0;
    try { currentBytes = (await stat(this.filePath)).size; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (currentBytes === 0 || currentBytes + incomingBytes <= (this.maxBytes ?? Number.MAX_SAFE_INTEGER)) return;

    if (this.maxArchives === 0) {
      await rm(this.filePath, { force: true });
      return;
    }

    await rm(this.archivePath(this.maxArchives), { force: true });
    for (let index = this.maxArchives - 1; index >= 1; index -= 1) {
      try {
        await rename(this.archivePath(index), this.archivePath(index + 1));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    try {
      await rename(this.filePath, this.archivePath(1));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private archivePath(index: number): string {
    return this.filePath + "." + index;
  }
}
