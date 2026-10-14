import { createHealthBadge } from "../components/health-badge.js";
import type { HealthState } from "../state/health.js";

export interface HomeView {
  readonly element: HTMLElement;
  update(state: HealthState): void;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string | undefined,
  text: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  element.textContent = text;
  return element;
}

function card(title: string, body: string): HTMLElement {
  const article = document.createElement("article");
  article.append(
    textElement("h2", undefined, title),
    textElement("p", undefined, body)
  );
  return article;
}

export function createHomeView(): HomeView {
  const main = document.createElement("main");
  main.className = "shell";

  const hero = document.createElement("section");
  hero.className = "hero";
  const statusRow = document.createElement("div");
  statusRow.className = "status-row";
  statusRow.append(textElement("span", undefined, "Runtime"));

  const badge = createHealthBadge();
  statusRow.append(badge.element);

  const diagnosticsButton = textElement("button", "diagnostics-trigger", "Diagnostics");
  diagnosticsButton.type = "button";
  const diagnostics = document.createElement("section");
  diagnostics.className = "diagnostics";
  diagnostics.hidden = true;
  let diagnosticsLoaded = false;

  diagnosticsButton.addEventListener("click", () => {
    diagnostics.hidden = !diagnostics.hidden;
    if (diagnostics.hidden || diagnosticsLoaded) return;
    diagnosticsLoaded = true;
    diagnosticsButton.disabled = true;
    void import("../features/diagnostics.js")
      .then(({ mountDiagnostics }) => mountDiagnostics(diagnostics))
      .catch((error: unknown) => {
        diagnostics.textContent = error instanceof Error ? error.message : String(error);
      })
      .finally(() => { diagnosticsButton.disabled = false; });
  });

  const updatesButton = textElement("button", "diagnostics-trigger", "Обновления");
  updatesButton.type = "button";
  const updatesPanel = document.createElement("section");
  updatesPanel.className = "diagnostics";
  updatesPanel.hidden = true;
  let updatesLoaded = false;
  updatesButton.addEventListener("click", () => {
    updatesPanel.hidden = !updatesPanel.hidden;
    if (updatesPanel.hidden || updatesLoaded) return;
    updatesLoaded = true;
    updatesButton.disabled = true;
    void import("../features/updates.js")
      .then(({ mountUpdates }) => mountUpdates(updatesPanel))
      .catch((error: unknown) => {
        updatesPanel.textContent = error instanceof Error ? error.message : String(error);
      })
      .finally(() => { updatesButton.disabled = false; });
  });

  hero.append(
    textElement("p", "eyebrow", "FOUNDATION / P0–P2"),
    textElement("h1", undefined, "Akariya Tenka"),
    textElement("p", "lead", "A clean, modular foundation designed for long-term growth."),
    statusRow,
    diagnosticsButton,
    diagnostics,
    updatesButton,
    updatesPanel
  );

  const grid = document.createElement("section");
  grid.className = "grid";
  grid.append(
    card("Boundaries first", "Core, contracts, persistence, security and assistant infrastructure are isolated before product domains arrive."),
    card("Validated edges", "External data is unknown until a runtime schema accepts it. TypeScript is not treated as runtime validation."),
    card("Safe side effects", "Capabilities, approval, correlation and audit form the execution path for future tools.")
  );

  main.append(hero, grid);
  return {
    element: main,
    update: (state) => badge.update(state)
  };
}
