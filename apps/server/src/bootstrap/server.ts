import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { AppError, type Logger, type RequestContext, type RequestContextScope } from "@akariya/core";
import { apiErrorSchema, correlationIdSchema, idempotencyKeySchema } from "@akariya/contracts";
import { AsyncLocalRequestContextScope } from "../adapters/request-context-scope.js";
import type { AppConfig } from "./config.js";
import { StaticWebServer } from "../services/static-web.js";

export interface HttpRouteSet {
  readonly health: (context: RequestContext) => Promise<string>;
  readonly performance?: (context: RequestContext) => Promise<string>;
  readonly githubUpdates?: () => Promise<string>;
  readonly githubUpdateHistory?: () => Promise<string>;
  readonly rollbackList?: () => Promise<string>;
  readonly rollbackRequest?: (payload: unknown) => Promise<string>;
  readonly githubUpdateRequest?: (payload: unknown) => Promise<string>;
  readonly githubUpdateShutdown?: () => Promise<void>;
  readonly supervisorShutdown?: () => Promise<void>;
}

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
  const staticWeb = new StaticWebServer(config.webDist);
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

        if (request.method === "POST" && (url.pathname === "/api/updates/install" || url.pathname === "/api/updates/rollback")) {
          const host = "127.0.0.1:" + config.port;
          const peer = request.socket.remoteAddress;
          if (!config.supervised || config.host !== "127.0.0.1" ||
              !config.supervisorToken || !routes.githubUpdateRequest || !routes.githubUpdateShutdown ||
              (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") ||
              request.headers.host !== host || request.headers.origin !== "http://" + host ||
              request.headers["x-akariya-action"] !== (url.pathname === "/api/updates/rollback" ? "github-rollback" : "github-install") ||
              request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
            throw new AppError({ code: "PERMISSION", message: "Local update approval required", correlationId: id });
          }
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const part of request) {
            const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
            length += bytes.length;
            if (length > 256) throw new AppError({ code: "VALIDATION", message: "Update request too large", correlationId: id });
            chunks.push(bytes);
          }
          let payload: unknown;
          try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { throw new AppError({ code: "VALIDATION", message: "Invalid JSON", correlationId: id }); }
          const result = url.pathname === "/api/updates/rollback"
            ? await routes.rollbackRequest?.(payload)
            : await routes.githubUpdateRequest(payload);
          if (result === undefined) throw new AppError({code:"PERMISSION",message:"Rollback unavailable",correlationId:id});
          response.writeHead(202, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end(result);
          setImmediate(() => { void routes.githubUpdateShutdown?.(); });
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
          if (request.method === "GET" && url.pathname === "/api/updates/github" && routes.githubUpdates) {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(await routes.githubUpdates());
            return;
          }
          if (request.method === "GET" && url.pathname === "/api/updates/backups" && routes.rollbackList) {
            response.writeHead(200, {"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
            response.end(await routes.rollbackList());
            return;
          }
          if (request.method === "GET" && url.pathname === "/api/updates/history" && routes.githubUpdateHistory) {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(await routes.githubUpdateHistory());
            return;
          }
          if (url.pathname.startsWith("/api/")) {
            throw new AppError({ code: "NOT_FOUND", message: "API route not found", correlationId: id });
          }
          await staticWeb.serve(request, response, url.pathname);
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
