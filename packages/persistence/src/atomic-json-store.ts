import { mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";

export type StoreRead<T> =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "degraded"; readonly quarantinePath: string; readonly error: Error };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class AtomicJsonStore<T> {
  constructor(readonly filePath: string, private readonly schema: ZodType<T>) {}

  async read(): Promise<StoreRead<T>> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(text);
      return { status: "ok", value: this.schema.parse(parsed) };
    } catch (error) {
      const quarantinePath = await this.quarantine();
      return { status: "degraded", quarantinePath, error: asError(error) };
    }
  }

  async write(value: T): Promise<void> {
    const safe = this.schema.parse(value);
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, "." + path.basename(this.filePath) + "." + process.pid + "." + crypto.randomUUID() + ".tmp");
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(safe, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.filePath);
    await this.syncDirectory(directory);
  }

  private async quarantine(): Promise<string> {
    const target = this.filePath + ".corrupt-" + Date.now() + "-" + crypto.randomUUID();
    await rename(this.filePath, target);
    return target;
  }

  private async syncDirectory(directory: string): Promise<void> {
    try {
      const normalized = await realpath(directory);
      const handle = await open(normalized, "r");
      try { await handle.sync(); } finally { await handle.close(); }
    } catch {
      // Directory fsync is not supported by every target filesystem.
    }
  }
}
