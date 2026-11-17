// UI: @darkblackside/ui with the gamification theme, for the controls and buttons only (the world is three.js).
import "@darkblackside/ui/themes/gamification.css";
import "@darkblackside/ui/base.css";
import "@darkblackside/ui/button.js";
import "@darkblackside/ui/field.js";
import "@darkblackside/ui/check.js";
import "@darkblackside/ui/fieldset.js";
import "@darkblackside/ui/notice.js";
import "@darkblackside/ui/tag.js";
import "./style.css";
import { IndoorBike, type ProtocolName, type SpinDownProgress } from "indoor-bike-js-connector";
import { spinDownText } from "../common/spinDown.ts";
import {
  createSimulatedHeartRateMonitor,
  createSimulatedTrainer,
  FakeBluetooth,
  type SimulatedTrainer,
} from "indoor-bike-js-connector/testing";
import {
  buildActivity,
  encodeFit,
  encodeTcx,
  speedFromPower,
  StopDetector,
  trackDistance,
  type Activity,
} from "@indoor-bike/game-core/zombie-ramp";
import {
  defaultFtp20Config,
  Ftp20Recorder,
  ftp20Result,
  Ftp20Session,
  heartRateGuide,
  heartRatePercent,
  maxHeartRate,
  PacingCoach,
  pacingSummary,
  PHASE_SECONDS,
  planBlocks,
  resultNote,
  STRONG_BAND,
  type Block,
  type Ftp20Config,
  type Ftp20Event,
  type Ftp20Phase,
  type Ftp20Result,
} from "@indoor-bike/game-core/ftp20";
import { RunnerScene } from "./runnerScene.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const num = (sel: string, fallback: number) => {
  const v = $<HTMLInputElement>(sel).valueAsNumber;
  return Number.isFinite(v) ? v : fallback;
};
const optNum = (sel: string) => {
  const v = $<HTMLInputElement>(sel).valueAsNumber;
  return Number.isFinite(v) ? v : undefined;
};
const mmss = (s: number) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const PHASE_NAME: Record<Ftp20Phase, string> = { warmup: "Warm-up", test: "20-min test", cooldown: "Cool-down" };
/** Scenery changes every 5 minutes of riding (and when the test starts). */
const SCENERY_SECONDS = 5 * 60;
/** Speed of the attract-mode ride behind the setup panel, m/s. */
const ATTRACT_SPEED = 8;

// --- devices (same set-up as the Zombie Ramp) ---------------------------------------------
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
    if (b.trainer.spinningDown) syncSpinDown(b);
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
    syncSpinDown(b);
  });
  b.on("spinDown", (p) => {
    spinDownProgress = p;
    syncSpinDown(b);
    if (useSim() && p.phase === "speed-up") setSimCadence(90);
    if (useSim() && p.phase === "coast") setTimeout(() => setSimCadence(0), 1500);
  });
  // ERG can stop or start working while connected (e.g. a watch paired to the same trainer takes control).
  b.on("control", () => {
    updateErgNote(b);
    syncErgHud();
  });
  return b;
}

// --- spin-down calibration (before the test) ---------------------------------------------
let spinDownProgress: SpinDownProgress | undefined;
function syncSpinDown(b: IndoorBike) {
  const busy = b.trainer.spinningDown;
  $("#spindown-row").hidden = !b.trainer.spinDownSupported;
  $("#spindown").textContent = busy ? "Cancel spin-down" : "Calibrate (spin-down)";
  $("#spindown-status").textContent = spinDownProgress
    ? spinDownText(spinDownProgress, b.data.speed)
    : "Recommended after a 10-minute warm-up, for accurate power.";
  $("#spindown-status").classList.toggle("muted", !busy);
  $<HTMLElementTagNameMap["bm-button"]>("#start").disabled = b.trainer.status !== "connected" || busy;
}
$("#spindown").addEventListener("click", () => {
  if (bike.trainer.spinningDown) return bike.trainer.cancelSpinDown();
  spinDownProgress = undefined;
  bike.trainer.spinDown().catch(() => undefined); // failures arrive as a "failed" progress event
});

function updateErgNote(b: IndoorBike) {
  const note = $("#erg-note");
  const connected = b.trainer.status === "connected";
  const works = b.trainer.capabilities.erg;
  note.hidden = !connected || works;
  note.textContent = b.trainer.controlDenied
    ? "ERG isn't available: another device (e.g. a watch paired to the trainer as a smart trainer) is controlling it. " +
      "Warm-up and cool-down then show the target wattage and you match it with gears and cadence."
    : "This device can't set a target wattage: in the warm-up and cool-down you match the shown target with gears and cadence.";
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
/** Rider's own power, used when the trainer is not holding an ERG target (the test). */
const setSimPower = (v: number) => {
  $<HTMLInputElement>("#sim-power").value = String(v);
  $("#sim-power-v").textContent = String(v);
  if (simTrainer) simTrainer.state.riderPower = v;
};
$<HTMLInputElement>("#sim-power").addEventListener("input", (e) => setSimPower(Number((e.target as HTMLInputElement).value)));
/**
 * Fast-forward for testing (simulated devices only): how many game seconds pass per real second. Everything timed
 * runs on the game clock (blocks, cues, countdown, scenery changes, the recorder's 1 Hz samples, distance), so a
 * whole session can be run through in about a minute.
 */
let simSpeed = 1;
$<HTMLInputElement>("#sim-speed").addEventListener("input", (e) => {
  simSpeed = Number((e.target as HTMLInputElement).value);
  $("#sim-speed-v").textContent = String(simSpeed);
});
const timeScale = () => (useSim() ? simSpeed : 1);

/**
 * Simulated heart rate (game time): drifts towards a level set by the power, plus a slow rise during the test
 * (cardiac drift), so the HR guide and the result have something to show.
 */
function simulateHeartRate(dt: number, power: number) {
  const target = 60 + power * 0.33 + (session.phase === "test" ? (session.phaseTime / 1200) * 8 : 0);
  simHrm.bpm += (target - simHrm.bpm) * (1 - Math.exp(-dt / 30));
}

// --- sound -------------------------------------------------------------------------------
let audio: AudioContext | undefined;
let muted = false;
function beep(freq: number, duration = 0.12, volume = 0.12) {
  if (!audio || muted) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.frequency.value = freq;
  o.type = "triangle";
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

// --- the plan, shown in the setup ----------------------------------------------------------
function renderPlanTable() {
  const cfg = readConfig();
  const maxHr = readMaxHr();
  const rows = planBlocks(cfg).map((b) => {
    const guide = heartRateGuide(b, maxHr);
    const hr = guide ? `${guide.low}–${guide.high} bpm` : heartRatePercent(b);
    const at = b.phase === "warmup" ? b.start : b.phase === "test" ? PHASE_SECONDS.warmup + b.start : PHASE_SECONDS.warmup + PHASE_SECONDS.test + b.start;
    return `<tr><td>${mmss(at)}</td><td><b>${b.title}</b><br><span class="muted">${b.feel}</span></td><td>${
      b.watts === undefined ? "you set it" : `${b.watts} W`
    }</td><td>${b.cadence[0]}–${b.cadence[1]} rpm</td><td>${b.rpe}<br><span class="muted">${hr}</span></td></tr>`;
  });
  $("#plan-table").innerHTML = `<thead><tr><th>At</th><th>Block</th><th>Power</th><th>Cadence</th><th>Effort / HR</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}
for (const id of ["#cfg-easy", "#cfg-hard", "#cfg-age", "#cfg-maxhr"]) $(id).addEventListener("input", renderPlanTable);

function readConfig(): Ftp20Config {
  return { ...defaultFtp20Config, easyWatts: num("#cfg-easy", 120), hardWatts: num("#cfg-hard", 250) };
}
const readMaxHr = () => maxHeartRate({ age: optNum("#cfg-age"), maxHr: optNum("#cfg-maxhr") });
renderPlanTable();

// --- game state ----------------------------------------------------------------------------
/**
 * setup → waiting (pedal to start) → riding ⇄ paused (stopped in warm-up/cool-down, or after "Continue")
 * riding → asking (a question is open: the clock and the scene wait) → riding/paused/done
 */
type Mode = "setup" | "waiting" | "riding" | "paused" | "asking" | "done";
let mode: Mode = "setup";
let cfg: Ftp20Config = readConfig();
let maxHr: number | undefined;
let session = new Ftp20Session(cfg);
let recorder = new Ftp20Recorder(session.blocks);
let coach = new PacingCoach();
/** Whether this run wants the trainer to hold the warm-up/cool-down targets (ERG) or only reads the power. */
let ergMode = false;
const ergOn = () => ergMode && bike.trainer.ergActive;
let ergShown: boolean | undefined;
/** What the trainer was last told: hold a target, or let the rider set the power. */
let control: "erg" | "free" | undefined;
const stop = new StopDetector(5);
/** Session time when the rider was last seen pedalling; a stop winds the clock back to it. */
let pedalT = 0;
let rideStart = new Date();
let sceneryIndex = 0;
let sceneryTime = 0;
let bannerTimer: ReturnType<typeof setTimeout> | undefined;
/** The mode to go back to when an open question is dismissed. */
let resumeMode: Mode = "riding";

const runner = new RunnerScene($<HTMLCanvasElement>("#world"));

function power3s(now: number): number | undefined {
  while (powerWindow.length && powerWindow[0]!.t < now - 3) powerWindow.shift();
  if (!powerWindow.length || now - lastDataAt > 3) return undefined;
  return powerWindow.reduce((a, b) => a + b.p, 0) / powerWindow.length;
}

function banner(text: string, ms = 3000) {
  const el = $("#banner");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function showPrompt(text: string, sub = "") {
  $("#prompt-text").textContent = text;
  $("#prompt-sub").textContent = sub;
  $("#prompt").hidden = false;
}

// --- screen wake lock: keep the screen on during the session -----------------------------------
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
document.addEventListener("visibilitychange", () => {
  if (mode !== "setup" && mode !== "done") void keepScreenOn();
});

$("#start").addEventListener("click", () => {
  void keepScreenOn();
  audio ??= new AudioContext();
  void audio.resume();
  cfg = readConfig();
  maxHr = readMaxHr();
  session = new Ftp20Session(cfg);
  recorder = new Ftp20Recorder(session.blocks);
  coach = new PacingCoach();
  sceneryIndex = 0;
  sceneryTime = 0;
  runner.reset(Date.now() & 0xffff, sceneryIndex);
  mode = "waiting";
  control = undefined;
  $("#setup").hidden = true;
  $("#hud").hidden = false;
  $("#sim-panel").hidden = !useSim();
  // On phones the sim panel starts folded so it doesn't cover the coach.
  $<HTMLDetailsElement>("#sim-panel").open = window.innerWidth > 700;
  showPrompt("Start pedalling to begin", "The warm-up starts easy. Stop pedalling and it pauses.");
  ergMode = ergAvailable();
  ergShown = undefined;
  ergHadTarget = false;
  applyControl();
  syncErgHud();
  renderCoach(session.state.block, session.state.next);
  if (useSim()) {
    setSimCadence(90);
    setSimPower(session.state.target ?? cfg.easyWatts);
  }
});

/** Tell the trainer what to do for the current moment: hold the ERG target, or let the rider set the power. */
function applyControl() {
  const target = session.state.target;
  if (ergMode && target !== undefined) {
    bike.setTargetPower(target); // cheap: unchanged targets are not resent
    control = "erg";
  } else if (control !== "free") {
    // Test (or no ERG): lift any target, flat road, the rider sets the power with gears and cadence.
    bike.releaseControl();
    control = "free";
  }
}

/** Show ERG only while it really works; otherwise the rider matches the target. */
let ergHadTarget = false;
function syncErgHud() {
  if (mode === "setup") return;
  const hasTarget = session.state.target !== undefined;
  const on = ergOn() && hasTarget;
  // Going from the test (no target) to the cool-down is not "ERG lost/back": only report changes while a target holds.
  const report = hasTarget && ergHadTarget;
  ergHadTarget = hasTarget;
  if (on === ergShown) return;
  const before = ergShown;
  ergShown = on;
  $("#erg-badge").textContent = on ? "ERG" : "match it";
  if (ergMode && report && before !== undefined && mode === "riding") {
    banner(on ? "ERG is back" : "ERG lost (another device controls the trainer): match the target", 4000);
  }
}

// --- questions (stop during the test, skipping, ending) ------------------------------------------
interface DialogButton {
  label: string;
  variant?: "primary" | "danger";
  action: () => void;
}
function ask(title: string, text: string, buttons: DialogButton[]) {
  resumeMode = mode === "asking" ? resumeMode : mode;
  mode = "asking";
  $("#dialog-title").textContent = title;
  $("#dialog-text").textContent = text;
  const box = $("#dialog-buttons");
  box.replaceChildren(
    ...buttons.map((b) => {
      const el = document.createElement("bm-button");
      el.textContent = b.label;
      if (b.variant) el.setAttribute("variant", b.variant);
      el.addEventListener("click", () => {
        $("#dialog").hidden = true;
        b.action();
      });
      return el;
    }),
  );
  $("#dialog").hidden = false;
}
const closeDialog = () => {
  mode = resumeMode;
  stop.reset();
};

/** Stopped during the test: the clock waits while the rider decides whether to continue or abort. */
function askAfterStop() {
  beep(330, 0.4);
  ask(
    "You stopped pedalling",
    `The 20-minute clock is paused at ${mmss(session.testTime)} – paused time doesn't count towards the 20 minutes. ` +
      "If you continue, the result won't be accurate: the break lets you recover, so it's no longer one 20-minute " +
      "effort and the FTP will likely come out too high. It will be marked as unreliable.",
    [
      {
        label: "Continue (result unreliable)",
        variant: "primary",
        action: () => {
          session.markInterrupted();
          mode = "paused";
          stop.reset();
          showPrompt("Start pedalling to continue the test", "The clock runs again when you pedal.");
        },
      },
      { label: "Abort test", variant: "danger", action: () => abortTest("You stopped and aborted the test.") },
    ],
  );
}

function abortTest(reason: string) {
  session.abort();
  // Nothing worth a result screen (hardly any riding recorded): back to the setup.
  if (recorder.samples.length < 30) return backToSetup();
  finish(reason);
}

$("#skip").addEventListener("click", () => {
  if (session.phase === "warmup") {
    if (session.state.countdown !== undefined) return;
    ask(
      "Skip the warm-up?",
      "Only if you're already warmed up: a proper warm-up with the opener gives a better result. " +
        "The trainer lets go and the 20-minute test starts after a 10-second countdown.",
      [
        {
          label: "Skip to the test",
          variant: "primary",
          action: () => {
            closeDialog();
            handle(session.skipWarmup());
          },
        },
        { label: "Keep warming up", action: closeDialog },
      ],
    );
  } else if (session.phase === "cooldown") {
    handle(session.skipCooldown());
  }
});

$("#quit").addEventListener("click", () => {
  if (mode === "waiting") return backToSetup();
  if (mode === "asking" || mode === "done") return;
  if (session.phase === "test") {
    ask("End the test?", "The test isn't finished: no valid FTP will be measured.", [
      { label: "End test", variant: "danger", action: () => abortTest("You ended the test.") },
      { label: "Keep going", variant: "primary", action: closeDialog },
    ]);
  } else if (session.phase === "warmup") {
    ask("End the session?", "You're still in the warm-up, so there'll be no FTP.", [
      { label: "End", variant: "danger", action: () => abortTest("You ended the session during the warm-up.") },
      { label: "Keep going", variant: "primary", action: closeDialog },
    ]);
  } else {
    finish("Test done – you ended the cool-down early.");
  }
});
$("#again").addEventListener("click", backToSetup);

function backToSetup() {
  mode = "setup";
  allowScreenOff();
  $("#dialog").hidden = true;
  $("#result").hidden = true;
  $("#hud").hidden = true;
  $("#setup").hidden = false;
  if (bike.trainer.status === "connected") bike.releaseControl();
  if (useSim()) setSimCadence(0);
  runner.reset(1, 0);
}

function finish(reason: string) {
  mode = "done";
  allowScreenOff();
  $("#dialog").hidden = true;
  // Leave the trainer on an easy flat road (ERG) or alone (read-only).
  if (ergMode && bike.trainer.status === "connected") bike.freeRide();
  if (useSim()) setSimCadence(0);
  beep(523, 0.5, 0.15);
  const result = ftp20Result(cfg, recorder.testSamples(), {
    testSeconds: session.testTime,
    interruptions: session.interruptions,
    aborted: session.aborted,
  });
  activity = buildActivity(recorder.samples, recorder.lapStarts, rideStart, session.t);
  showResult(result, reason);
}

/** React to what the session clock reported. */
function handle(events: Ftp20Event[]) {
  for (const e of events) {
    switch (e.type) {
      case "block":
        renderCoach(e.block, session.blocks[e.index + 1]);
        // The first block and the start of the test/cool-down have their own banner.
        if (e.block.start > 0) banner(`${e.block.title}${e.block.watts ? ` · ${e.block.watts} W` : ""}`);
        beep(880, 0.2);
        // Simulated rider without ERG: ride the targets, so the warm-up looks right.
        if (useSim() && e.block.watts !== undefined) setSimPower(e.block.watts);
        break;
      case "cue":
        banner(e.text, 3500);
        beep(990, 0.15);
        break;
      case "countdown":
        beep(e.seconds <= 3 ? 660 : 520, 0.1);
        break;
      case "phase":
        if (e.phase === "test") {
          banner("GO! 20 minutes – controlled start", 4000);
          beep(1320, 0.4, 0.18);
          nextScenery();
          if (useSim()) setSimPower(cfg.hardWatts);
        } else {
          banner("Test done! Cool-down", 4000);
          beep(1320, 0.3);
        }
        break;
      case "test-complete":
        break;
      case "done":
        finish(session.aborted ? "Test aborted." : "Session complete.");
        return;
    }
  }
}

function nextScenery() {
  sceneryIndex++;
  sceneryTime = 0;
  runner.setScenery(sceneryIndex);
}

// --- loop ----------------------------------------------------------------------------
let prev = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000;
  const realDt = Math.max(0, now - prev);
  const dt = Math.min(0.1, realDt);
  prev = now;
  const d = bike.data;
  const p3 = power3s(now);
  const fresh = now - lastDataAt < 3;
  const pedalling = fresh && stop.isPedalling(d.cadence, d.power);
  const cadence = fresh ? (d.cadence ?? 0) : 0;

  if (mode === "setup") {
    runner.update(dt, ATTRACT_SPEED * dt, ATTRACT_SPEED, 85);
  } else if (mode === "waiting" || mode === "paused") {
    runner.update(dt, 0, 0, 0);
    renderHud(p3);
    if (pedalling) {
      if (mode === "waiting") {
        rideStart = new Date();
        handle(session.advance(0));
      } else {
        banner(session.phase === "test" ? "Test continues" : `${PHASE_NAME[session.phase]} continues`);
      }
      mode = "riding";
      pedalT = session.t;
      stop.reset();
      $("#prompt").hidden = true;
      beep(880, 0.25);
    }
  } else if (mode === "asking") {
    // A question is open: the session clock and the world wait.
    runner.update(dt, 0, 0, 0);
  } else if (mode === "riding") {
    const k = timeScale();
    // Game time step. Uncapped: if the browser throttled frames, the ride still went on for that long.
    let left = realDt * k;
    const power = d.power ?? 0;
    const hr = d.heartRate;
    const extra = fresh ? { cadence: d.cadence, speed: d.speed } : {};
    // Advance in steps of at most one second so a sped-up clock still records a sample for every second.
    while (left > 0 && mode === "riding") {
      const step = Math.min(1, left);
      left -= step;
      handle(session.advance(step));
      if (mode !== "riding") break;
      const st = session.state;
      recorder.record(session.t, st.phase, st.phaseTime, power, hr, { ...extra, target: st.target });
      if (st.phase === "test") coach.push(st.phaseTime, power);
      sceneryTime += step;
      if (sceneryTime >= SCENERY_SECONDS) nextScenery();
      if (useSim()) simulateHeartRate(step, power);
    }
    if (mode === "riding") {
      applyControl();
      const speed = speedFromPower(p3 ?? 0);
      runner.update(dt, speed * dt * k, speed, cadence);
      // Stop detection runs on real seconds (the rider really stopped); the clock is then wound back in game time.
      const stopped = stop.update(now, d.cadence, d.power, fresh);
      if (stop.lastPedallingAt === now) pedalT = session.t;
      if (stopped) {
        session.rewind(pedalT);
        recorder.truncate(session.t);
        if (session.phase === "test") coach.truncate(session.phaseTime);
        if (session.stopAction() === "ask") askAfterStop();
        else {
          mode = "paused";
          beep(440, 0.3);
          showPrompt(`${PHASE_NAME[session.phase]} paused`, "Start pedalling to continue" + (session.phase === "cooldown" ? " – or skip to your result" : ""));
        }
      }
      renderHud(p3);
    }
  } else {
    runner.update(dt, 0, 0, 0);
  }

  runner.render();
  requestAnimationFrame(frame);
}

// --- HUD -------------------------------------------------------------------------------------
function renderCoach(block: Block, next: Block | undefined) {
  $("#coach-title").textContent = block.title;
  $("#coach-rpm").textContent = `${block.cadence[0]}–${block.cadence[1]} rpm`;
  $("#coach-feel").textContent = block.feel;
  $("#coach-rpe").textContent = block.rpe;
  const guide = heartRateGuide(block, maxHr);
  $("#coach-hr-row").hidden = !guide;
  $("#coach-hr").textContent = guide ? `${guide.low}–${guide.high} bpm (~${heartRatePercent(block)} of max)` : "";
  $("#coach-tip").textContent = block.tip;
  $("#coach-next").textContent = next
    ? `Next: ${next.phase !== block.phase ? `${PHASE_NAME[next.phase]} – ` : ""}${next.title}`
    : "Next: your result";
}

function renderHud(p3: number | undefined) {
  const d = bike.data;
  const st = session.state;
  const total = st.block.end - st.block.start;
  $("#phase-label").textContent = PHASE_NAME[st.phase];
  $("#block-title").textContent = st.block.title;
  $("#block-time").textContent = mmss(st.remaining);
  $("#block-bar").style.width = `${(st.elapsed / total) * 100}%`;
  $("#phase-left").textContent = `${PHASE_NAME[st.phase]}: ${mmss(st.phaseRemaining)} left`;
  const skip = $("#skip");
  skip.hidden = st.phase === "test" || st.countdown !== undefined;
  skip.textContent = st.phase === "warmup" ? "Skip warm-up" : "Skip to result";
  $("#power").textContent = p3 === undefined ? "–" : String(Math.round(p3));

  // Warm-up/cool-down: the target (held by ERG, or matched by the rider). Test: the pacing gauge, no numbers.
  const testing = st.phase === "test";
  $("#erg-row").hidden = testing || st.target === undefined;
  $("#pace").hidden = !testing;
  syncErgHud();
  const hint = $("#match-hint");
  hint.hidden = testing || st.target === undefined || ergOn();
  if (st.target !== undefined) {
    $("#target").textContent = String(st.target);
    const diff = p3 === undefined ? undefined : Math.round(st.target - p3);
    hint.className = `hint ${diff === undefined ? "" : diff > 10 ? "low" : diff < -10 ? "high" : "ok"}`;
    hint.textContent = diff === undefined ? "" : diff > 10 ? `▲ ${diff} W more` : diff < -10 ? `▼ ${-diff} W less` : "on target";
  }
  if (testing) renderPace();

  const cd = $("#countdown");
  cd.hidden = st.countdown === undefined;
  // The countdown says it all; a banner on top of it would be unreadable.
  $("#banner").style.visibility = st.countdown === undefined ? "" : "hidden";
  if (st.countdown !== undefined) cd.innerHTML = `<small>Test starts in</small>${Math.ceil(st.countdown)}<small>shift into your test gear</small>`;

  const cadence = d.cadence;
  $("#cadence").textContent = cadence === undefined ? "–" : String(Math.round(cadence));
  const [lo, hi] = st.block.cadence;
  $("#cadence").dataset.zone = cadence === undefined ? "" : cadence < lo - 3 ? "low" : cadence > hi + 5 ? "high" : "ok";
  $("#hr").textContent = d.heartRate === undefined ? "–" : String(d.heartRate);
  $("#distance").textContent = (trackDistance(recorder.samples) / 1000).toFixed(2);
  $("#scenery").textContent = runner.sceneryName;
}

function renderPace() {
  const a = coach.advice(session.phaseTime);
  const marker = $("#gauge-marker");
  // ±(2 × STRONG_BAND) fills the gauge; the steady band in the middle is drawn by CSS.
  const span = STRONG_BAND * 2;
  const x = a.deviation === undefined ? 0 : Math.max(-1, Math.min(1, a.deviation / span));
  marker.style.left = `${50 + x * 50}%`;
  marker.dataset.zone = a.zone ?? "";
  marker.hidden = !a.ready;
  const text = $("#pace-text");
  text.textContent = a.text;
  text.dataset.tone = a.tone;
}

// --- result ----------------------------------------------------------------------------
let activity: Activity | undefined;
let lastResult: Ftp20Result | undefined;

function download(data: BlobPart, type: string, ext: string) {
  const d = rideStart;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const name = `ftp20-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`;
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
  const notes =
    r?.ftp === undefined
      ? "20-min FTP test (no valid FTP)"
      : `20-min FTP test: FTP ${r.ftp} W (20-min avg ${r.avgPower} W × ${cfg.ftpFactor})${r.reliable ? "" : ", unreliable: interrupted"}`;
  download(encodeTcx(activity, notes), "application/vnd.garmin.tcx+xml", "tcx");
});

function showResult(r: Ftp20Result, reason: string) {
  lastResult = r;
  $("#hud").hidden = true;
  $("#result").hidden = false;
  $("#result-reason").textContent = reason;
  $("#ftp").textContent = r.ftp === undefined ? "–" : String(r.ftp);
  $("#unreliable").hidden = r.ftp === undefined || r.reliable;
  const weight = $<HTMLInputElement>("#cfg-weight").valueAsNumber;
  $("#wkg").textContent = r.ftp !== undefined && weight > 0 ? `${(r.ftp / weight).toFixed(2)} W/kg` : "";
  $("#ftp-note").textContent = resultNote(r, cfg);
  // The pacing verdict is about a full 20-minute effort; for a test cut short it would mislead.
  $("#pacing-note").textContent = r.complete ? (pacingSummary(r) ?? "") : "";
  $("#r-avg-label").textContent = r.complete ? "20-min avg power" : "Avg power (test so far)";
  const w = (v: number | undefined) => (v === undefined ? "–" : `${v} W`);
  $("#r-avg").textContent = w(r.avgPower);
  $("#r-test").textContent = `${mmss(Math.floor(r.testSeconds))} / 20:00`;
  $("#r-blocks").textContent = r.blockPowers.length ? `${r.blockPowers.join(" · ")} W` : "–";
  $("#r-split").textContent = r.split === undefined ? "–" : `${r.split >= 0 ? "+" : "−"}${Math.abs(r.split * 100).toFixed(1)} %`;
  $("#r-cv").textContent = r.variability === undefined ? "–" : `${(r.variability * 100).toFixed(1)} %`;
  $("#r-max").textContent = w(r.maxPower);
  $("#r-cad").textContent = r.avgCadence === undefined ? "–" : `${r.avgCadence} rpm`;
  $("#r-hr").textContent = r.avgHeartRate === undefined ? "–" : `${r.avgHeartRate} bpm`;
  $("#r-maxhr").textContent = r.maxHeartRate === undefined ? "–" : `${r.maxHeartRate} bpm`;
  $("#r-time").textContent = mmss(Math.round(session.t));
  const s = activity?.summary;
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

  const samples = recorder.samples;
  const targets = chartMetric === "power" ? samples.map((s) => (s.target > 0 ? s.target : undefined)) : [];
  const vMax = Math.max(...values, ...targets.filter((v): v is number => v !== undefined)) * 1.1 || 1;
  const vMin = chartMetric === "heartRate" ? Math.max(0, Math.floor((Math.min(...values) - 10) / m.step) * m.step) : 0;
  const tMax = points.at(-1)!.t || 1;
  const X = (t: number) => 30 + (t / tMax) * (w - 36);
  const Y = (v: number) => h - 18 - ((v - vMin) / (vMax - vMin)) * (h - 28);

  // The test block, shaded, with its label.
  const testSamples = samples.filter((s) => s.phase === "test");
  if (testSamples.length) {
    const t0 = testSamples[0]!.t;
    const t1 = testSamples.at(-1)!.t;
    g.fillStyle = "rgba(64, 224, 208, 0.08)";
    g.fillRect(X(t0), 4, X(t1) - X(t0), h - 22);
  }
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
  for (const phase of ["warmup", "test", "cooldown"] as const) {
    const ps = samples.filter((s) => s.phase === phase);
    if (ps.length < 2) continue;
    const label = phase === "test" ? "20-min test" : PHASE_NAME[phase].toLowerCase();
    g.fillText(label, (X(ps[0]!.t) + X(ps.at(-1)!.t)) / 2 - label.length * 2.6, h - 4);
  }
  const plot = (ys: (number | undefined)[], ts: number[], color: string, width: number, dash: number[] = []) => {
    g.beginPath();
    let pen = false;
    ys.forEach((y, i) => {
      if (y === undefined) return void (pen = false);
      if (pen) g.lineTo(X(ts[i]!), Y(y));
      else g.moveTo(X(ts[i]!), Y(y));
      pen = true;
    });
    g.strokeStyle = color;
    g.lineWidth = width;
    g.setLineDash(dash);
    g.stroke();
    g.setLineDash([]);
  };
  if (targets.length) plot(targets, samples.map((s) => s.t), "#7d8a99", 1.5, [4, 3]);
  plot(points.map(value), points.map((p) => p.t), chartMetric === "heartRate" ? "#ff7ab6" : "#40e0d0", 1.5);
  // The 20-minute average across the test (only here, after the test).
  const avg = lastResult?.avgPower;
  if (chartMetric === "power" && avg !== undefined && testSamples.length > 1) {
    plot([avg, avg], [testSamples[0]!.t, testSamples.at(-1)!.t], "#ffd84d", 2);
    g.fillStyle = "#ffd84d";
    g.fillText(`avg ${avg} W`, X(testSamples[0]!.t) + 4, Y(avg) - 5);
  }
}

requestAnimationFrame(frame);
