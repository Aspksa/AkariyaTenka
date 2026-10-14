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
  readonly updateStatus?: () => Promise<string>;
  readonly updateCheck?: () => Promise<string>;
  readonly updateVerify?: () => Promise<string>;
  readonly portableStatus?: () => Promise<string>;
  readonly portableAction?: (payload: unknown) => Promise<string>;
  readonly portableShutdown?: () => Promise<void>;
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

        if (request.method === "POST" && url.pathname === "/api/portable/action") {
          const origin = request.headers.origin;
          const peer = request.socket.remoteAddress;
          const loopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
          const hostname = request.headers.host;
          const expected = "127.0.0.1:" + config.port;
          if (!loopback || config.host !== "127.0.0.1" || !config.supervised || !config.supervisorToken || hostname !== expected ||
              origin !== "http://" + expected || request.headers["x-akariya-action"] !== "portable" ||
              request.headers["content-type"]?.split(";")[0].trim() !== "application/json" ||
              routes.portableAction === undefined || routes.portableShutdown === undefined) {
            throw new AppError({ code: "PERMISSION", message: "Local supervised action required", correlationId: id });
          }
          let size = 0;
          const chunks: Buffer[] = [];
          for await (const chunk of request) {
            const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > 4096) throw new AppError({code:"VALIDATION",message:"Request too large",correlationId:id});
            chunks.push(bytes);
          }
          let input: unknown;
          try {input=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
          catch {throw new AppError({code:"VALIDATION",message:"Invalid JSON",correlationId:id});}
          const result = await routes.portableAction(input);
          response.writeHead(202, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end(result);
          setImmediate(() => { void routes.portableShutdown?.(); });
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
          if (request.method === "GET" && url.pathname === "/api/updates/status" && routes.updateStatus !== undefined) {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(await routes.updateStatus());
            return;
          }
          if (request.method === "GET" && url.pathname === "/api/updates/check" && routes.updateCheck !== undefined) {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(await routes.updateCheck());
            return;
          }
          if (request.method === "GET" && url.pathname === "/api/updates/verify" && routes.updateVerify !== undefined) {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(await routes.updateVerify());
            return;
          }
          if (request.method === "GET" && url.pathname === "/api/portable/status" && routes.portableStatus !== undefined) {
            response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            response.end(await routes.portableStatus());
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
