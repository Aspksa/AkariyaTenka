import { Logger, SystemClock } from "@akariya/core";
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

async function main(): Promise<void> {
  const config = loadConfig();
  const clock = new SystemClock();
  const requestContext = new AsyncLocalRequestContextScope();
  const logger = new Logger("akariya", config.logLevel, undefined, createSecretRedactor(process.env));
  const storage = await createStorage(config);
  const security = createSecurity(storage.audit, clock);
  createAssistant(security.policy, security.approvals, storage.audit, clock);
  const modules = createModules(clock);
  await modules.kernel.start();

  const health = new HealthService(modules.kernel, clock);
  const server = createHttpApplication(config, { health: createHealthRoute(health) }, logger, requestContext);
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  logger.info("Akariya Tenka listening on http://" + config.host + ":" + config.port);

  let stopping = false;
  const shutdown = async (code = 0): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await modules.kernel.stop();
    await storage.audit.flush();
    await storage.idempotency.flush();
    process.exitCode = code;
  };

  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
  process.on("unhandledRejection", (reason) => logger.error("unhandled rejection", reason));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
