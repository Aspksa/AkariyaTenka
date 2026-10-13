import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";
import { SerializedQueue } from "./serialized-queue.js";

export class JsonlStore<T> {
  private readonly queue = new SerializedQueue();

  constructor(readonly filePath: string, private readonly schema: ZodType<T>) {}

  append(value: T): Promise<void> {
    const safe = this.schema.parse(value);
    return this.queue.run(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const handle = await open(this.filePath, "a", 0o600);
      try {
        await handle.writeFile(JSON.stringify(safe) + "\n", "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
  }

  readAll(): Promise<readonly T[]> {
    return this.queue.run(async () => {
      let text: string;
      try { text = await readFile(this.filePath, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const output: T[] = [];
      for (const line of text.split(/\r?\n/u)) {
        if (!line) continue;
        const value: unknown = JSON.parse(line);
        output.push(this.schema.parse(value));
      }
      return output;
    });
  }

  async flush(): Promise<void> { await this.queue.idle(); }
}
