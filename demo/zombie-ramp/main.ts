// UI: @darkblackside/ui with the gamification theme, for the controls and buttons only (the city is a canvas).
import "@darkblackside/ui/themes/gamification.css";
import "@darkblackside/ui/base.css";
import "@darkblackside/ui/button.js";
import "@darkblackside/ui/field.js";
import "@darkblackside/ui/check.js";
import "@darkblackside/ui/fieldset.js";
import "@darkblackside/ui/notice.js";
import "@darkblackside/ui/tag.js";
import "./style.css";
import { IndoorBike, type ProtocolName } from "../../src/index.ts";
import {
  createSimulatedHeartRateMonitor,
  createSimulatedTrainer,
  FakeBluetooth,
  type SimulatedTrainer,
} from "../../testing/index.ts";
import { CityScene, darkColors } from "./city.ts";
import {
  defaultRampConfig,
  gapSurge,
  RampRecorder,
  restGapForCadence,
  rampStateAt,
  speedFromPower,
  StopDetector,
  type RampConfig,
  type RampResult,
} from "./ramp.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const num = (sel: string, fallback: number) => {
  const v = $<HTMLInputElement>(sel).valueAsNumber;
  return Number.isFinite(v) ? v : fallback;
};
const mmss = (s: number) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** How strongly a speed difference moves the horde (makes power deficits felt quickly). */
const GAP_GAIN = 3;
const START_GAP = 50;
const MAX_GAP = 120;
/** Seconds over which the cadence is averaged before it moves the horde (cadence readings jump around). */
const CADENCE_SMOOTHING = 2;
/** How quickly the horde moves to its new resting distance after a cadence change (1/s; ~2.5 s to settle mostly). */
const REST_RATE = 0.4;

// --- devices -------------------------------------------------------------------------
const fake = new FakeBluetooth();
let simTrainer: SimulatedTrainer | undefined;
const simHrm = fake.add(createSimulatedHeartRateMonitor());
const source = () => $<HTMLInputElement>('input[name="source"]:checked').value;
const useSim = () => source() !== "real";
const simProtocol = (): ProtocolName => (source() === "sim-pm" ? "cycling-power" : "ftms");
/** ERG wanted by the rider (checkbox) and possible with the connected device. */
const ergAvailable = () => $<HTMLInputElement>("#cfg-erg").checked && bike.trainer.capabilities.erg;

if (!("bluetooth" in navigator)) {
  $<HTMLInputElement>('input[name="source"][value="sim"]').checked = true;
  $("#bt-warning").hidden = false;
  $("#bt-warning").textContent = "Web Bluetooth isn't available in this browser (use Chrome or Edge). Simulated trainer selected.";
}

let lastDataAt = 0;
const powerWindow: { t: number; p: number }[] = [];
let bike = createBike();

function createBike(): IndoorBike {
  const b = new IndoorBike({
    bluetooth: useSim() ? fake.asBluetooth() : undefined,
    rider: { riderWeight: num("#cfg-weight", 75) },
  });
  b.on("data", (d) => {
    const now = performance.now() / 1000;
    if (d.power !== undefined || d.cadence !== undefined) lastDataAt = now;
    if (d.power !== undefined) powerWindow.push({ t: now, p: d.power });
  });
  b.on("status", ({ device, status }) => {
    const t = device === "trainer";
    const el = $(t ? "#trainer-status" : "#hrm-status");
    const name = (t ? b.trainer : b.heartRateMonitor).deviceName;
    el.dataset.s = status;
    el.textContent = status + (name && status !== "disconnected" ? ` – ${name}` : "");
    if (t) updateErgNote(b);
    $(t ? "#connect-trainer" : "#connect-hrm").textContent =
      status === "disconnected" ? (t ? "Connect trainer" : "Connect heart rate (optional)") : "Disconnect";
    $<HTMLElementTagNameMap["bm-button"]>("#start").disabled = b.trainer.status !== "connected";
  });
  return b;
}

function updateErgNote(b: IndoorBike) {
  const note = $("#erg-note");
  const connected = b.trainer.status === "connected";
  note.hidden = !connected || b.trainer.capabilities.erg;
  note.textContent = "This device can't set a target wattage, so its power is only read: match the target with gears and cadence.";
  $<HTMLInputElement>("#cfg-erg").disabled = connected && !b.trainer.capabilities.erg;
}

for (const r of document.querySelectorAll<HTMLInputElement>('input[name="source"]')) {
  r.addEventListener("change", () => {
    bike.disconnect();
    bike = createBike();
  });
}

async function toggle(kind: "trainer" | "hrm") {
  const sensor = kind === "trainer" ? bike.trainer : bike.heartRateMonitor;
  if (sensor.status !== "disconnected") return sensor.disconnect();
  if (useSim()) {
    if (kind === "trainer" && simTrainer?.protocol !== simProtocol()) {
      if (simTrainer) {
        simTrainer.stop();
        fake.devices.splice(fake.devices.indexOf(simTrainer.device), 1);
      }
      const pm = simProtocol() === "cycling-power";
      simTrainer = fake.add(createSimulatedTrainer(simProtocol(), pm ? "Simulated power meter" : "Simulated KICKR"));
      simTrainer.state.cadence = 0;
      simTrainer.state.riderPower = Number($<HTMLInputElement>("#sim-power").value);
      simTrainer.start(250);
    }
    if (kind === "hrm") simHrm.start(1000);
  }
  try {
    await sensor.connect();
  } catch (e) {
    const err = e as Error;
    if (err.name !== "NotFoundError") alert(`Connection failed: ${err.message}`);
  }
}
$("#connect-trainer").addEventListener("click", () => toggle("trainer"));
$("#connect-hrm").addEventListener("click", () => toggle("hrm"));

// Simulated rider controls
const setSimCadence = (v: number) => {
  $<HTMLInputElement>("#sim-cadence").value = String(v);
  $("#sim-cadence-v").textContent = String(v);
  if (simTrainer) simTrainer.state.cadence = v;
};
$<HTMLInputElement>("#sim-cadence").addEventListener("input", (e) => setSimCadence(Number((e.target as HTMLInputElement).value)));
$("#sim-stop").addEventListener("click", () => setSimCadence(0));
// Rider's own power, used when the trainer is not holding an ERG target.
const setSimPower = (v: number) => {
  $<HTMLInputElement>("#sim-power").value = String(v);
  $("#sim-power-v").textContent = String(v);
  if (simTrainer) simTrainer.state.riderPower = v;
};
$<HTMLInputElement>("#sim-power").addEventListener("input", (e) => setSimPower(Number((e.target as HTMLInputElement).value)));
// Fast-forward for testing: how many test seconds pass per real second (simulated trainer only).
let simSpeed = 1;
$<HTMLInputElement>("#sim-speed").addEventListener("input", (e) => {
  simSpeed = Number((e.target as HTMLInputElement).value);
  $("#sim-speed-v").textContent = String(simSpeed);
});
const timeScale = () => (useSim() ? simSpeed : 1);

// --- sound -------------------------------------------------------------------------------
let audio: AudioContext | undefined;
let muted = false;
function beep(freq: number, duration = 0.12, volume = 0.15) {
  if (!audio || muted) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.frequency.value = freq;
  o.type = "square";
  g.gain.setValueAtTime(volume, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + duration);
}
$("#mute").addEventListener("click", () => {
  muted = !muted;
  $("#mute").textContent = muted ? "🔇" : "🔊";
});

// --- game state ----------------------------------------------------------------------
type Mode = "setup" | "waiting" | "riding" | "done";
let mode: Mode = "setup";
let cfg: RampConfig = defaultRampConfig;
/** Whether this run lets the trainer hold the target (ERG) or only reads the power. */
let ergMode = false;
let scene = new CityScene();
let recorder = new RampRecorder(cfg);
const stop = new StopDetector();
/** Test time in seconds (game clock: runs faster than real time when the simulation is sped up). */
let elapsed = 0;
/** Test time when the rider was last seen pedalling; the test ends there, not when the stop was confirmed. */
let pedalElapsed = 0;
let gap = START_GAP;
/** The gap as drawn and shown: `gap` plus a small surge. Only `gap` decides whether they catch you. */
let shownGap = START_GAP;
/** Smoothed cadence; undefined until the device reports one (then the horde rests at 50 m as at 90 rpm). */
let cadenceAvg: number | undefined;
let currentStep = -2;
let lastCountdown = -1;
let bannerTimer: ReturnType<typeof setTimeout> | undefined;

function power3s(now: number): number | undefined {
  while (powerWindow.length && powerWindow[0]!.t < now - 3) powerWindow.shift();
  if (!powerWindow.length || now - lastDataAt > 3) return undefined;
  return powerWindow.reduce((a, b) => a + b.p, 0) / powerWindow.length;
}

function banner(text: string, ms = 2500) {
  const el = $("#banner");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove("show"), ms);
}

$("#start").addEventListener("click", () => {
  audio ??= new AudioContext();
  void audio.resume();
  cfg = {
    ...defaultRampConfig,
    warmupSeconds: Number($<HTMLSelectElement>("#cfg-warmup").value),
    warmupWatts: num("#cfg-warmup-w", 100),
    startWatts: num("#cfg-start", 100),
    stepWatts: Number($<HTMLSelectElement>("#cfg-step").value),
  };
  scene = new CityScene();
  recorder = new RampRecorder(cfg);
  gap = START_GAP;
  shownGap = START_GAP;
  cadenceAvg = undefined;
  currentStep = -2;
  elapsed = 0;
  mode = "waiting";
  $("#setup").hidden = true;
  $("#hud").hidden = false;
  $("#prompt").hidden = false;
  $("#sim-panel").hidden = !useSim();
  ergMode = ergAvailable();
  $("#erg-badge").textContent = ergMode ? "ERG" : "match it";
  $("#hint").hidden = ergMode;
  $("#sim-power-row").hidden = ergMode;
  const first = rampStateAt(cfg, 0).target;
  // ERG: hold the first target already, so the trainer is ready when the rider starts.
  // Otherwise make sure no earlier target is left on the trainer and just read the power.
  if (ergMode) bike.setTargetPower(first);
  else bike.releaseControl();
  $("#target").textContent = String(first);
  if (useSim()) {
    setSimCadence(90);
    setSimPower(first);
  }
});

$("#quit").addEventListener("click", () => {
  if (mode === "riding") finish("You ended the test.");
  else if (mode === "waiting") backToSetup();
});
$("#again").addEventListener("click", backToSetup);

function backToSetup() {
  mode = "setup";
  scene = new CityScene();
  $("#result").hidden = true;
  $("#hud").hidden = true;
  $("#setup").hidden = false;
  if (bike.trainer.status === "connected") bike.releaseControl();
  if (useSim()) setSimCadence(0);
}

function finish(reason: string) {
  mode = "done";
  // ERG: drop to an easy flat-road spin for the cool-down. Read-only: leave the trainer alone.
  if (ergMode && bike.trainer.status === "connected") bike.freeRide();
  if (useSim()) setSimCadence(0);
  beep(220, 0.5, 0.2);
  showResult(recorder.result(elapsed), reason);
}

// --- loop ----------------------------------------------------------------------------
let prev = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000;
  const realDt = now - prev;
  const dt = Math.min(0.1, realDt);
  prev = now;
  const d = bike.data;
  const p3 = power3s(now);
  const fresh = now - lastDataAt < 3;

  if (mode === "setup") {
    // Attract mode: drive around with a small horde.
    const v = 7;
    scene.update(dt, v * dt, START_GAP);
  } else if (mode === "waiting") {
    shownGap = gap;
    scene.update(dt, 0, gap);
    renderHud("Get ready", rampStateAt(cfg, 0), p3);
    if (fresh && stop.isPedalling(d.cadence, d.power)) {
      mode = "riding";
      elapsed = 0;
      pedalElapsed = 0;
      stop.reset();
      $("#prompt").hidden = true;
      beep(880, 0.25);
    }
  } else if (mode === "riding") {
    const k = timeScale();
    elapsed += realDt * k;
    /** Game-time step for the chase physics. */
    const gdt = dt * k;
    const st = rampStateAt(cfg, elapsed);
    if (st.step !== currentStep) {
      if (ergMode) bike.setTargetPower(st.target);
      if (currentStep === -2) banner("Don't stop pedalling!", 4000);
      else if (st.phase === "warmup") banner(`Warm-up · ${st.target} W`);
      else {
        banner(st.step === 0 ? `Ramp! ${st.target} W` : `${st.target} W · they're getting faster`);
        scene.addZombies(2 + Math.floor(st.step / 2));
        beep(1320, 0.3);
      }
      currentStep = st.step;
    }
    const secLeft = Math.ceil(st.remaining);
    if (secLeft <= 3 && secLeft !== lastCountdown) beep(660);
    lastCountdown = secLeft;

    const power = p3 ?? 0;
    recorder.record(elapsed, d.power ?? 0, d.heartRate);
    const vMe = speedFromPower(power);
    const vZed = speedFromPower(st.target);
    // Small grace period after each target change while the trainer adjusts.
    const grace = st.elapsed < 4 && vMe < vZed;
    if (!grace) gap = Math.min(MAX_GAP, gap + (vMe - vZed) * GAP_GAIN * gdt);
    // While you hold the target the horde settles at a distance set by your cadence: 50 m at 90 rpm or more,
    // 10 m at 40 rpm. Holding the power never gets you caught, but grinding lets them close in.
    if (d.cadence !== undefined && fresh) {
      cadenceAvg = cadenceAvg === undefined ? d.cadence : cadenceAvg + (d.cadence - cadenceAvg) * (1 - Math.exp(-gdt / CADENCE_SMOOTHING));
    }
    if (vMe >= vZed * 0.99) gap += (restGapForCadence(cadenceAvg ?? 90) - gap) * (1 - Math.exp(-gdt * REST_RATE));
    // A little action: the horde surges and drops back by up to ~5 m (less when it is very close).
    shownGap = Math.max(0.5, gap + gapSurge(elapsed) * Math.min(1, gap / 20));
    scene.update(gdt, vMe * gdt, Math.max(0, shownGap));

    const stopped = stop.update(now, d.cadence, d.power, fresh);
    if (stop.lastPedallingAt === now) pedalElapsed = elapsed;
    if (gap <= 0) finish("The zombies caught you.");
    else if (stopped) {
      // Many trainers go quiet once the flywheel stops, so stale data after low cadence = stopped too.
      const quiet = !fresh && stop.isPedalling(d.cadence, d.power);
      // The test ends when the pedalling stopped, not when the stop was confirmed.
      elapsed = Math.min(elapsed, pedalElapsed);
      finish(quiet ? "The trainer stopped sending data." : "You stopped pedalling.");
    }
    renderHud(st.phase === "warmup" ? "Warm-up" : `Step ${st.step + 1}`, st, p3);
  } else {
    scene.update(dt, 0, Math.max(0, shownGap - dt * 8));
  }

  draw();
  requestAnimationFrame(frame);
}

function renderHud(label: string, st: ReturnType<typeof rampStateAt>, p3: number | undefined) {
  const d = bike.data;
  const total = st.phase === "warmup" ? cfg.warmupSeconds : cfg.stepSeconds;
  $("#phase-label").textContent = label;
  $("#phase-time").textContent = mmss(st.remaining);
  $("#phase-bar").style.width = `${(st.elapsed / total) * 100}%`;
  $("#phase-next").textContent = `next: ${st.nextTarget} W · total ${mmss(elapsed)}`;
  $("#power").textContent = p3 === undefined ? "–" : String(Math.round(p3));
  $("#target").textContent = String(st.target);
  // Without ERG the rider has to hit the target: show how far off they are.
  const low = p3 !== undefined && p3 < st.target * 0.95;
  $("#power").classList.toggle("low", !ergMode && low);
  if (!ergMode) {
    const hint = $("#hint");
    const diff = p3 === undefined ? undefined : Math.round(st.target - p3);
    hint.className = `hint ${diff === undefined ? "" : diff > 5 ? "low" : diff < -5 ? "high" : "ok"}`;
    hint.textContent =
      diff === undefined ? "" : diff > 5 ? `▲ ${diff} W more` : diff < -5 ? `▼ ${-diff} W above target` : "on target";
  }
  $("#cadence").textContent = d.cadence === undefined ? "–" : String(Math.round(d.cadence));
  $("#hr").textContent = d.heartRate === undefined ? "–" : String(d.heartRate);
  $("#gap").textContent = String(Math.max(0, Math.round(shownGap)));
  $("#gap").style.color = shownGap < 20 ? "var(--zed)" : "";
  $("#horde").textContent = String(scene.horde.length);
}

const canvas = $<HTMLCanvasElement>("#city");
const ctx = canvas.getContext("2d")!;
function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const danger = mode === "riding" ? Math.max(0, Math.min(1, (25 - gap) / 25)) : 0;
  scene.draw(ctx, w, h, darkColors, danger);
}

// --- result ----------------------------------------------------------------------------
function showResult(r: RampResult, reason: string) {
  $("#hud").hidden = true;
  $("#result").hidden = false;
  $("#result-reason").textContent = reason;
  $("#ftp").textContent = r.ftp === undefined ? "–" : String(r.ftp);
  const weight = $<HTMLInputElement>("#cfg-weight").valueAsNumber;
  $("#wkg").textContent = r.ftp !== undefined && weight > 0 ? `${(r.ftp / weight).toFixed(2)} W/kg` : "";
  $("#ftp-note").textContent =
    r.ftp !== undefined
      ? `${r.lastStepWatts} W (last full minute) × ${cfg.ftpFactor} = ${r.ftp} W`
      : r.endedInWarmup
        ? "The test ended during the warm-up, so there's no FTP yet."
        : "No ramp step was completed, so there's no FTP yet.";
  const w = (v: number | undefined) => (v === undefined ? "–" : `${v} W`);
  $("#r-last").textContent = w(r.lastStepWatts);
  $("#r-steps").textContent = String(r.completedSteps);
  $("#r-best").textContent = w(r.bestMinutePower);
  $("#r-max").textContent = w(r.maxPower);
  $("#r-hr").textContent = r.maxHeartRate === undefined ? "–" : `${r.maxHeartRate} bpm`;
  $("#r-time").textContent = mmss(r.duration);
  drawChart();
}

function drawChart() {
  const c = $<HTMLCanvasElement>("#chart");
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = 180;
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const s = recorder.samples;
  if (s.length < 2) return;
  const tMax = s.at(-1)!.t || 1;
  const pMax = Math.max(...s.map((x) => Math.max(x.power, x.target))) * 1.1 || 1;
  const X = (t: number) => 30 + (t / tMax) * (w - 36);
  const Y = (p: number) => h - 18 - (p / pMax) * (h - 28);
  g.font = "11px system-ui";
  g.fillStyle = "#93a0ad";
  g.strokeStyle = "#2a323c";
  g.lineWidth = 1;
  for (let p = 0; p < pMax; p += 100) {
    g.beginPath();
    g.moveTo(30, Y(p));
    g.lineTo(w, Y(p));
    g.stroke();
    g.fillText(String(p), 0, Y(p) + 4);
  }
  if (cfg.warmupSeconds > 0 && tMax > cfg.warmupSeconds) {
    g.fillText("warm-up", X(cfg.warmupSeconds / 2) - 20, h - 4);
    g.fillText("ramp", X((cfg.warmupSeconds + tMax) / 2) - 12, h - 4);
  }
  const plot = (key: "power" | "target", color: string, width: number) => {
    g.beginPath();
    s.forEach((x, i) => (i ? g.lineTo(X(x.t), Y(x[key])) : g.moveTo(X(x.t), Y(x[key]))));
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  };
  plot("target", "#ff3b3b", 2);
  plot("power", "#40e0d0", 1.5);
}

requestAnimationFrame(frame);
