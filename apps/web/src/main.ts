import "./styles.css";
import { getHealth } from "./api/client.js";
import { renderHome } from "./pages/home.js";
import { HealthStore } from "./state/health.js";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing #app root");

const store = new HealthStore();
const render = () => { root.innerHTML = renderHome(store.get()); };
store.subscribe(render);
render();

getHealth()
  .then((health) => store.set({ kind: "ready", health }))
  .catch((error: unknown) => store.set({ kind: "error", message: error instanceof Error ? error.message : String(error) }));
