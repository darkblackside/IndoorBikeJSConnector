// Feed the Horde: the co-op multiplayer game. Everyone connected sees the shared horde; riders feed it with sweat.
// UI: @darkblackside/ui (gamification theme) for the controls; the arena is three.js (3D or flat 2D draft).
import "@darkblackside/ui/themes/gamification.css";
import "@darkblackside/ui/base.css";
import "@darkblackside/ui/button.js";
import "@darkblackside/ui/field.js";
import "@darkblackside/ui/check.js";
import "@darkblackside/ui/fieldset.js";
import "@darkblackside/ui/notice.js";
import "./style.css";
import { IndoorBike } from "indoor-bike-js-connector";
import { createSimulatedHeartRateMonitor, createSimulatedTrainer, FakeBluetooth, type SimulatedTrainer } from "indoor-bike-js-connector/testing";
import {
  FTP_MAX,
  FTP_MIN,
  getWorkout,
  listWorkouts,
  workoutSeconds,
  type SessionSummary,
  type Workout,
  type WorkoutId,
} from "@indoor-bike/game-core/horde";
import type { HordeEffect, HordeRider, HordeState } from "@indoor-bike/game-core/net";
import { loadFtp, loadJson, loadName, saveFtp, saveJson, saveName } from "../common/profile.ts";
import { ArenaRenderer, type ArenaStyle } from "./arenaRenderer.ts";
import { ArenaSim, RIDER_COLORS, type RiderView } from "./arenaSim.ts";
import { joinHorde, type HordeConnection } from "./hordeClient.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const mmss = (s: number) => {
  s = Math.max(0, Math.ceil(s));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --- settings & records (this browser) ----------------------------------------------------------
interface Settings {
  view: ArenaStyle;
  workout: WorkoutId;
  short: boolean;
  erg: boolean;
  muted: boolean;
}
const SETTINGS_KEY = "horde.settings";
const settings = loadJson<Settings>(SETTINGS_KEY, { view: "3d", workout: "free", short: true, erg: false, muted: false });
const saveSettings = () => saveJson(SETTINGS_KEY, settings);

interface Records {
  bestSweat: number;
  bestStreak: number;
  topMultiplier: number;
  lifetimeSweat: number;
  sessions: number;
}
const RECORDS_KEY = "horde.records";
let records = loadJson<Records>(RECORDS_KEY, { bestSweat: 0, bestStreak: 0, topMultiplier: 1, lifetimeSweat: 0, sessions: 0 });

function renderRecords() {
  $("#records").textContent = records.sessions
    ? `Your records here: best session ${fmt.format(records.bestSweat)} drops · best streak ${records.bestStreak} · top ×${records.topMultiplier} · all-time ${fmt.format(records.lifetimeSweat)} drops in ${records.sessions} rides`
    : "";
}

// --- arena ---------------------------------------------------------------------------------------
const sim = new ArenaSim();
let arena = new ArenaRenderer($<HTMLCanvasElement>("#arena"), settings.view);

function setView(view: ArenaStyle) {
  settings.view = view;
  saveSettings();
  // A fresh canvas: the old WebGL context goes away with the old renderer.
  arena.dispose();
  const old = $<HTMLCanvasElement>("#arena");
  const canvas = document.createElement("canvas");
  canvas.id = "arena";
  old.replaceWith(canvas);
  arena = new ArenaRenderer(canvas, view);
  $("#view").textContent = view === "3d" ? "2D view" : "3D view";
}
$("#view").textContent = settings.view === "3d" ? "2D view" : "3D view";
$("#view").addEventListener("click", () => setView(settings.view === "3d" ? "2d" : "3d"));

// --- connection to the server --------------------------------------------------------------------
let conn: HordeConnection | undefined;
let connecting = false;

function setConn(state: "connecting" | "connected" | "offline", text: string) {
  $("#conn").dataset.s = state;
  $("#conn").textContent = text;
  updateStart();
}

async function connect() {
  if (connecting || conn) return;
  connecting = true;
  setConn("connecting", "connecting…");
  try {
    conn = await joinHorde($<HTMLInputElement>("#name").value.trim() || "Guest");
    setConn("connected", "online");
    const room = conn.room;
    room.onMessage("effect", (e: HordeEffect) => onEffect(e));
    room.onMessage("summary", (s: SessionSummary) => onSummary(s));
    room.onLeave(() => {
      conn = undefined;
      if (riding) endRide(undefined);
      setConn("offline", "offline – retrying");
      setTimeout(connect, 4000);
    });
  } catch {
    conn = undefined;
    setConn("offline", "server offline – retrying");
    setTimeout(connect, 6000);
  } finally {
    connecting = false;
  }
}

const state = (): HordeState | undefined => conn?.room.state;
const myId = () => conn?.room.sessionId ?? "";
const me = (): HordeRider | undefined => state()?.riders.get(myId());

// --- devices -------------------------------------------------------------------------------------
const fake = new FakeBluetooth();
let simTrainer: SimulatedTrainer | undefined;
const simHrm = fake.add(createSimulatedHeartRateMonitor());
const useSim = () => $<HTMLInputElement>('input[name="source"]:checked').value === "sim";
let latest = { power: 0, cadence: 0, heartRate: 0, at: 0 };

if (!("bluetooth" in navigator)) {
  $<HTMLInputElement>('input[name="source"][value="sim"]').checked = true;
  $("#bt-warning").hidden = false;
  $("#bt-warning").textContent = "Web Bluetooth isn't available in this browser (use Chrome or Edge). Simulated trainer selected.";
}

let bike = createBike();
function createBike(): IndoorBike {
  const b = new IndoorBike({ bluetooth: useSim() ? fake.asBluetooth() : undefined });
  b.on("data", (d) => {
    if (d.power !== undefined) latest.power = d.power;
    if (d.cadence !== undefined) latest.cadence = d.cadence;
    if (d.heartRate !== undefined) latest.heartRate = d.heartRate;
    latest.at = performance.now();
    if (riding) conn?.sample({ power: latest.power, cadence: latest.cadence, heartRate: latest.heartRate || undefined });
  });
  b.on("status", ({ device, status }) => {
    const t = device === "trainer";
    const el = $(t ? "#trainer-status" : "#hrm-status");
    const name = (t ? b.trainer : b.heartRateMonitor).deviceName;
    el.dataset.s = status;
    el.textContent = status + (name && status !== "disconnected" ? ` – ${name}` : "");
    $(t ? "#connect-trainer" : "#connect-hrm").textContent =
      status === "disconnected" ? (t ? "Connect trainer" : "Connect heart rate (optional)") : "Disconnect";
    updateStart();
  });
  b.on("control", () => applyErg(true));
  return b;
}
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="source"]')) {
  r.addEventListener("change", () => {
    bike.disconnect();
    bike = createBike();
  });
}

async function toggleDevice(kind: "trainer" | "hrm") {
  const sensor = kind === "trainer" ? bike.trainer : bike.heartRateMonitor;
  if (sensor.status !== "disconnected") return sensor.disconnect();
  if (useSim()) {
    if (kind === "trainer" && !simTrainer) {
      simTrainer = fake.add(createSimulatedTrainer("ftms", "Simulated KICKR"));
      simTrainer.state.cadence = 0;
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
$("#connect-trainer").addEventListener("click", () => toggleDevice("trainer"));
$("#connect-hrm").addEventListener("click", () => toggleDevice("hrm"));

// Simulated rider: follows the target by default, or the sliders.
const simPower = () => Number($<HTMLInputElement>("#sim-power").value);
const simCadence = () => Number($<HTMLInputElement>("#sim-cadence").value);
for (const id of ["power", "cadence"] as const) {
  $<HTMLInputElement>(`#sim-${id}`).addEventListener("input", (e) => {
    $(`#sim-${id}-v`).textContent = (e.target as HTMLInputElement).value;
    if (id === "power") $<HTMLInputElement>("#sim-follow").checked = false;
  });
}
function driveSimulatedRider(dt: number) {
  if (!simTrainer || !useSim()) return;
  const r = me();
  const ftp = rideFtp;
  let power = simPower();
  if ($<HTMLInputElement>("#sim-follow").checked && r?.active && ftp) {
    const aim = r.blockKind === "free" ? 0.8 : r.high >= 2 ? 1.8 : (r.low + r.high) / 2;
    simAim += (aim * ftp * (1 + (Math.random() - 0.5) * 0.06) - simAim) * Math.min(1, dt * 2);
    power = Math.round(simAim);
    $<HTMLInputElement>("#sim-power").value = String(power);
    $("#sim-power-v").textContent = String(power);
  }
  simTrainer.state.riderPower = power;
  simTrainer.state.cadence = simCadence();
  simHrm.bpm += (60 + power * 0.35 - simHrm.bpm) * Math.min(1, dt / 20);
}
let simAim = 150;

// --- setup: name, FTP, workout -------------------------------------------------------------------
$<HTMLInputElement>("#name").value = loadName();
$("#name").addEventListener("change", () => saveName($<HTMLInputElement>("#name").value));

const SOURCE_TEXT = { ftp20: "from your 20-min FTP test", "zombie-ramp": "from your Zombie Ramp test", manual: "entered by you" };
function initFtp() {
  const stored = loadFtp();
  if (stored) {
    $<HTMLInputElement>("#ftp").value = String(stored.watts);
    const date = stored.date ? new Date(stored.date).toLocaleDateString() : "";
    $("#ftp-source").textContent = `${SOURCE_TEXT[stored.source]}${date ? ` (${date})` : ""}, saved in this browser.`;
  }
  $("#ftp-help").hidden = !!stored;
}
initFtp();
const ftpValue = () => {
  const v = $<HTMLInputElement>("#ftp").valueAsNumber;
  return Number.isFinite(v) && v >= FTP_MIN && v <= FTP_MAX ? Math.round(v) : undefined;
};
$("#ftp").addEventListener("input", () => {
  updateStart();
  renderWorkouts();
});
$("#ftp").addEventListener("change", () => {
  const v = ftpValue();
  if (v === undefined || v === loadFtp()?.watts) return;
  saveFtp(v, "manual");
  $("#ftp-source").textContent = "entered by you, saved in this browser.";
});

/** Zone colour of a target (fraction of FTP). */
function zoneColor(i: number): string {
  if (i >= 1.2) return "#ff4fd8";
  if (i >= 1.05) return "#ff5a6a";
  if (i >= 0.9) return "#ffb347";
  if (i >= 0.76) return "#f4f46a";
  if (i >= 0.56) return "#3ef0a0";
  return "#59c3ff";
}

/** Small block chart of a workout (SVG). `at`: seconds into it, draws a cursor. */
function profileSvg(w: Workout, width: number, height: number, at?: number): string {
  if (!w.blocks.length) {
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" aria-hidden="true"><path d="M0 ${height * 0.45} Q ${width * 0.25} ${height * 0.2} ${width * 0.5} ${height * 0.45} T ${width} ${height * 0.45}" fill="none" stroke="#3ef0a0" stroke-width="2" stroke-dasharray="4 4"/></svg>`;
  }
  const total = workoutSeconds(w);
  const top = 2;
  let x = 0;
  const rects = w.blocks.map((b) => {
    const bw = (b.seconds / total) * width;
    const mid = Math.min(top, b.high >= 2 ? 1.8 : (b.low + b.high) / 2);
    const bh = (mid / top) * height;
    const r = `<rect x="${x.toFixed(2)}" y="${(height - bh).toFixed(2)}" width="${Math.max(0.8, bw - 0.4).toFixed(2)}" height="${bh.toFixed(2)}" fill="${zoneColor(mid)}" opacity="0.85"/>`;
    x += bw;
    return r;
  });
  const ftpLine = `<line x1="0" x2="${width}" y1="${height - height / top}" y2="${height - height / top}" stroke="#ffffff" stroke-opacity="0.25" stroke-dasharray="3 3"/>`;
  const cursor = at === undefined ? "" : `<rect x="${((at / total) * width - 1).toFixed(2)}" y="0" width="2" height="${height}" fill="#fff"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" aria-hidden="true">${rects.join("")}${ftpLine}${cursor}</svg>`;
}

function renderWorkouts() {
  const ftp = ftpValue();
  $("#workouts").replaceChildren(
    ...listWorkouts(settings.short).map((w) => {
      const btn = document.createElement("button");
      btn.className = "workout";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(w.id === settings.workout));
      const minutes = w.blocks.length ? `${Math.round(workoutSeconds(w) / 60)} min` : "open end";
      const skulls = w.difficulty ? "☠".repeat(w.difficulty) : "";
      const work = w.blocks.filter((b) => b.kind === "work");
      const peak = work.length ? Math.max(...work.map((b) => b.high)) : 0;
      const range = ftp && work.length && peak < 2 ? ` · up to ${Math.round(peak * ftp)} W` : "";
      btn.innerHTML = `<span class="w-head"><b>${esc(w.title)}</b><span class="skulls" title="difficulty">${skulls}</span></span>
        <span class="w-meta muted small">${minutes}${range}</span>
        <span class="w-goal small">${esc(w.goal)}</span>
        <span class="w-profile">${profileSvg(w, 200, 28)}</span>`;
      btn.addEventListener("click", () => {
        settings.workout = w.id;
        saveSettings();
        renderWorkouts();
      });
      return btn;
    }),
  );
}
for (const short of [true, false]) {
  const btn = $(short ? "#len-short" : "#len-full");
  btn.addEventListener("click", () => {
    settings.short = short;
    saveSettings();
    $("#len-short").setAttribute("aria-checked", String(short));
    $("#len-full").setAttribute("aria-checked", String(!short));
    renderWorkouts();
  });
}
$("#len-short").setAttribute("aria-checked", String(settings.short));
$("#len-full").setAttribute("aria-checked", String(!settings.short));
$<HTMLInputElement>("#erg").checked = settings.erg;
$("#erg").addEventListener("change", () => {
  settings.erg = $<HTMLInputElement>("#erg").checked;
  saveSettings();
});
renderWorkouts();
renderRecords();

function updateStart() {
  const ftp = ftpValue();
  const trainer = bike.trainer.status === "connected";
  const online = !!conn;
  const hint = !online ? "Waiting for the server…" : !ftp ? `Enter your FTP (${FTP_MIN}–${FTP_MAX} W) to start.` : !trainer ? "Connect your trainer (or the simulated one) to start." : "";
  $("#start-hint").textContent = hint;
  $<HTMLElementTagNameMap["bm-button"]>("#start").disabled = !!hint;
}

// --- riding --------------------------------------------------------------------------------------
let riding = false;
let rideFtp = 0;
let rideWorkout: Workout = getWorkout("free");
let lastBlockKey = "";

$("#start").addEventListener("click", () => {
  const ftp = ftpValue();
  if (!conn || !ftp || bike.trainer.status !== "connected") return;
  saveName($<HTMLInputElement>("#name").value);
  if (ftp !== loadFtp()?.watts) saveFtp(ftp, "manual");
  rideFtp = ftp;
  rideWorkout = getWorkout(settings.workout, settings.short);
  conn.start({ workout: settings.workout, short: settings.short, ftp });
  riding = true;
  lastBlockKey = "";
  simAim = ftp * 0.6;
  ensureAudio();
  $("#setup").hidden = true;
  $("#result").hidden = true;
  $("#hud").hidden = false;
  $("#sim-panel").hidden = !useSim();
  $("#w-title").textContent = rideWorkout.title + (rideWorkout.blocks.length && settings.short ? " (short)" : "");
  if (useSim()) $<HTMLInputElement>("#sim-cadence").value = "90";
  $("#sim-cadence-v").textContent = $<HTMLInputElement>("#sim-cadence").value;
});

$("#stop").addEventListener("click", () => {
  if (!riding) return;
  conn?.stop();
});

function endRide(summary: SessionSummary | undefined) {
  riding = false;
  bike.trainer.freeRide();
  if (simTrainer) simTrainer.state.cadence = 0;
  $("#hud").hidden = true;
  if (!summary) {
    $("#setup").hidden = false;
    return;
  }
  const pb: string[] = [];
  if (summary.sweat > records.bestSweat && records.sessions) pb.push("best session");
  if (summary.bestStreak > records.bestStreak && records.sessions) pb.push("longest streak");
  if (summary.maxMultiplier > records.topMultiplier && records.sessions) pb.push("top multiplier");
  records = {
    bestSweat: Math.max(records.bestSweat, summary.sweat),
    bestStreak: Math.max(records.bestStreak, summary.bestStreak),
    topMultiplier: Math.max(records.topMultiplier, summary.maxMultiplier),
    lifetimeSweat: records.lifetimeSweat + summary.sweat,
    sessions: records.sessions + 1,
  };
  saveJson(RECORDS_KEY, records);
  renderRecords();

  $("#r-title").textContent = `${summary.title}${summary.completed ? " – completed" : ""}`;
  $("#r-sweat").textContent = fmt.format(summary.sweat);
  $("#r-pb").textContent = pb.length ? `New personal record: ${pb.join(", ")}!` : "";
  $("#r-blocks").textContent = summary.blocksJudged ? `${summary.blocksHit} / ${summary.blocksJudged}` : "–";
  $("#r-streak").textContent = String(summary.bestStreak);
  $("#r-mult").textContent = `×${summary.maxMultiplier}`;
  $("#r-time").textContent = mmss(summary.seconds);
  $("#r-avg").textContent = summary.avgPower ? `${summary.avgPower} W` : "–";
  $("#r-life").textContent = `${fmt.format(records.lifetimeSweat)} drops`;
  $("#result").hidden = false;
}
$("#again").addEventListener("click", () => {
  $("#result").hidden = true;
  $("#setup").hidden = false;
  updateStart();
});

/** ERG: hold the middle of each block's band; sprints, free play and an unwilling trainer ride free. */
function applyErg(force = false) {
  const r = me();
  if (!riding || !r?.active) return;
  const key = `${r.blockIndex}:${r.low}:${r.high}`;
  if (key === lastBlockKey && !force) return;
  lastBlockKey = key;
  const wantErg = settings.erg && bike.trainer.capabilities.erg && r.blockKind !== "free" && r.high < 2;
  if (wantErg) bike.trainer.setTargetPower(Math.round(((r.low + r.high) / 2) * rideFtp));
  else bike.trainer.freeRide();
}

function hudFrame(r: HordeRider) {
  const ftp = rideFtp;
  const free = r.blockKind === "free";
  const sprint = r.high >= 2;
  $("#b-label").textContent = r.paused ? "Paused – pedal on!" : r.blockLabel;
  $("#b-left").textContent = mmss(r.blockLeft);
  $("#b-left-label").textContent = free ? "left in this stretch" : "left in block";
  const live = performance.now() - latest.at < 3000;
  $("#power").textContent = live ? String(Math.round(latest.power)) : "–";
  const pct = Math.round(r.intensity * 100);
  $("#pct").textContent = `${pct} % FTP`;
  $("#cad").textContent = live && latest.cadence ? String(Math.round(latest.cadence)) : "–";
  $("#hr").textContent = latest.heartRate ? String(Math.round(latest.heartRate)) : "–";
  $("#my-sweat").textContent = fmt.format(r.sweat);
  $("#my-rate").textContent = r.rate > 0 ? `+${fmt.format(r.rate * 3600)}/h` : "";
  $("#mult").textContent = `×${r.multiplier}`;
  $("#streak").textContent = r.streak ? `🔥${r.streak}` : "";
  $(".mult").dataset.level = String(Math.min(5, Math.round((r.multiplier - 1) * 2.5)));
  $("#governed").hidden = !r.governed;

  // Gauge 0 … 160 % FTP (sprints up to 250 %).
  const max = sprint ? 2.5 : 1.6;
  const pos = (i: number) => `${(Math.min(max, Math.max(0, i)) / max) * 100}%`;
  const band = $("#g-band");
  band.hidden = free;
  if (!free) {
    band.style.left = pos(r.low);
    band.style.width = `calc(${pos(sprint ? max : r.high)} - ${pos(r.low)})`;
  }
  $("#g-marker").style.left = pos(r.intensity);
  $("#g-marker").dataset.on = String(r.onTarget);
  $("#target").textContent = free
    ? "Free play: steady above 55 % for 3 min"
    : sprint
      ? `Sprint! ${Math.round(r.low * ftp)}+ W`
      : `Target ${Math.round(r.low * ftp)}–${Math.round(r.high * ftp)} W`;
  let hint = "";
  if (!free && !r.paused) {
    if (r.intensity < r.low - 0.03) hint = "Push a bit harder ↑";
    else if (!sprint && r.intensity > r.high + 0.03) hint = "Ease off a little ↓";
    else hint = "On target – hold it!";
  } else if (free && !r.paused) hint = r.intensity >= 0.75 ? "Strong! You count for the frenzy." : "";
  $("#hint").textContent = hint;
  $("#hint").dataset.on = String(r.onTarget);
  $("#next").textContent = r.nextLabel ? `Next: ${r.nextLabel}` : free ? "Ride as long as you like." : "Last block!";
  if (rideWorkout.blocks.length) {
    const key = `${Math.floor(r.elapsed / 5)}`;
    if ($("#profile").dataset.k !== key) {
      $("#profile").dataset.k = key;
      $("#profile").innerHTML = profileSvg(rideWorkout, 300, 34, r.elapsed) + `<div class="muted small">${mmss(r.elapsed)} / ${mmss(r.total)}</div>`;
    }
  } else $("#profile").innerHTML = "";
}

// --- server effects ------------------------------------------------------------------------------
function feed(html: string, kind = "") {
  const item = document.createElement("div");
  item.className = `feed-item${kind ? ` k-${kind}` : ""}`;
  item.innerHTML = html;
  $("#feed").prepend(item);
  while ($("#feed").children.length > 6) $("#feed").lastElementChild!.remove();
  setTimeout(() => item.classList.add("old"), 8000);
}
const who = (id: string, fallback = "Someone") => {
  const r = state()?.riders.get(id);
  const name = esc(r?.name || fallback);
  const color = RIDER_COLORS[(r?.color ?? 0) % RIDER_COLORS.length];
  return `<b style="color:${color}">${id === myId() ? "You" : name}</b>`;
};

let bannerTimer = 0;
function banner(text: string, kind: string) {
  const b = $("#banner");
  b.textContent = text;
  b.dataset.kind = kind;
  b.hidden = false;
  b.classList.remove("pop");
  void b.offsetWidth;
  b.classList.add("pop");
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => (b.hidden = true), 3500);
}

function onEffect(e: HordeEffect) {
  switch (e.kind) {
    case "block": {
      sim.burst(e.rider, e.hit);
      const mine = e.rider === myId();
      if (mine) {
        beep(e.hit ? 880 : 220, 0.15);
        if (e.hit) setTimeout(() => beep(1320, 0.12), 120);
        banner(e.hit ? `${e.label} nailed! ×${e.multiplier}` : `${e.label} missed – ×${e.multiplier}`, e.hit ? "hit" : "miss");
      }
      if (e.hit && (mine || e.streak >= 3)) feed(`${who(e.rider)} nailed ${esc(e.label)} → ×${e.multiplier}${e.streak >= 3 ? ` 🔥${e.streak}` : ""}`, "hit");
      break;
    }
    case "frenzy":
      sim.frenzy = e.on;
      $("#frenzy").hidden = !e.on;
      if (e.on) {
        feed(`<b>Feeding frenzy!</b> ${e.riders} riders on target: everyone ×1.5`, "frenzy");
        beep(660, 0.3);
      }
      break;
    case "level":
      sim.levelUp();
      banner(`The horde grows: ${e.name} (level ${e.level})`, "level");
      feed(`The horde reached level ${e.level}: <b>${esc(e.name)}</b>`, "level");
      beep(330, 0.4);
      break;
    case "joined":
      feed(`${who(e.rider, e.name)} started ${esc(e.workout)}${e.bot ? ' <span class="muted">(bot)</span>' : ""}`);
      break;
    case "done":
      if (e.rider !== myId()) feed(`${who(e.rider, e.name)} finished: ${fmt.format(e.sweat)} drops fed`);
      break;
  }
}

function onSummary(s: SessionSummary) {
  if (riding) endRide(s);
}

// --- sound ---------------------------------------------------------------------------------------
let audio: AudioContext | undefined;
function ensureAudio() {
  audio ??= new AudioContext();
}
function beep(freq: number, duration = 0.12, volume = 0.1) {
  if (!audio || settings.muted) return;
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
const syncMute = () => ($("#mute").textContent = settings.muted ? "🔇" : "🔊");
$("#mute").addEventListener("click", () => {
  settings.muted = !settings.muted;
  saveSettings();
  syncMute();
});
syncMute();

// --- every frame ---------------------------------------------------------------------------------
let shownTotal = -1;
const labels = new Map<string, HTMLDivElement>();

function riderViews(s: HordeState): RiderView[] {
  const views: RiderView[] = [];
  s.riders.forEach((r, id) => {
    if (!r.active) return;
    views.push({
      id,
      name: r.name,
      color: r.color,
      me: id === myId(),
      bot: r.bot,
      intensity: r.intensity || 0,
      rate: r.rate || 0,
      multiplier: r.multiplier || 1,
      onTarget: r.onTarget,
      paused: r.paused,
    });
  });
  return views;
}

function topbar(s: HordeState, dt: number) {
  if (!Number.isFinite(s.total)) return; // not synced yet
  shownTotal = shownTotal < 0 ? s.total : shownTotal + (s.total - shownTotal) * Math.min(1, dt * 3);
  $("#total").textContent = fmt.format(Math.floor(shownTotal));
  $("#level").textContent = String(s.level);
  $("#level-name").textContent = s.levelName || "The Horde";
  const span = s.levelNext - s.levelFloor;
  $("#level-bar").style.width = `${span > 0 ? Math.min(100, ((s.total - s.levelFloor) / span) * 100) : 0}%`;
  $("#rate").textContent = s.rate > 0 ? `· +${fmt.format(s.rate * 3600)}/h right now` : "· nobody feeding them…";
}

function roster(s: HordeState) {
  const active: string[] = [];
  const watching: string[] = [];
  s.riders.forEach((r, id) => {
    const raw = id === myId() ? `${r.name} (you)` : r.name;
    if (!r.active) {
      watching.push(raw);
      return;
    }
    const name = esc(raw);
    const color = RIDER_COLORS[r.color % RIDER_COLORS.length];
    const status = r.paused ? "paused" : `${Math.round(r.intensity * 100)} %`;
    active.push(
      `<li${r.onTarget ? ' class="on"' : ""}><span class="dot" style="background:${color}"></span><span class="r-name">${name}${r.bot ? ' <span class="muted small">bot</span>' : ""}</span><span class="r-mult">×${r.multiplier}</span><span class="r-info muted small">${esc(r.workoutTitle)} · ${status} · ${fmt.format(r.sweat)}</span></li>`,
    );
  });
  const html = active.join("") || '<li class="muted small">Nobody is riding right now. Be the first!</li>';
  if ($("#riders").innerHTML !== html) $("#riders").innerHTML = html;
  $("#watchers").textContent = watching.length ? `Watching: ${watching.join(", ")}` : "";
}

function placeLabels() {
  const seen = new Set<string>();
  for (const r of sim.riders.values()) {
    seen.add(r.id);
    let el = labels.get(r.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "tag";
      $("#labels").append(el);
      labels.set(r.id, el);
    }
    const p = arena.project(r.x, 3.2, r.z);
    el.hidden = !p;
    if (!p) continue;
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    el.style.opacity = String(r.presence);
    el.style.setProperty("--c", RIDER_COLORS[r.color % RIDER_COLORS.length]!);
    el.classList.toggle("me", r.me);
    const text = `${r.me ? "You" : r.name} ×${r.multiplier}`;
    if (el.textContent !== text) el.textContent = text;
  }
  for (const [id, el] of labels) {
    if (!seen.has(id)) {
      el.remove();
      labels.delete(id);
    }
  }
}

/** The part of the screen not covered by panels: the arena is centred there. */
function freeArea() {
  const w = innerWidth;
  const h = innerHeight;
  const top = $(".topbar").getBoundingClientRect().bottom;
  const panel = [$("#setup"), $("#result"), $("#hud")].find((el) => !el.hidden);
  const rect = panel?.getBoundingClientRect();
  if (!rect || !rect.width) return { x: 0, y: top, w, h: h - top };
  if (w <= 760) return { x: 0, y: top, w, h: Math.max(120, rect.top - top) }; // panel at the bottom
  return { x: rect.right, y: top, w: Math.max(200, w - rect.right), h: h - top };
}

let prev = performance.now();
let uiClock = 0;
function frame(now: number) {
  const dt = Math.min(0.1, Math.max(0, (now - prev) / 1000));
  prev = now;
  const s = state();
  if (s) {
    sim.setLevel(s.level);
    sim.setRiders(riderViews(s));
    sim.frenzy = s.frenzy > 0;
    $("#frenzy").hidden = !sim.frenzy;
    topbar(s, dt);
  } else if (sim.zombies.length === 0) {
    sim.setLevel(3); // something to look at while connecting
  }
  sim.update(dt, s?.rate || 0);
  arena.focus = freeArea();
  arena.render(sim, dt);
  placeLabels();

  driveSimulatedRider(dt);
  uiClock += dt;
  if (uiClock > 0.2) {
    uiClock = 0;
    if (s) roster(s);
    const r = me();
    if (riding && r?.active) {
      hudFrame(r);
      applyErg();
    }
    // Keep the server fed while riding even if the device goes quiet between notifications.
    if (riding && performance.now() - latest.at < 3000) conn?.sample({ power: latest.power, cadence: latest.cadence, heartRate: latest.heartRate || undefined });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateStart();
void connect();
