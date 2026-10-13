import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { applyPreparedUpdate, applyRollbackRequest, confirmUpdate, rollbackFailedStart } from "./apply-update.mjs";
import { inspectWorkspaceLinks } from "./workspace-health.mjs";
import { verifyPrebuilt } from "./prebuilt.mjs";

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), "..");
const RESTART_CODE = 75;
const STARTUP_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 300;
const MAX_PORT_ATTEMPTS = 100;
const GRACEFUL_CHILD_TIMEOUT_MS = 5_000;
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASH_RESTARTS = 3;
const children = new Map();
const supervisorToken = randomBytes(32).toString("hex");
const launcherStartedAt = performance.now();
let ending = false;
let serverReady = false;
let updateApplied = false;
let currentPort;

function parseArgs(argv) {
  const options = { dev: false, noOpen: false, skipChecks: false, port: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dev") options.dev = true;
    else if (arg === "--no-open") options.noOpen = true;
    else if (arg === "--skip-checks") options.skipChecks = true;
    else if (arg === "--port") {
      const raw = argv[index + 1];
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port value: ${String(raw)}`);
      options.port = port;
      index += 1;
    } else throw new Error(`Unknown launcher option: ${arg}`);
  }
  return options;
}

const args = process.argv.slice(2);
const options = parseArgs(args);
const smokeMode = process.env.AKARIYA_LAUNCHER_SMOKE === "1";
const requestedPort = options.port ?? 4173;
const bin = (...parts) => path.join(root, "node_modules", ...parts);
const step = (message) => console.log(`\n\x1b[36m==> ${message}\x1b[0m`);
const warn = (message) => console.log(`\n\x1b[33m[!] ${message}\x1b[0m`);

function selectedEnvironment(extra = {}, { network = false } = {}) {
  const result = {};
  const allowed = [
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "CI", "LANG", "LC_ALL", "TERM", "NO_COLOR", "FORCE_COLOR",
  ];
  if (network) allowed.push("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NPM_CONFIG_REGISTRY", "npm_config_registry");
  const entries = Object.entries(process.env);
  for (const wanted of allowed) {
    const found = entries.find(([key, value]) => value !== undefined && key.toLowerCase() === wanted.toLowerCase());
    if (found) result[found[0]] = found[1];
  }
  return { ...result, ...extra };
}

function killProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

function childFor(label) {
  for (const [child, childLabel] of children.entries()) {
    if (childLabel === label) return child;
  }
  return undefined;
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function requestBackendShutdown() {
  if (!currentPort) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${currentPort}/api/_supervisor/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${supervisorToken}` },
      signal: AbortSignal.timeout(1_500)
    });
    return response.status === 202 || response.status === 204;
  } catch {
    return false;
  }
}

async function stopChildrenGracefully() {
  const backend = childFor("backend");
  if (backend) {
    await requestBackendShutdown();
    const exited = await waitForChildExit(backend, GRACEFUL_CHILD_TIMEOUT_MS);
    if (!exited) killProcessTree(backend);
  }

  for (const [child, label] of [...children.entries()]) {
    if (label !== "backend") killProcessTree(child);
  }
  children.clear();
}

async function finish(code = 0) {
  if (ending) return;
  ending = true;
  await stopChildrenGracefully();
  process.exit(code);
}

process.once("SIGINT", () => { void finish(0); });
process.once("SIGTERM", () => { void finish(0); });

function controlledNpmCommand(npmArgs) {
  if (process.platform === "win32") {
    // Every token is launcher-controlled. No user input is concatenated into this cmd.exe command.
    const command = `npm ${npmArgs.join(" ")}`;
    return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { command: "npm", args: npmArgs };
}

function runSync(label, command, commandArgs, { cwd = root, env = selectedEnvironment() } = {}) {
  step(label);
  const result = spawnSync(command, commandArgs, { cwd, env, stdio: "inherit", shell: false });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${String(result.status)}`);
}

function runNpm(label, npmArgs, { network = false } = {}) {
  const invocation = controlledNpmCommand(npmArgs);
  runSync(label, invocation.command, invocation.args, { env: selectedEnvironment({}, { network }) });
}

function hashLockfile() {
  const lockFile = path.join(root, "package-lock.json");
  if (!existsSync(lockFile)) return "no-lockfile";
  return createHash("sha256").update(readFileSync(lockFile)).digest("hex");
}

function readStamp(file) {
  try { return readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function requiredDependenciesMissing() {
  return [
    bin("vite", "bin", "vite.js"),
    bin("typescript", "bin", "tsc"),
    bin("vitest", "vitest.mjs"),
  ].filter((file) => !existsSync(file));
}

function verifyWorkspaceState() {
  return inspectWorkspaceLinks(root).filter((item) => !item.ok);
}

function ensureDependencies({ force = false } = {}) {
  const lockHash = hashLockfile();
  const lockStamp = bin(".akariya-lock");
  const missingDependencies = requiredDependenciesMissing();
  const workspaceProblems = verifyWorkspaceState();
  const staleLock = readStamp(lockStamp) !== lockHash;

  if (missingDependencies.length === 0 && workspaceProblems.length === 0 && !force && !staleLock) return;

  if (workspaceProblems.length > 0) {
    warn(`npm workspace links need recovery: ${workspaceProblems.map((item) => `${item.name} (${item.reason})`).join(", ")}`);
  }
  if (staleLock) console.log("package-lock.json changed or has not been stamped; dependencies will be synchronized.");

  const installMode = existsSync(path.join(root, "package-lock.json")) ? "ci" : "install";
  runNpm("Installing dependencies", [installMode, "--no-audit", "--no-fund", "--ignore-scripts"], { network: true });

  const afterMissing = requiredDependenciesMissing();
  const afterWorkspaces = verifyWorkspaceState();
  if (afterMissing.length > 0 || afterWorkspaces.length > 0) {
    throw new Error(`Dependency recovery incomplete. Missing: ${afterMissing.join(", ") || "none"}; workspaces: ${afterWorkspaces.map((item) => item.name).join(", ") || "none"}`);
  }
  try { writeFileSync(lockStamp, `${lockHash}\n`); } catch { /* stamp is an optimization only */ }
}

function runQualityChecks() {
  const tsc = bin("typescript", "bin", "tsc");
  runSync("Typecheck: project references", process.execPath, [tsc, "-b", "packages/core", "packages/contracts", "packages/persistence", "packages/security", "packages/assistant", "apps/server"]);
  runSync("Typecheck: web", process.execPath, [tsc, "-p", "apps/web/tsconfig.json", "--noEmit"]);
  runSync("Typecheck: tests", process.execPath, [tsc, "-p", "tsconfig.tests.json", "--noEmit"]);
  runSync("Launcher tests", process.execPath, ["--test", "scripts/workspace-health.test.mjs", "scripts/apply-update.test.mjs"]);
  runSync("Project tests", process.execPath, [bin("vitest", "vitest.mjs"), "run"]);
}

function runBuilds() {
  runSync("Build server", process.execPath, [path.join(root, "scripts", "build-server.mjs")]);
  if (!options.dev) {
    runSync("Build web", process.execPath, [bin("vite", "bin", "vite.js"), "build"], { cwd: path.join(root, "apps", "web") });
  }
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function findPort(start) {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const candidate = start + offset;
    if (candidate > 65535) break;
    if (await canListen(candidate)) return candidate;
    console.log(`Port ${candidate} is busy; trying the next one...`);
  }
  throw new Error(`No free loopback port found in ${start}-${Math.min(65535, start + MAX_PORT_ATTEMPTS - 1)}`);
}

async function waitForHealth(url, timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "healthy" || body?.status === "degraded") return true;
      }
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

async function waitForHttp(url, timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
      if (response.ok) return true;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

function openBrowser(url) {
  try {
    let child;
    if (process.platform === "win32") {
      child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], { stdio: "ignore", detached: true });
    } else if (process.platform === "darwin") {
      child = spawn("open", [url], { stdio: "ignore", detached: true });
    } else {
      child = spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    }
    child.on("error", () => {});
    child.unref();
  } catch { /* browser launch must never stop the server */ }
}

function argsForRelaunch({ noOpen = false, port } = {}) {
  const next = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--port") { index += 1; continue; }
    if (args[index] === "--no-open") continue;
    next.push(args[index]);
  }
  if (noOpen) next.push("--no-open");
  if (port) next.push("--port", String(port));
  return next;
}

function relaunch({ env = {}, noOpen = false, port } = {}) {
  ending = true;
  killChildren();
  const child = spawn(process.execPath, [script, ...argsForRelaunch({ noOpen, port: port ?? currentPort })], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.set(child, "launcher");
  child.once("error", (error) => {
    console.error(`[ERROR] Could not restart Akariya launcher: ${error.message}`);
    process.exit(1);
  });
  child.once("exit", (code) => process.exit(code ?? 1));
}

async function fail(message) {
  if (ending) return;
  console.error(`\n\x1b[31m[ERROR] ${message}\x1b[0m`);
  if (updateApplied && !serverReady) {
    ending = true;
    killChildren();
    try {
      if (await rollbackFailedStart(root, message)) {
        warn("The new version did not start. The previous installation was restored and will be started again.");
        relaunch({ env: { AKARIYA_REINSTALL: "1" }, noOpen: true, port: currentPort });
        return;
      }
    } catch (error) {
      console.error(`[ERROR] Automatic rollback failed: ${error?.message ?? error}`);
    }
    process.exit(1);
  }
  finish(1);
}

function spawnManaged(label, command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd ?? root,
    env: options.env ?? selectedEnvironment(),
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.set(child, label);
  child.once("error", (error) => { void fail(`${label} could not start: ${error.message}`); });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (ending) return;
    if (label === "backend" && code === RESTART_CODE) {
      step("Restart requested by Akariya");
      relaunch({ noOpen: true, port: currentPort });
      return;
    }
    if (code === 0 && !signal) finish(0);
    else void fail(`${label} exited unexpectedly (${signal ? `signal ${signal}` : `code ${String(code)}`})`);
  });
  return child;
}

function quarantinePreparedUpdate() {
  const ready = path.join(root, ".updates", "ready.json");
  if (!existsSync(ready)) return;
  try { renameSync(ready, path.join(root, ".updates", `ready.failed-${Date.now()}.json`)); } catch { /* diagnostics only */ }
}

async function prepareInstallation() {
  let touched = false;

  if (await rollbackFailedStart(root, "Previous update was not confirmed by a healthy startup")) {
    touched = true;
    warn("An unconfirmed update was rolled back before startup.");
  }

  if (await applyRollbackRequest(root)) {
    touched = true;
    step("Manual rollback applied");
  }

  try {
    if (await applyPreparedUpdate(root)) {
      touched = true;
      updateApplied = true;
      step("Prepared update installed; startup health confirmation is pending");
    }
  } catch (error) {
    quarantinePreparedUpdate();
    warn(`Prepared update was rejected or rolled back: ${error?.message ?? error}. Starting the current installation.`);
  }

  return touched;
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < 20) throw new Error(`Node.js 20+ is required; found ${process.version}`);

  const touched = await prepareInstallation();
  const forcedReinstall = process.env.AKARIYA_REINSTALL === "1";
  ensureDependencies({ force: forcedReinstall || touched });

  if (options.skipChecks) {
    warn("--skip-checks is active: typecheck and tests are intentionally skipped for this launch.");
  } else {
    runQualityChecks();
  }

  runBuilds();

  const backendPort = await findPort(requestedPort);
  currentPort = backendPort;
  const backendUrl = `http://127.0.0.1:${backendPort}/`;
  step(`Starting backend on ${backendUrl}`);
  const backendEnv = { ...process.env, PORT: String(backendPort), AKARIYA_PORT: String(backendPort), AKARIYA_HOST: "127.0.0.1", AKARIYA_SUPERVISED: "1" };
  delete backendEnv.AKARIYA_REINSTALL;
  spawnManaged("backend", process.execPath, [path.join(root, "apps", "server", "dist", "server.mjs")], { env: backendEnv });

  let openUrl = backendUrl;
  if (options.dev) {
    const vitePort = await findPort(backendPort + 1);
    const viteEnv = selectedEnvironment({ VITE_API_TARGET: `http://127.0.0.1:${backendPort}` });
    spawnManaged("vite", process.execPath, [bin("vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
      cwd: path.join(root, "apps", "web"),
      env: viteEnv,
    });
    openUrl = `http://127.0.0.1:${vitePort}/`;
  }

  const healthy = await waitForHealth(`${backendUrl}api/health`);
  const webReady = !options.dev || await waitForHttp(openUrl);
  if (!healthy || !webReady) {
    await fail(`Akariya did not become ready within ${STARTUP_TIMEOUT_MS / 1000} seconds.`);
    return;
  }

  serverReady = true;
  if (updateApplied) await confirmUpdate(root);
  console.log(`\n\x1b[32mAkariya Tenka работает: ${openUrl}\x1b[0m`);
  console.log("Ctrl+C — остановить");
  if (!options.noOpen && !smokeMode) openBrowser(openUrl);
  if (smokeMode) finish(0);
}

main().catch((error) => { void fail(error instanceof Error ? error.message : String(error)); });
