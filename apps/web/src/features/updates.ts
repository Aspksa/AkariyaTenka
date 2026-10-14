import { getUpdateStatus, checkReleases, verifyReleaseSignature } from "../api/updates.js";

export function mountUpdates(container: HTMLElement): void {
  const title = document.createElement("h2");
  title.textContent = "Обновления Akariya Tenka";
  const state = document.createElement("p");
  state.setAttribute("role", "status");
  state.textContent = "Статус обновления ещё не загружен.";
  const check = document.createElement("button");
  check.type = "button";
  check.textContent = "Проверить состояние";
  const releaseCheck = document.createElement("button");
  releaseCheck.type = "button";
  releaseCheck.textContent = "Проверить новые версии";
  const releaseInfo = document.createElement("p");
  releaseInfo.setAttribute("role", "status");
  releaseInfo.textContent = "Новые релизы ещё не проверялись.";
  releaseCheck.addEventListener("click", () => {
    releaseCheck.disabled = true;
    releaseInfo.textContent = "Проверяю GitHub Releases…";
    void checkReleases().then((result) => {
      releaseInfo.replaceChildren();
      const message = document.createElement("span");
      message.textContent = result.latestTag ? "Последний релиз: " + result.latestTag + ". " + result.message : result.message;
      releaseInfo.append(message);
      if (result.releaseUrl) {
        const link = document.createElement("a");
        link.href = result.releaseUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Открыть релиз на GitHub";
        releaseInfo.append(" ", link);
      }
    }).catch((error: unknown) => {
      releaseInfo.textContent = error instanceof Error ? error.message : "Ошибка проверки обновлений";
    }).finally(() => { releaseCheck.disabled = false; });
  });
  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Проверить цифровую подпись";
  const verifyInfo = document.createElement("p");
  verifyInfo.setAttribute("role", "status");
  verifyInfo.textContent = "Подпись ещё не проверялась.";
  verifyButton.addEventListener("click", () => {
    verifyButton.disabled = true;
    verifyInfo.textContent = "Проверяю подпись издателя…";
    void verifyReleaseSignature()
      .then(result => { verifyInfo.textContent = result.message; })
      .catch((error: unknown) => {
        verifyInfo.textContent = error instanceof Error ? error.message : "Ошибка проверки подписи";
      })
      .finally(() => { verifyButton.disabled = false; });
  });
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
  container.append(title, state, check, releaseCheck, releaseInfo, verifyButton, verifyInfo, install);
  void refresh();
}
