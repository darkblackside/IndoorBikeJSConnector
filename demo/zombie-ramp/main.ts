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
import { buildActivity, encodeFit, encodeTcx, trackDistance, type Activity } from "./activity.ts";
import { CityScene, darkColors } from "./city.ts";
import {
  defaultRampConfig,
  ftpMargin,
  gapSurge,
  onStop,
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
/** ERG wanted by the rider (checkbox) and working on the connected device right now. */
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
  // ERG can stop or start working while connected (e.g. a watch paired to the same trainer takes control).
  b.on("control", () => {
    updateErgNote(b);
    syncErgHud();
  });
  return b;
}

/** The ERG option is only offered while ERG works with the connected trainer. */
function updateErgNote(b: IndoorBike) {
  const note = $("#erg-note");
  const connected = b.trainer.status === "connected";
  const works = b.trainer.capabilities.erg;
  note.hidden = !connected || works;
  note.textContent = b.trainer.controlDenied
    ? "ERG isn't available: another device (e.g. a watch paired to the trainer as a smart trainer) is controlling it. " +
      "Pair the watch to the trainer as a power sensor only, or reconnect after the watch let go. Until then match the target with gears and cadence."
    : "This device can't set a target wattage, so its power is only read: match the target with gears and cadence.";
  $("#cfg-erg-row").hidden = connected && !works;
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
      $("#sim-watch").textContent = "Watch takes control";
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
// A watch paired to the same trainer that grabs control (and, like strict FTMS trainers, won't hand it back).
$("#sim-watch").addEventListener("click", () => {
  if (!simTrainer) return;
  const taking = !simTrainer.state.otherHasControl;
  if (taking) {
    simTrainer.state.exclusiveControl = true;
    simTrainer.otherClient.takeControl();
  } else {
    simTrainer.otherClient.release();
  }
  $("#sim-watch").textContent = taking ? "Watch lets go" : "Watch takes control";
});
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
type Mode = "setup" | "waiting" | "riding" | "paused" | "done";
let mode: Mode = "setup";
let cfg: RampConfig = defaultRampConfig;
/** Whether this run wants the trainer to hold the target (ERG) or only reads the power. */
let ergMode = false;
/** ERG wanted and the trainer really holds the target right now (it can stop, e.g. when a watch takes control). */
const ergOn = () => ergMode && bike.trainer.ergActive;
let ergShown: boolean | undefined;
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
/** Wall-clock time the rider started; the exported activity starts here. */
let rideStart = new Date();
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

// --- screen wake lock: keep the screen on during the game (phones/tablets lock it otherwise) ---
let wakeLock: WakeLockSentinel | undefined;
async function keepScreenOn() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || (wakeLock && !wakeLock.released)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    // Not allowed (e.g. battery saver): the game still works, the screen may just turn off.
  }
}
function allowScreenOff() {
  void wakeLock?.release();
  wakeLock = undefined;
}
// The browser drops the lock whenever the page is hidden: take it again when the rider comes back.
document.addEventListener("visibilitychange", () => {
  if (mode === "waiting" || mode === "riding" || mode === "paused") void keepScreenOn();
});

$("#start").addEventListener("click", () => {
  void keepScreenOn();
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
  showPrompt("Start pedalling to begin", "Don't stop pedalling, or the zombies are going to get you!");
  $("#sim-panel").hidden = !useSim();
  ergMode = ergAvailable();
  ergShown = undefined;
  const first = rampStateAt(cfg, 0).target;
  // ERG: hold the first target already, so the trainer is ready when the rider starts.
  // Otherwise make sure no earlier target is left on the trainer and just read the power.
  if (ergMode) bike.setTargetPower(first);
  else bike.releaseControl();
  syncErgHud();
  $("#target").textContent = String(first);
  if (useSim()) {
    setSimCadence(90);
    setSimPower(first);
  }
});

function showPrompt(text: string, warn: string) {
  $("#prompt-text").textContent = text;
  $("#prompt-warn").textContent = warn;
  $("#prompt").hidden = false;
}

/** Show ERG only while it really works; otherwise the rider matches the target. */
function syncErgHud() {
  if (mode === "setup") return;
  const on = ergOn();
  if (on === ergShown) return;
  const before = ergShown;
  ergShown = on;
  $("#erg-badge").textContent = on ? "ERG" : "match it";
  $("#hint").hidden = on;
  $("#sim-power-row").hidden = on;
  if (ergMode && before !== undefined && mode === "riding") {
    banner(on ? "ERG is back" : "ERG lost (another device controls the trainer): match the target", 4000);
  }
}

/** Stopped during the warm-up: hold everything until the rider pedals again. */
function pause() {
  mode = "paused";
  recorder.truncate(elapsed);
  showPrompt("Warm-up paused", "Start pedalling to continue the warm-up");
  beep(440, 0.3);
}

$("#quit").addEventListener("click", () => {
  if (mode === "riding" || mode === "paused") finish("You ended the test.");
  else if (mode === "waiting") backToSetup();
});
$("#again").addEventListener("click", backToSetup);

function backToSetup() {
  mode = "setup";
  allowScreenOff();
  scene = new CityScene();
  $("#result").hidden = true;
  $("#hud").hidden = true;
  $("#setup").hidden = false;
  if (bike.trainer.status === "connected") bike.releaseControl();
  if (useSim()) setSimCadence(0);
}

function finish(reason: string) {
  mode = "done";
  allowScreenOff();
  // ERG: drop to an easy flat-road spin for the cool-down. Read-only: leave the trainer alone.
  if (ergMode && bike.trainer.status === "connected") bike.freeRide();
  if (useSim()) setSimCadence(0);
  beep(220, 0.5, 0.2);
  const result = recorder.result(elapsed);
  activity = buildActivity(recorder.samples, cfg, rideStart, elapsed);
  showResult(result, reason);
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
      rideStart = new Date();
      elapsed = 0;
      pedalElapsed = 0;
      stop.reset();
      $("#prompt").hidden = true;
      beep(880, 0.25);
    }
  } else if (mode === "paused") {
    // Warm-up on hold: the clock and the horde wait for the rider.
    shownGap = gap;
    scene.update(dt, 0, gap);
    renderHud("Warm-up paused", rampStateAt(cfg, elapsed), p3);
    if (fresh && stop.isPedalling(d.cadence, d.power)) {
      mode = "riding";
      pedalElapsed = elapsed;
      stop.reset();
      $("#prompt").hidden = true;
      banner("Warm-up continues");
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
    recorder.record(elapsed, d.power ?? 0, d.heartRate, fresh ? { cadence: d.cadence, speed: d.speed } : {});
    const vMe = speedFromPower(power);
    const vZed = speedFromPower(st.target);
    // Grace period after each target change while the power catches up: 4 s in ERG (the trainer adjusts, plus the
    // 3 s power average), 10 s without ERG (the rider has to notice the new target, shift and spin up).
    // Real seconds, not game seconds: the lag is real time even when the simulation is sped up.
    const graceSeconds = ergOn() ? 4 : 10;
    const grace = st.elapsed < graceSeconds * k && vMe < vZed;
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
      // The test ends (or the warm-up pauses) when the pedalling stopped, not when the stop was confirmed.
      elapsed = Math.min(elapsed, pedalElapsed);
      if (onStop(cfg, elapsed) === "pause") pause();
      else finish(quiet ? "The trainer stopped sending data." : "You stopped pedalling.");
    }
    if (mode === "riding") renderHud(st.phase === "warmup" ? "Warm-up" : `Step ${st.step + 1}`, st, p3);
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
  syncErgHud();
  const erg = ergOn();
  $("#power").classList.toggle("low", !erg && low);
  if (!erg) {
    const hint = $("#hint");
    const diff = p3 === undefined ? undefined : Math.round(st.target - p3);
    hint.className = `hint ${diff === undefined ? "" : diff > 5 ? "low" : diff < -5 ? "high" : "ok"}`;
    hint.textContent =
      diff === undefined ? "" : diff > 5 ? `▲ ${diff} W more` : diff < -5 ? `▼ ${-diff} W above target` : "on target";
  }
  $("#cadence").textContent = d.cadence === undefined ? "–" : String(Math.round(d.cadence));
  $("#hr").textContent = d.heartRate === undefined ? "–" : String(d.heartRate);
  $("#distance").textContent = (trackDistance(recorder.samples) / 1000).toFixed(2);
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
let activity: Activity | undefined;
let lastResult: RampResult | undefined;

function download(data: BlobPart, type: string, ext: string) {
  const d = rideStart;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const name = `zombie-ramp-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`;
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#dl-fit").addEventListener("click", () => {
  if (activity) download(encodeFit(activity), "application/vnd.ant.fit", "fit");
});
$("#dl-tcx").addEventListener("click", () => {
  if (!activity) return;
  const r = lastResult;
  const notes = r?.ftp === undefined ? "Zombie Ramp FTP test" : `Zombie Ramp FTP test: FTP ${r.ftp} W (last full step ${r.lastStepWatts} W)`;
  download(encodeTcx(activity, notes), "application/vnd.garmin.tcx+xml", "tcx");
});

function showResult(r: RampResult, reason: string) {
  $("#hud").hidden = true;
  $("#result").hidden = false;
  $("#result-reason").textContent = reason;
  $("#ftp").textContent = r.ftp === undefined ? "–" : String(r.ftp);
  const weight = $<HTMLInputElement>("#cfg-weight").valueAsNumber;
  $("#wkg").textContent = r.ftp !== undefined && weight > 0 ? `${(r.ftp / weight).toFixed(2)} W/kg` : "";
  const margin = r.ftp === undefined ? undefined : ftpMargin(r.ftp);
  $("#ftp-margin").textContent = margin === undefined ? "" : `± ${margin} W`;
  $("#ftp-note").textContent =
    r.ftp !== undefined
      ? `${r.lastStepWatts} W (last full minute) × ${cfg.ftpFactor} = ${r.ftp} W, likely between ${r.ftp - margin!} and ${r.ftp + margin!} W. ` +
        "A ramp test can be off by up to about 10 % from a 20- or 60-minute test. Strong sprinters tend to get a result " +
        "that's too high, endurance riders one that's too low. Compare tests on the same trainer for the best trend."
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
  lastResult = r;
  const s = activity?.summary;
  const or = (v: number | undefined, unit: string) => (v === undefined ? "–" : `${v} ${unit}`);
  $("#r-avg-power").textContent = or(s?.avgPower, "W");
  $("#r-avg-cadence").textContent = or(s?.avgCadence, "rpm");
  $("#r-avg-hr").textContent = or(s?.avgHeartRate, "bpm");
  $("#r-distance").textContent = s ? `${(s.distance / 1000).toFixed(2)} km` : "–";
  $("#r-work").textContent = s ? `${Math.round(s.work)} kJ` : "–";
  const empty = !activity?.points.length;
  for (const id of ["#dl-fit", "#dl-tcx"]) $<HTMLElementTagNameMap["bm-button"]>(id).disabled = empty;
  drawChart();
}

type Metric = "power" | "cadence" | "heartRate" | "distance";
let chartMetric: Metric = "power";
const METRICS: Record<Metric, { label: string; step: number; scale: number; empty: string }> = {
  power: { label: "Power", step: 100, scale: 1, empty: "No power recorded." },
  cadence: { label: "Cadence", step: 20, scale: 1, empty: "This device didn't report a cadence." },
  heartRate: { label: "Heart rate", step: 20, scale: 1, empty: "No heart rate recorded (connect a heart rate strap or watch)." },
  distance: { label: "Distance", step: 1, scale: 1 / 1000, empty: "No distance recorded." },
};

// Tabs above the chart: power (with the target), cadence, heart rate or distance.
const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tabs [role=tab]")];
function selectMetric(metric: Metric, focus = false) {
  chartMetric = metric;
  for (const t of tabs) {
    const on = t.dataset.metric === metric;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  $("#chart").setAttribute("aria-label", `${METRICS[metric].label} chart`);
  drawChart();
}
for (const t of tabs) {
  t.addEventListener("click", () => selectMetric(t.dataset.metric as Metric));
  t.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(t);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : undefined;
    if (next === undefined) return;
    e.preventDefault();
    selectMetric(tabs[(next + tabs.length) % tabs.length]!.dataset.metric as Metric, true);
  });
}
selectMetric("power");
window.addEventListener("resize", () => {
  if (mode === "done") drawChart();
});

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
  const points = activity?.points ?? [];
  const m = METRICS[chartMetric];
  const value = (p: (typeof points)[number]) => {
    const v = p[chartMetric];
    return v === undefined || (chartMetric === "cadence" && v === 0 && p.power === 0) ? undefined : v * m.scale;
  };
  const values = points.map(value).filter((v): v is number => v !== undefined);
  const empty = $("#chart-empty");
  empty.hidden = points.length < 2 || values.length > 0;
  empty.textContent = m.empty;
  if (points.length < 2 || !values.length) return;

  const targets = chartMetric === "power" ? points.map((p) => rampStateAt(cfg, p.t).target) : [];
  const vMax = Math.max(...values, ...targets) * 1.1 || 1;
  // Heart rate lives far from zero: start the axis just below the lowest value so the curve is readable.
  const vMin = chartMetric === "heartRate" ? Math.max(0, Math.floor((Math.min(...values) - 10) / m.step) * m.step) : 0;
  const tMax = points.at(-1)!.t || 1;
  const X = (t: number) => 30 + (t / tMax) * (w - 36);
  const Y = (v: number) => h - 18 - ((v - vMin) / (vMax - vMin)) * (h - 28);
  g.font = "11px system-ui";
  g.fillStyle = "#93a0ad";
  g.strokeStyle = "#2a323c";
  g.lineWidth = 1;
  const step = chartMetric === "distance" && vMax > 8 ? Math.ceil(vMax / 5) : m.step;
  for (let v = vMin; v < vMax; v += step) {
    g.beginPath();
    g.moveTo(30, Y(v));
    g.lineTo(w, Y(v));
    g.stroke();
    g.fillText(String(v), 0, Y(v) + 4);
  }
  if (cfg.warmupSeconds > 0 && tMax > cfg.warmupSeconds) {
    g.fillText("warm-up", X(cfg.warmupSeconds / 2) - 20, h - 4);
    g.fillText("ramp", X((cfg.warmupSeconds + tMax) / 2) - 12, h - 4);
  }
  /** Draw a line; gaps (no value) break it. */
  const plot = (ys: (number | undefined)[], color: string, width: number) => {
    g.beginPath();
    let pen = false;
    ys.forEach((y, i) => {
      if (y === undefined) return void (pen = false);
      if (pen) g.lineTo(X(points[i]!.t), Y(y));
      else g.moveTo(X(points[i]!.t), Y(y));
      pen = true;
    });
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  };
  if (targets.length) plot(targets, "#ff3b3b", 2);
  plot(points.map(value), chartMetric === "heartRate" ? "#ff7ab6" : "#40e0d0", 1.5);
}

requestAnimationFrame(frame);
