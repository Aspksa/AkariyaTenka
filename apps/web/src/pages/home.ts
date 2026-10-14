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
  const brand = document.createElement("div");
  brand.className = "brand";
  const symbol = document.createElement("img");
  symbol.src = "/akariya-fox.svg";
  symbol.alt = "Эмблема Akariya Tenka — восьмихвостая лиса";
  symbol.width = 48;
  symbol.height = 48;
  brand.append(symbol, textElement("span", "brand-name", "AKARIYA TENKA"));
  const navbar = document.createElement("header");
  navbar.className = "topbar";
  navbar.append(brand, textElement("span", "topbar-label", "PRIVATE AI · CRIMSON EDITION"));
  const atmosphere = document.createElement("div");
  atmosphere.className = "atmosphere";
  atmosphere.setAttribute("aria-hidden", "true");
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

  const portableButton = textElement("button", "diagnostics-trigger", "Перенос Akariya");
  portableButton.type = "button";
  const portablePanel = document.createElement("section");
  portablePanel.className = "diagnostics";
  portablePanel.hidden = true;
  portableButton.addEventListener("click", () => {
    portablePanel.hidden = !portablePanel.hidden;
    if (portablePanel.hidden || portablePanel.dataset.loaded === "true") return;
    portablePanel.dataset.loaded = "true";
    portablePanel.textContent = "Загрузка действий переноса…";
    void import("../features/portable-transfer.js")
      .then(({ mountPortableActions }) => mountPortableActions(portablePanel))
      .catch((error: unknown) => {
        portablePanel.textContent = error instanceof Error ? error.message : String(error);
        delete portablePanel.dataset.loaded;
      });
  });

  hero.append(
    atmosphere,
    textElement("p", "eyebrow", "紅の狐 · THE CRIMSON FOX"),
    textElement("h1", undefined, "Akariya Tenka"),
    textElement("p", "lead", "Твоя персональная Akariya. Память, защита и управление — в единой системе."),
    statusRow,
    diagnosticsButton,
    diagnostics,
    updatesButton,
    updatesPanel,
    portableButton,
    portablePanel
  );

  const grid = document.createElement("section");
  grid.className = "grid";
  grid.append(
    card("Защита", "Ключи, контроль доверия, подтверждения и журнал действий."),
    card("Память", "Структурированное хранение и сохранность данных Akariya."),
    card("Управление", "Проверка системы, обновления и безопасный перенос.")
  );

  const footnote = textElement("p", "footnote", "AKARIYA TENKA  /  BUILT TO ENDURE");
  main.append(navbar, hero, grid, footnote);
  return {
    element: main,
    update: (state) => badge.update(state)
  };
}
