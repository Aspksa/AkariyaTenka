export type UpdateEvent = {
  at: string;
  event: string;
  revision: string | null;
};
export type UpdateOutcome = "confirmed" | "rolled_back" | "failed" | null;

// Only events for this particular button press may complete the operation.
// A previous successful update to the same SHA is never proof of a new install.
export function updateOutcome(
  events: readonly UpdateEvent[],
  targetSha: string,
  startedAt: number
): UpdateOutcome {
  if (!/^[a-f0-9]{40}$/.test(targetSha) || !Number.isFinite(startedAt)) return null;
  const eligible = events.filter(event =>
    event.revision === targetSha &&
    Number.isFinite(Date.parse(event.at)) &&
    Date.parse(event.at) >= startedAt - 2_000
  ).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const record of eligible) {
    if (record.event === "confirmed" || record.event === "rolled_back" ||
        record.event === "failed") return record.event;
  }
  return null;
}

export function updateProgress(events: readonly UpdateEvent[], targetSha: string, startedAt: number): string {
  const eligible = events.filter(event =>
    event.revision === targetSha && Number.isFinite(Date.parse(event.at)) &&
    Date.parse(event.at) >= startedAt - 2_000
  ).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  switch (eligible[0]?.event) {
    case "download_started": return "Скачивание обновления из GitHub…";
    case "validated": return "Проверка новой версии…";
    case "prepared": return "Приложение перезапускается…";
    default: return "Подготовка обновления…";
  }
}
