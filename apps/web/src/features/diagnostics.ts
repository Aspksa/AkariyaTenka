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
  container.replaceChildren(metric("Статус", "загрузка…"));
  const controller = new AbortController();

  try {
    const snapshot = await getPerformance(controller.signal);
    const rssMiB = snapshot.memory.rssBytes / 1024 / 1024;
    container.replaceChildren(
      metric("Память (RSS)", rssMiB.toFixed(1) + " МиБ"),
      metric("Задержка event loop, p95", snapshot.eventLoop.p95Ms.toFixed(2) + " мс"),
      metric("Время работы", Math.round(snapshot.uptimeMs / 1000) + " с")
    );
  } catch (error) {
    container.replaceChildren(
      metric("Диагностика", error instanceof Error ? error.message : String(error))
    );
  }
}
