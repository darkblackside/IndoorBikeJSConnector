import "./style.css";
import { IndoorBike, type ProtocolName } from "../src/index.ts";
import {
  createSimulatedHeartRateMonitor,
  createSimulatedTrainer,
  FakeBluetooth,
  type SimulatedTrainer,
} from "../testing/index.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const log = (msg: string) => {
  const el = $("#log");
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n${el.textContent}`.slice(0, 20000);
};

// --- device source: real Web Bluetooth or simulated devices ---------------------
const fake = new FakeBluetooth();
let simTrainer: SimulatedTrainer | undefined;
const simHrm = fake.add(createSimulatedHeartRateMonitor());
simHrm.start(1000);
const useSim = () => $<HTMLInputElement>('input[name="source"][value="sim"]').checked;

$("#bt-support").textContent = "bluetooth" in navigator ? "" : "Web Bluetooth not available here – use Simulated, or Chrome/Edge.";
if (!("bluetooth" in navigator)) $<HTMLInputElement>('input[name="source"][value="sim"]').checked = true;

let bike = createBike();

function createBike(): IndoorBike {
  const b = new IndoorBike({
    bluetooth: useSim() ? fake.asBluetooth() : undefined,
    rider: { riderWeight: Number($<HTMLInputElement>("#weight").value) || 75 },
  });
  b.on("data", render);
  b.on("status", ({ device, status }) => {
    const t = device === "trainer";
    const el = $(t ? "#trainer-status" : "#hrm-status");
    const name = (t ? b.trainer : b.heartRateMonitor).deviceName;
    el.dataset.s = status;
    el.textContent =
      status +
      (name && status !== "disconnected" ? ` – ${name}` : "") +
      (t && status === "connected"
        ? ` – protocol ${b.trainer.protocolName}, ERG ${yes(b.trainer.capabilities.erg)}, SIM ${yes(b.trainer.capabilities.simulation)}`
        : "");
    $(t ? "#connect-trainer" : "#connect-hrm").textContent =
      status === "disconnected" ? (t ? "Connect trainer" : "Connect heart rate") : "Disconnect";
    log(`${device}: ${status}`);
  });
  b.on("error", ({ device, error }) => log(`${device} error: ${error.message}`));
  return b;
}
const yes = (v: boolean) => (v ? "yes" : "no");

function syncSource() {
  const sim = useSim();
  $<HTMLSelectElement>("#sim-protocol").disabled = !sim;
  $("#sim-controls").hidden = !sim;
  bike.disconnect();
  bike = createBike();
  render();
}
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="source"]')) r.addEventListener("change", syncSource);

function prepareSimTrainer() {
  const protocol = $<HTMLSelectElement>("#sim-protocol").value as ProtocolName;
  if (simTrainer?.protocol === protocol) return;
  if (simTrainer) {
    simTrainer.stop();
    fake.devices.splice(fake.devices.indexOf(simTrainer.device), 1);
  }
  simTrainer = fake.add(createSimulatedTrainer(protocol));
  simTrainer.state.cadence = Number($<HTMLInputElement>("#sim-cadence").value);
  simTrainer.start(250);
}

// --- connect buttons ---------------------------------------------------------------
async function toggle(kind: "trainer" | "hrm") {
  const sensor = kind === "trainer" ? bike.trainer : bike.heartRateMonitor;
  if (sensor.status !== "disconnected") return sensor.disconnect();
  if (useSim() && kind === "trainer") prepareSimTrainer();
  try {
    await sensor.connect();
  } catch (e) {
    const err = e as Error;
    log(err.name === "NotFoundError" ? "chooser cancelled" : `connect failed: ${err.message}`);
  }
}
$("#connect-trainer").addEventListener("click", () => toggle("trainer"));
$("#connect-hrm").addEventListener("click", () => toggle("hrm"));

$<HTMLInputElement>("#sim-cadence").addEventListener("input", (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $("#sim-cadence-v").textContent = String(v);
  if (simTrainer) simTrainer.state.cadence = v;
});
$("#sim-drop").addEventListener("click", () => simTrainer?.device.drop());

// --- control -----------------------------------------------------------------------
const ergInput = $<HTMLInputElement>("#erg");
const setErg = (w: number) => {
  ergInput.value = String(Math.max(0, w));
  bike.setTargetPower(Math.max(0, w));
  render();
};
$("#erg-set").addEventListener("click", () => setErg(ergInput.valueAsNumber || 0));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-erg-step]")) {
  b.addEventListener("click", () => setErg((ergInput.valueAsNumber || 0) + Number(b.dataset.ergStep)));
}
const applySim = () => {
  const grade = Number($<HTMLInputElement>("#grade").value);
  $("#grade-v").textContent = grade.toFixed(1);
  // Called on every slider movement on purpose: the library coalesces the updates.
  bike.setSimulation({ grade, windSpeed: Number($<HTMLInputElement>("#wind").value) || 0 });
  render();
};
$("#grade").addEventListener("input", applySim);
$("#wind").addEventListener("change", applySim);
$("#free-ride").addEventListener("click", () => {
  $<HTMLInputElement>("#grade").value = "0";
  $("#grade-v").textContent = "0.0";
  bike.freeRide();
  render();
});
$("#weight").addEventListener("change", (e) =>
  bike.trainer.setRider({ riderWeight: Number((e.target as HTMLInputElement).value) || 75 }),
);

// --- render ------------------------------------------------------------------------
const fmt = (v: number | undefined, d = 0) => (v === undefined ? "–" : v.toFixed(d));
function render() {
  const d = bike.data;
  $("#power").textContent = fmt(d.power);
  $("#cadence").textContent = fmt(d.cadence);
  $("#speed").textContent = fmt(d.speed, 1);
  $("#heartRate").textContent = fmt(d.heartRate);
  $("#distance").textContent = fmt(d.distance);
  const m = bike.trainer.mode;
  $("#mode").textContent =
    m.kind === "erg" ? `ERG ${m.watts} W` : m.kind === "simulation" ? `SIM ${m.params.grade.toFixed(1)} %` : "none";
}

syncSource();
