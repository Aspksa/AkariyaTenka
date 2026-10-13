import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { AppError, type Logger, type RequestContext, type RequestContextScope } from "@akariya/core";
import { apiErrorSchema, correlationIdSchema, idempotencyKeySchema } from "@akariya/contracts";
import { AsyncLocalRequestContextScope } from "../adapters/request-context-scope.js";
import type { AppConfig } from "./config.js";

export interface HttpRouteSet {
  readonly health: (context: RequestContext) => Promise<string>;
  readonly performance?: (context: RequestContext) => Promise<string>;
  readonly supervisorShutdown?: () => Promise<void>;
}

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function correlationId(request: IncomingMessage): string {
  const value = request.headers["x-correlation-id"];
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && correlationIdSchema.safeParse(candidate).success ? candidate : randomUUID();
}

function idempotencyKey(request: IncomingMessage, correlationIdValue: string): string | undefined {
  const value = request.headers["idempotency-key"];
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AppError({
      code: "VALIDATION",
      message: "Invalid Idempotency-Key header",
      correlationId: correlationIdValue
    });
  }
  return parsed.data;
}


function authorizedSupervisorShutdown(config: AppConfig, request: IncomingMessage): boolean {
  if (!config.supervised || config.supervisorToken === undefined) return false;
  const authorization = request.headers.authorization;
  const expected = "Bearer " + config.supervisorToken;
  if (authorization === undefined) return false;
  const actualBytes = Buffer.from(authorization);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function statusFor(error: AppError): number {
  switch (error.code) {
    case "VALIDATION": return 400;
    case "NOT_FOUND": return 404;
    case "CONFLICT": return 409;
    case "PERMISSION": return 403;
    case "RATE_LIMIT": return 429;
    case "EXTERNAL_SERVICE": return 502;
    case "INTEGRITY": return 500;
    case "INTERNAL": return 500;
  }
}

export function createHttpApplication(
  config: AppConfig,
  routes: HttpRouteSet,
  logger: Logger,
  requestContext: RequestContextScope = new AsyncLocalRequestContextScope()
) {
  return createServer(async (request, response) => {
    const id = correlationId(request);
    const baseContext: RequestContext = { correlationId: id, actor: "local-user" };
    response.setHeader("x-correlation-id", id);

    await requestContext.run(baseContext, async () => {
      try {
        const url = new URL(request.url ?? "/", "http://" + (request.headers.host ?? "localhost"));
        if (request.method === "POST" && url.pathname === "/api/_supervisor/shutdown") {
          if (!authorizedSupervisorShutdown(config, request) || routes.supervisorShutdown === undefined) {
            throw new AppError({ code: "PERMISSION", message: "Supervisor authorization required", correlationId: id });
          }
          response.writeHead(202, { "cache-control": "no-store", "content-length": "0" });
          response.end();
          setImmediate(() => { void routes.supervisorShutdown?.(); });
          return;
        }

        const key = idempotencyKey(request, id);
        const context: RequestContext = key === undefined ? baseContext : { ...baseContext, idempotencyKey: key };

        await requestContext.run(context, async () => {
          if (request.method === "GET" && url.pathname === "/api/health") {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(await routes.health(context));
            return;
          }
          if (request.method === "GET" && url.pathname === "/api/performance" && routes.performance !== undefined) {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(await routes.performance(context));
            return;
          }
          if (url.pathname.startsWith("/api/")) {
            throw new AppError({ code: "NOT_FOUND", message: "API route not found", correlationId: id });
          }
          await serveWeb(config.webDist, url.pathname, response);
        });
      } catch (error) {
        const appError = error instanceof AppError
          ? error
          : new AppError({ code: "INTERNAL", message: "Internal server error", correlationId: id, cause: error });
        logger.error("request failed", {
          correlationId: id,
          code: appError.code,
          cause: appError.cause instanceof Error ? appError.cause.message : appError.cause
        });
        const payload = apiErrorSchema.parse({
          error: {
            code: appError.code,
            message: appError.code === "INTERNAL" ? "Internal server error" : appError.message,
            correlationId: id
          }
        });
        response.writeHead(statusFor(appError), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
      }
    });
  });
}

async function serveWeb(webDist: string, pathname: string, response: ServerResponse): Promise<void> {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const root = path.resolve(webDist);
  const direct = path.resolve(root, requested);
  if (direct !== root && !direct.startsWith(root + path.sep)) throw new AppError({ code: "NOT_FOUND", message: "Not found" });

  let file = direct;
  try {
    if (!(await stat(file)).isFile()) file = path.join(root, "index.html");
  } catch {
    file = path.join(root, "index.html");
  }

  try {
    if (!(await stat(file)).isFile()) throw new Error("missing web build");
  } catch {
    throw new AppError({ code: "NOT_FOUND", message: "Web build not found" });
  }

  response.writeHead(200, { "content-type": contentTypes[path.extname(file)] ?? "application/octet-stream" });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("error", reject);
    response.on("finish", resolve);
    stream.pipe(response);
  });
}
