import type { HealthState } from "../state/health.js";

export interface HealthBadge {
  readonly element: HTMLSpanElement;
  update(state: HealthState): void;
}

const STATUS_LABELS: Record<string, string> = {
  healthy: "в норме",
  degraded: "частично",
  failed: "сбой"
};

export function createHealthBadge(): HealthBadge {
  const element = document.createElement("span");

  const update = (state: HealthState): void => {
    if (state.kind === "loading") {
      element.className = "badge pending";
      element.textContent = "проверка…";
      return;
    }
    if (state.kind === "error") {
      element.className = "badge failed";
      element.textContent = "нет связи";
      return;
    }
    element.className = "badge " + state.health.status;
    element.textContent = STATUS_LABELS[state.health.status] ?? state.health.status;
  };

  return { element, update };
}
