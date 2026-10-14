export type CardId = "diagnostics" | "updates";
export interface DashboardPreferences { order: CardId[]; hidden: CardId[] }
const allowed: CardId[] = ["diagnostics", "updates"];
export const DEFAULT_DASHBOARD: DashboardPreferences = { order: [...allowed], hidden: [] };
export function parseDashboardPreferences(input: unknown): DashboardPreferences {
  if (!input || typeof input !== "object") return { order:[...allowed], hidden:[] };
  const data = input as Record<string,unknown>;
  const order = Array.isArray(data.order) ? data.order.filter((id): id is CardId => allowed.includes(id as CardId)) : [];
  const hidden = Array.isArray(data.hidden) ? data.hidden.filter((id): id is CardId => allowed.includes(id as CardId)) : [];
  return { order:[...new Set([...order,...allowed])], hidden:[...new Set(hidden)] };
}
export function moveDashboardCard(state: DashboardPreferences, id: CardId, delta: -1 | 1): DashboardPreferences {
  const order = [...state.order];
  const index = order.indexOf(id), target = index + delta;
  if (index < 0 || target < 0 || target >= order.length) return state;
  const source = order[index], destination = order[target];
  if (source === undefined || destination === undefined) return state;
  order[index] = destination;
  order[target] = source;
  return {order,hidden:[...state.hidden]};
}
export function toggleDashboardCard(state:DashboardPreferences,id:CardId):DashboardPreferences {
  return {...state, hidden:state.hidden.includes(id)?state.hidden.filter(x=>x!==id):[...state.hidden,id]};
}
