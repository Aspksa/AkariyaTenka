import "./styles.css";
import { mountAssistantAvatar } from "./features/assistant-chat.js";
import { getHealth } from "./api/health.js";
import { createHomeView } from "./pages/home.js";
import { FrameBatcher } from "./runtime/frame-batcher.js";
import { HealthStore, type HealthState } from "./state/health.js";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing #app root");

const store = new HealthStore();
const view = createHomeView();
root.replaceChildren(view.element);
mountAssistantAvatar();

const updates = new FrameBatcher<HealthState>((state) => view.update(state));
store.subscribe((state) => updates.push(state));
view.update(store.get());

getHealth()
  .then((health) => store.set({ kind: "ready", health }))
  .catch((error: unknown) => store.set({
    kind: "error",
    message: error instanceof Error ? error.message : String(error)
  }));
