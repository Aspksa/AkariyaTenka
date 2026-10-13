import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";

export class JsonlStore<T> {
  private queue = Promise.resolve();

  constructor(readonly filePath: string, private readonly schema: ZodType<T>) {}

  append(value: T): Promise<void> {
    const safe = this.schema.parse(value);
    const task = this.queue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const handle = await open(this.filePath, "a", 0o600);
      try {
        await handle.writeFile(JSON.stringify(safe) + "\n", "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  async readAll(): Promise<readonly T[]> {
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
  }

  async flush(): Promise<void> { await this.queue; }
}
