import { getUpdateStatus } from "../api/updates.js";

export function mountUpdates(container: HTMLElement): void {
  const title = document.createElement("h2");
  title.textContent = "Обновления Akariya Tenka";
  const state = document.createElement("p");
  state.setAttribute("role", "status");
  state.textContent = "Статус обновления ещё не загружен.";
  const check = document.createElement("button");
  check.type = "button";
  check.textContent = "Проверить состояние";
  const install = document.createElement("button");
  install.type = "button";
  install.textContent = "Установить и перезапустить";
  install.disabled = true;
  install.title = "Установка недоступна без независимого доверенного ключа издателя и подтверждения.";
  async function refresh(): Promise<void> {
    check.disabled = true;
    state.textContent = "Проверка локального состояния…";
    try {
      const status = await getUpdateStatus();
      const version = status.currentVersion ?? "неизвестна";
      const pending = status.pendingConfirmation ? "Ожидается подтверждение запуска." :
        status.pendingRestart ? "Обновление подготовлено к перезапуску." : "Нет подготовленного обновления.";
      state.textContent = "Текущая версия: " + version + ". " + pending + " " + status.message;
      // Deliberately disabled: a read-only status endpoint is not an install authority.
      install.disabled = true;
    } catch (error) {
      state.textContent = error instanceof Error ? error.message : "Не удалось получить статус.";
    } finally {
      check.disabled = false;
    }
  }
  check.addEventListener("click", () => { void refresh(); });
  container.append(title, state, check, install);
  void refresh();
}
