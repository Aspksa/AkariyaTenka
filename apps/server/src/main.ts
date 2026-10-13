import { Logger, SystemClock, toError } from "@akariya/core";
import { createSecretRedactor } from "@akariya/security";
import { AsyncLocalRequestContextScope } from "./adapters/request-context-scope.js";
import { loadConfig } from "./bootstrap/config.js";
import { createStorage } from "./bootstrap/storage.js";
import { createSecurity } from "./bootstrap/security.js";
import { createAssistant } from "./bootstrap/assistant.js";
import { createModules } from "./bootstrap/modules.js";
import { createHttpApplication } from "./bootstrap/server.js";
import { createHealthRoute } from "./routes/health.js";
import { HealthService } from "./services/health-service.js";
import { ShutdownController } from "./services/shutdown-controller.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const clock = new SystemClock();
  const requestContext = new AsyncLocalRequestContextScope();
  const logger = new Logger("akariya", config.logLevel, undefined, createSecretRedactor(process.env), clock, requestContext);
  const storage = await createStorage(config);
  const security = createSecurity(storage.audit, clock, process.env);
  createAssistant(security.policy, security.approvals, storage.audit, clock);
  const modules = createModules(clock, requestContext);
  await modules.kernel.start();

  const health = new HealthService(modules.kernel, clock, {
    "storage.audit": () => storage.audit.health(),
    "storage.idempotency": async () => {
      const probe = await storage.idempotency.probe();
      return probe.status === "ok"
        ? { state: "started", recoverable: true }
        : { state: "degraded", recoverable: true, lastError: probe.lastError ?? "Idempotency storage degraded" };
    },
    "security.secrets": () => {
      security.secrets.probe();
      return { state: "started", recoverable: true };
    }
  });

  let requestSupervisorShutdown: (() => void) | undefined;
  const server = createHttpApplication(
    config,
    {
      health: createHealthRoute(health),
      supervisorShutdown: async () => { requestSupervisorShutdown?.(); }
    },
    logger,
    requestContext
  );
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  logger.info("Akariya Tenka listening on http://" + config.host + ":" + config.port);

  const shutdown = new ShutdownController(
    logger,
    config.shutdownTimeoutMs,
    {
      closeHttp: () => new Promise<void>((resolve) => server.close(() => resolve())),
      stopRuntime: () => modules.kernel.stop(),
      flushPersistence: async () => {
        await Promise.all([storage.audit.flush(), storage.idempotency.flush()]);
      }
    }
  );

  requestSupervisorShutdown = () => { void shutdown.shutdown(0, "supervisor"); };

  const crash = (kind: string, reason: unknown): void => {
    const error = toError(reason);
    logger.error(kind, { name: error.name, message: error.message });
    void shutdown.shutdown(1, kind);
  };

  process.once("SIGINT", () => { void shutdown.shutdown(0, "SIGINT"); });
  process.once("SIGTERM", () => { void shutdown.shutdown(0, "SIGTERM"); });
  process.once("uncaughtException", (error) => crash("uncaughtException", error));
  process.on("unhandledRejection", (reason) => crash("unhandledRejection", reason));
}

main().catch((error: unknown) => {
  const safe = createSecretRedactor(process.env)(toError(error).message);
  console.error(typeof safe === "string" ? safe : "Akariya Tenka failed to start");
  process.exitCode = 1;
});
