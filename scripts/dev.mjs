import { spawn, spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const initial = spawnSync(npm, ["run", "build:ts"], { stdio: "inherit" });
if (initial.status !== 0) process.exit(initial.status ?? 1);

const children = [
  spawn(npm, ["run", "build:ts", "--", "--watch", "--preserveWatchOutput"], { stdio: "inherit" }),
  spawn(process.execPath, ["--watch", "apps/server/dist/main.js"], { stdio: "inherit" }),
  spawn(npm, ["run", "dev", "-w", "@akariya/web"], { stdio: "inherit" })
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code && code !== 0) stop(code);
  });
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
