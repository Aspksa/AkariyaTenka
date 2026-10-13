import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class SecurePathResolver {
  constructor(private readonly root: string) {}

  async resolve(relativePath: string): Promise<string> {
    if (!relativePath || relativePath.includes("\0")) throw new Error("Unsafe path");
    const normalizedInput = relativePath.replaceAll("\\", "/");
    if (normalizedInput.startsWith("/") || /^[a-z]:/iu.test(normalizedInput)) throw new Error("Absolute paths are not allowed");
    const segments = normalizedInput.split("/");
    if (segments.some((segment) => segment === ".." || segment === "." || segment.includes(":") || windowsReserved.test(segment.replace(/[. ]+$/u, "")))) {
      throw new Error("Unsafe path segment");
    }

    const rootReal = await realpath(this.root);
    const candidate = path.resolve(rootReal, ...segments);
    if (!inside(rootReal, candidate)) throw new Error("Path escapes root");

    let probe = candidate;
    while (probe !== rootReal) {
      try {
        const stat = await lstat(probe);
        if (stat.isSymbolicLink()) {
          const target = await realpath(probe);
          if (!inside(rootReal, target)) throw new Error("Symlink escapes root");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      probe = path.dirname(probe);
    }
    return candidate;
  }
}
