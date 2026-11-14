import "./style.css";
import { DeviceManager } from "./deviceManager.ts";
import type { Sensor } from "./devices/sensor.ts";
import { Store, type State } from "./store.ts";

const store = new Store();
const devices = new DeviceManager(store);

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
};

const supported = "bluetooth" in navigator;
$("#unsupported").hidden = supported;

function bindConnectButton(button: HTMLButtonElement, sensor: Sensor) {
  button.disabled = !supported;
  button.addEventListener("click", async () => {
    if (sensor.connected) {
      sensor.disconnect();
      return;
    }
    try {
      await sensor.connect();
    } catch (error) {
      const err = error as DOMException;
      // NotFoundError = user closed the chooser; not worth shouting about.
      if (err.name !== "NotFoundError") store.log(`Connection failed: ${err.message}`);
    }
  });
}
bindConnectButton($<HTMLButtonElement>("#connect-trainer"), devices.trainer);
bindConnectButton($<HTMLButtonElement>("#connect-hrm"), devices.heartRateMonitor);

// --- target power controls -------------------------------------------------
const targetInput = $<HTMLInputElement>("#target");
const ftpInput = $<HTMLInputElement>("#ftp");
ftpInput.value = String(store.get().ftp);

function clampTarget(watts: number): number {
  const range = store.get().powerRange;
  const min = range?.min ?? 0;
  const max = range?.max ?? 2000;
  return Math.min(max, Math.max(min, Math.round(watts)));
}

function setTarget(watts: number) {
  const target = clampTarget(watts);
  targetInput.value = String(target);
  store.update({ targetPower: target });
}

$("#target-set").addEventListener("click", () => {
  const value = targetInput.valueAsNumber;
  if (Number.isFinite(value)) setTarget(value);
});
targetInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#target-set").click();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-step]")) {
  button.addEventListener("click", () => {
    const base = store.get().targetPower ?? (targetInput.valueAsNumber || store.get().ftp * 0.6);
    setTarget(base + Number(button.dataset.step));
  });
}
$("#target-off").addEventListener("click", () => store.update({ targetPower: undefined }));
ftpInput.addEventListener("change", () => {
  const ftp = ftpInput.valueAsNumber;
  if (Number.isFinite(ftp) && ftp > 0) store.update({ ftp: Math.round(ftp) });
});

// --- rendering ---------------------------------------------------------------
const fmt = (value: number | undefined, digits = 0) => (value === undefined ? "–" : value.toFixed(digits));
const labels: Record<"trainer" | "heartRateMonitor", string> = {
  trainer: "Trainer",
  heartRateMonitor: "Heart rate",
};

function render(state: Readonly<State>) {
  $("#power").textContent = fmt(state.power);
  $("#cadence").textContent = fmt(state.cadence);
  $("#speed").textContent = fmt(state.speed, 1);
  $("#heartRate").textContent = fmt(state.heartRate);

  for (const key of ["trainer", "heartRateMonitor"] as const) {
    const { status, name } = state[key];
    $(`[data-status-dot="${key}"]`).dataset.status = status;
    $(`[data-status-text="${key}"]`).textContent = `${labels[key]}: ${status}${name ? ` (${name})` : ""}`;
  }
  $("#connect-trainer").textContent = state.trainer.status === "disconnected" ? "Connect trainer" : "Disconnect";
  $("#connect-hrm").textContent =
    state.heartRateMonitor.status === "disconnected" ? "Connect heart rate" : "Disconnect";

  const ergOn = state.ergAvailable && state.targetPower !== undefined;
  const badge = $("#erg-state");
  badge.textContent = ergOn
    ? `on · ${state.targetPower} W`
    : state.targetPower !== undefined
      ? `pending · ${state.targetPower} W`
      : "off";
  badge.classList.toggle("on", ergOn);
  $("#target-ftp").textContent =
    state.targetPower === undefined ? "–" : `${Math.round((state.targetPower / state.ftp) * 100)} %`;
  $("#power-range").textContent = state.powerRange
    ? `Trainer range ${state.powerRange.min}–${state.powerRange.max} W`
    : "";
  $("#log").textContent = state.log.join("\n");
}

store.subscribe(render);
render(store.get());
