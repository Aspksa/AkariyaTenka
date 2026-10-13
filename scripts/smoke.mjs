import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["apps/server/dist/server.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: "4199",
    AKARIYA_PORT: "4199",
    AKARIYA_HOST: "127.0.0.1",
    AKARIYA_SUPERVISED: "1"
  }
});

let settled = false;
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const timeout = setTimeout(() => { void finish(new Error(`Server smoke test timed out\n${stderr}`)); }, 10000);

async function finish(error) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  child.kill("SIGTERM");
  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const health = await fetch("http://127.0.0.1:4199/api/health");
    const body = await health.json();
    const page = await fetch("http://127.0.0.1:4199/");
    const html = await page.text();
    if (health.ok && (body.status === "healthy" || body.status === "degraded") && page.ok && html.includes("Akariya Tenka")) {
      console.log(`Smoke OK: health=${body.status} and web shell served`);
      await finish();
      break;
    }
  } catch {
    // Server may still be starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

await new Promise((resolve) => child.once("exit", resolve));
