import type { HealthState } from "../state/health.js";

export function renderHealthBadge(state: HealthState): string {
  if (state.kind === "loading") return '<span class="badge pending">checking foundation…</span>';
  if (state.kind === "error") return '<span class="badge failed">health unavailable</span>';
  return '<span class="badge ' + state.health.status + '">' + state.health.status + "</span>";
}
