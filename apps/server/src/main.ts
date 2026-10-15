import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { AppError, Logger, SystemClock, toError } from "@akariya/core";
import { createSecretRedactor } from "@akariya/security";
import { AsyncLocalRequestContextScope } from "./adapters/request-context-scope.js";
import { loadConfig } from "./bootstrap/config.js";
import { createStorage } from "./bootstrap/storage.js";
import { createSecurity } from "./bootstrap/security.js";
import { createAssistant } from "./bootstrap/assistant.js";
import { LocalBrainSettings, type BrainSettings } from "./services/local-brain-settings.js";
import { OpenAICompatibleProvider, UnavailableAssistantProvider } from "@akariya/assistant";
import { createModules } from "./bootstrap/modules.js";
import { createHttpApplication } from "./bootstrap/server.js";
import { createHealthRoute } from "./routes/health.js";
import { createPerformanceRoute } from "./routes/performance.js";
import { createGithubUpdateRoute } from "./routes/github-updates.js";
import { ProjectStats, recordStartup } from "./services/project-stats.js";
import { MEMORY_LIST_CAP, updaterFigures } from "./services/updater-figures.js";
import { createGithubUpdateHistoryRoute } from "./routes/github-update-history.js";
import { createGithubUpdateRequest } from "./routes/github-update-request.js";
import { createRollbackRoutes } from "./routes/github-rollback.js";
import { HealthService } from "./services/health-service.js";
import { ShutdownController } from "./services/shutdown-controller.js";

async function main(): Promise<void> {
  const startupStartedAt = performance.now();
  const config = loadConfig();
  const clock = new SystemClock();
  const requestContext = new AsyncLocalRequestContextScope();
  const logger = new Logger("akariya", config.logLevel, undefined, createSecretRedactor(process.env), clock, requestContext);
  const storage = await createStorage(config);
  const security = createSecurity(storage.audit, clock, process.env);
  const assistant = createAssistant(security.policy, security.approvals, storage.audit, clock, storage.assistant);
  const brain = new LocalBrainSettings(config.dataDir);
  let brainConfig = await brain.readSettings();
  let localKey = await brain.readKey();
  const cloudKey = () => localKey || process.env.AKARIYA_CLOUDRU_API_KEY || null;
  function configureBrain():void {
    const key = cloudKey();
    if (key) assistant.setProvider(new OpenAICompatibleProvider(key,brainConfig.model,
      "https://foundation-models.api.cloud.ru/v1/chat/completions",
      {temperature:brainConfig.temperature,topP:brainConfig.topP,maxCompletionTokens:brainConfig.maxCompletionTokens}));
    else if (process.env.AKARIYA_AI_API_KEY && process.env.AKARIYA_AI_MODEL)
      assistant.setProvider(new OpenAICompatibleProvider(process.env.AKARIYA_AI_API_KEY,process.env.AKARIYA_AI_MODEL));
    else assistant.setProvider(new UnavailableAssistantProvider());
  }
  configureBrain();
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
    "storage.assistant": () => storage.assistant.health(),
    "security.secrets": () => {
      security.secrets.probe();
      return { state: "started", recoverable: true };
    }
  });

  let requestSupervisorShutdown: (() => void) | undefined;
  let requestUpdateShutdown: (() => void) | undefined;
  const rollback = createRollbackRoutes(process.cwd());
  let startups: number[] = [];
  const projectStats = new ProjectStats(process.cwd(), config.dataDir, () => updaterFigures({
    root: process.cwd(),
    startups: () => startups,
    memories: async () => (await storage.assistant.listRecent("assistant", MEMORY_LIST_CAP)).length
  }));
  const server = createHttpApplication(
    config,
    {
      health: createHealthRoute(health),
      assistantStatus: async () => JSON.stringify({
        configured:Boolean(cloudKey() || (process.env.AKARIYA_AI_API_KEY && process.env.AKARIYA_AI_MODEL)),
        keyStored:Boolean(localKey), provider:cloudKey()?"Cloud.ru":"OpenAI-compatible",
        model:cloudKey()?brainConfig.model:(process.env.AKARIYA_AI_MODEL??null),
        settings:brainConfig,memory:true
      }),
      assistantModels: async () => {
        const key=cloudKey();
        if (!key) throw new AppError({code:"CONFLICT",message:"Configure Cloud.ru API key first"});
        let response:Response;
        try {response=await fetch("https://foundation-models.api.cloud.ru/v1/models",
          {headers:{authorization:"Bearer "+key,accept:"application/json"},signal:AbortSignal.timeout(12000)});}
        catch {throw new AppError({code:"EXTERNAL_SERVICE",message:"Cloud.ru model catalog unavailable"});}
        if (!response.ok) throw new AppError({code:"EXTERNAL_SERVICE",message:"Cloud.ru models request failed (HTTP "+response.status+")"});
        const body=await response.json() as {data?:Array<{id?:unknown;metadata?:{name?:unknown;type?:unknown}}>};
        const models=(Array.isArray(body.data)?body.data:[])
          .filter(m=>typeof m.id==="string" && /^[\w./-]{2,150}$/.test(m.id))
          .map(m=>({id:m.id,name:typeof m.metadata?.name==="string"?m.metadata.name:m.id,
            type:typeof m.metadata?.type==="string"?m.metadata.type:null})).slice(0,150);
        return JSON.stringify({models});
      },
      assistantSettings: async payload => {
        const data=payload as {key?:unknown;removeKey?:unknown;settings?:unknown} | null;
        if (!data||typeof data!=="object") throw new AppError({code:"VALIDATION",message:"Invalid settings request"});
        if(data.key!==undefined&&data.removeKey===true)throw new AppError({code:"VALIDATION",message:"Conflicting key actions"});
        if(data.key!==undefined){await brain.saveKey(data.key);localKey=await brain.readKey();}
        if(data.removeKey===true){await brain.deleteKey();localKey=null;}
        if(data.settings!==undefined)brainConfig=await brain.saveSettings(data.settings);
        configureBrain();
        return JSON.stringify({saved:true,configured:Boolean(cloudKey()),keyStored:Boolean(localKey),settings:brainConfig});
      },
      assistantTurn: async (payload, context) => {
        const input = payload as {text?:unknown;sessionId?:unknown};
        if (!input || typeof input.text !== "string" || input.text.length > 8000 || (input.sessionId !== undefined && typeof input.sessionId !== "string"))
          throw new AppError({code:"VALIDATION",message:"Invalid assistant input"});
        const text = input.text.trim();
        // Store long-term memory only on explicit user request.
        const remember = /^(?:запомни(?:\s+это)?\s*[:：-]\s*|remember\s*[:：-]\s*)(.+)$/isu.exec(text);
        if (remember) {
          const fact = remember[1]?.trim() ?? "";
          if (fact.length < 1 || fact.length > 2000)
            throw new AppError({code:"VALIDATION",message:"Memory must be between 1 and 2000 characters"});
          const now = clock.now().toISOString();
          await storage.assistant.put({id:randomUUID(),scope:"assistant",text:fact,
            source:{kind:"user"},tags:[],createdAt:now,updatedAt:now});
          return JSON.stringify({status:"completed",sessionId:typeof input.sessionId==="string"?input.sessionId:null,
            turnId:randomUUID(),text:"Сохранено в долговременной памяти.",replayed:false,
            usage:{inputTokens:0,outputTokens:0,costMicros:0}});
        }
        return JSON.stringify(await assistant.runtime.runTurn({text,...(typeof input.sessionId === "string" ? {sessionId:input.sessionId} : {})},context));
      },
      performance: createPerformanceRoute(modules.metrics),
      githubUpdates: createGithubUpdateRoute(process.cwd()),
      projectStats: async (force) => JSON.stringify(await projectStats.get(force)),
      githubUpdateHistory: createGithubUpdateHistoryRoute(process.cwd()),
      rollbackList: rollback.list,
      rollbackRequest: rollback.request,
      githubUpdateRequest: createGithubUpdateRequest(process.cwd()),
      githubUpdateShutdown: async () => { requestUpdateShutdown?.(); },
      supervisorShutdown: async () => { requestSupervisorShutdown?.(); }
    },
    logger,
    requestContext
  );
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const startupMs = performance.now() - startupStartedAt;
  modules.metrics.observe("server.startup_ms", startupMs);
  startups = await recordStartup(config.dataDir, startupMs);
  logger.info("Akariya Tenka listening on http://" + config.host + ":" + config.port);

  const shutdown = new ShutdownController(
    logger,
    config.shutdownTimeoutMs,
    {
      closeHttp: () => new Promise<void>((resolve) => server.close(() => resolve())),
      stopRuntime: () => modules.kernel.stop(),
      flushPersistence: async () => {
        await Promise.all([
          storage.audit.flush(),
          storage.idempotency.flush(),
          storage.assistant.close()
        ]);
      }
    }
  );

  requestSupervisorShutdown = () => { void shutdown.shutdown(0, "supervisor"); };
  requestUpdateShutdown = () => { void shutdown.shutdown(75, "github-update"); };

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
