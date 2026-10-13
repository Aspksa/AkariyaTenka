import type { HealthState } from "../state/health.js";
import { renderHealthBadge } from "../components/health-badge.js";

export function renderHome(state: HealthState): string {
  return `
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">FOUNDATION / P0–P2</p>
        <h1>Akariya Tenka</h1>
        <p class="lead">A clean, modular foundation designed for long-term growth.</p>
        <div class="status-row"><span>Runtime</span>${renderHealthBadge(state)}</div>
      </section>
      <section class="grid">
        <article><h2>Boundaries first</h2><p>Core, contracts, persistence, security and assistant infrastructure are isolated before product domains arrive.</p></article>
        <article><h2>Validated edges</h2><p>External data is unknown until a runtime schema accepts it. TypeScript is not treated as runtime validation.</p></article>
        <article><h2>Safe side effects</h2><p>Capabilities, approval, correlation and audit form the execution path for future tools.</p></article>
      </section>
    </main>`;
}
