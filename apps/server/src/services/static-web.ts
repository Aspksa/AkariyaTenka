import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { AppError } from "@akariya/core";

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

interface Representation {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly encoding?: "br" | "gzip";
}

interface Asset {
  readonly contentType: string;
  readonly immutable: boolean;
  readonly original: Representation;
  readonly br?: Representation;
  readonly gzip?: Representation;
}

function accepted(header: string | undefined, encoding: "br" | "gzip"): boolean {
  if (!header) return false;
  for (const raw of header.split(",")) {
    const [name, ...parameters] = raw.trim().toLowerCase().split(";");
    if (name !== encoding && name !== "*") continue;
    const q = parameters
      .map((part) => part.trim())
      .find((part) => part.startsWith("q="));
    if (q === undefined) return true;
    const weight = Number(q.slice(2));
    return Number.isFinite(weight) && weight > 0;
  }
  return false;
}

function etag(representation: Representation): string {
  const stamp = Math.trunc(representation.mtimeMs).toString(16);
  const encoding = representation.encoding ?? "identity";
  return `W/"${representation.size.toString(16)}-${stamp}-${encoding}"`;
}

function matchesEtag(header: string | undefined, value: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === value;
  });
}

async function regularRepresentation(
  filePath: string,
  encoding?: "br" | "gzip"
): Promise<Representation | undefined> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    return {
      path: filePath,
      size: info.size,
      mtimeMs: info.mtimeMs,
      ...(encoding === undefined ? {} : { encoding })
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export class StaticWebServer {
  private readonly root: string;
  private rootRealPath: Promise<string> | undefined;
  private readonly assets = new Map<string, Promise<Asset | null>>();

  constructor(webDist: string) {
    this.root = path.resolve(webDist);
  }

  async serve(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new AppError({ code: "NOT_FOUND", message: "Not found" });
    }

    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const direct = this.safePath(requested);
    let asset = await this.assetFor(direct, requested);

    if (asset === null && requested !== "index.html") {
      const fallback = this.safePath("index.html");
      asset = await this.assetFor(fallback, "index.html");
    }
    if (asset === null) throw new AppError({ code: "NOT_FOUND", message: "Web build not found" });

    const acceptEncoding = Array.isArray(request.headers["accept-encoding"])
      ? request.headers["accept-encoding"][0]
      : request.headers["accept-encoding"];
    const representation =
      (asset.br && accepted(acceptEncoding, "br") ? asset.br : undefined)
      ?? (asset.gzip && accepted(acceptEncoding, "gzip") ? asset.gzip : undefined)
      ?? asset.original;

    const value = etag(representation);
    const headers: Record<string, string | number> = {
      "cache-control": asset.immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "content-type": asset.contentType,
      "etag": value,
      "last-modified": new Date(representation.mtimeMs).toUTCString(),
      "vary": "Accept-Encoding",
      "x-content-type-options": "nosniff"
    };
    if (representation.encoding !== undefined) headers["content-encoding"] = representation.encoding;

    if (matchesEtag(request.headers["if-none-match"], value)) {
      response.writeHead(304, headers);
      response.end();
      return;
    }

    headers["content-length"] = representation.size;
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(representation.path);
      stream.once("error", reject);
      response.once("finish", resolve);
      response.once("close", resolve);
      stream.pipe(response);
    });
  }

  private safePath(relative: string): string {
    const candidate = path.resolve(this.root, relative);
    if (candidate !== this.root && !candidate.startsWith(this.root + path.sep)) {
      throw new AppError({ code: "NOT_FOUND", message: "Not found" });
    }
    return candidate;
  }

  private assetFor(filePath: string, relative: string): Promise<Asset | null> {
    const key = filePath;
    const cached = this.assets.get(key);
    if (cached !== undefined) return cached;

    const pending = this.loadAsset(filePath, relative).catch((error) => {
      this.assets.delete(key);
      throw error;
    });
    this.assets.set(key, pending);
    return pending;
  }

  private async loadAsset(filePath: string, relative: string): Promise<Asset | null> {
    const original = await regularRepresentation(filePath);
    if (original === undefined) return null;

    const root = await this.realRoot();
    const actual = await realpath(filePath);
    if (actual !== root && !actual.startsWith(root + path.sep)) {
      throw new AppError({ code: "NOT_FOUND", message: "Not found" });
    }

    const [br, gzip] = await Promise.all([
      regularRepresentation(filePath + ".br", "br"),
      regularRepresentation(filePath + ".gz", "gzip")
    ]);

    const normalized = relative.split(path.sep).join("/");
    return {
      contentType: contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      immutable: /^assets\/.+/u.test(normalized),
      original,
      ...(br === undefined ? {} : { br }),
      ...(gzip === undefined ? {} : { gzip })
    };
  }

  private realRoot(): Promise<string> {
    this.rootRealPath ??= realpath(this.root);
    return this.rootRealPath;
  }
}
