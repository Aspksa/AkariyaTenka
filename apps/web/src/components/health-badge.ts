import type { HealthState } from "../state/health.js";

export interface HealthBadge {
  readonly element: HTMLSpanElement;
  update(state: HealthState): void;
}

export function createHealthBadge(): HealthBadge {
  const element = document.createElement("span");

  const update = (state: HealthState): void => {
    if (state.kind === "loading") {
      element.className = "badge pending";
      element.textContent = "checking foundation…";
      return;
    }
    if (state.kind === "error") {
      element.className = "badge failed";
      element.textContent = "health unavailable";
      return;
    }
    element.className = "badge " + state.health.status;
    element.textContent = state.health.status;
  };

  return { element, update };
}
