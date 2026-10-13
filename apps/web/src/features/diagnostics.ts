import { getPerformance } from "../api/performance.js";

function metric(label: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "diagnostic-row";
  const name = document.createElement("span");
  name.textContent = label;
  const data = document.createElement("strong");
  data.textContent = value;
  row.append(name, data);
  return row;
}

export async function mountDiagnostics(container: HTMLElement): Promise<void> {
  container.replaceChildren(metric("Status", "loading…"));
  const controller = new AbortController();

  try {
    const snapshot = await getPerformance(controller.signal);
    const rssMiB = snapshot.memory.rssBytes / 1024 / 1024;
    container.replaceChildren(
      metric("RSS", rssMiB.toFixed(1) + " MiB"),
      metric("Event loop p95", snapshot.eventLoop.p95Ms.toFixed(2) + " ms"),
      metric("Uptime", Math.round(snapshot.uptimeMs / 1000) + " s")
    );
  } catch (error) {
    container.replaceChildren(
      metric("Diagnostics", error instanceof Error ? error.message : String(error))
    );
  }
}
