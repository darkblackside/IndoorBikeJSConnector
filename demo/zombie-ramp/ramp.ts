/**
 * Ramp FTP test logic, independent of rendering and Bluetooth.
 *
 * Protocol: optional warm-up at a fixed wattage, then the target rises by `stepWatts`
 * every `stepSeconds` until the rider gives up. FTP = target of the last fully
 * completed step × `ftpFactor` (0.75).
 */
export interface RampConfig {
  warmupSeconds: number;
  warmupWatts: number;
  startWatts: number;
  stepWatts: number;
  stepSeconds: number;
  ftpFactor: number;
}

export const defaultRampConfig: RampConfig = {
  warmupSeconds: 5 * 60,
  warmupWatts: 100,
  startWatts: 100,
  stepWatts: 25,
  stepSeconds: 60,
  ftpFactor: 0.75,
};

export interface RampState {
  phase: "warmup" | "ramp";
  /** 0-based ramp step; -1 during warm-up. */
  step: number;
  target: number;
  /** Seconds into the current warm-up/step. */
  elapsed: number;
  /** Seconds left in the current warm-up/step. */
  remaining: number;
  /** Target of the next phase/step. */
  nextTarget: number;
}

export const stepWatts = (cfg: RampConfig, step: number) => cfg.startWatts + step * cfg.stepWatts;

/** Where in the protocol we are `t` seconds after the start. */
export function rampStateAt(cfg: RampConfig, t: number): RampState {
  if (t < cfg.warmupSeconds) {
    return {
      phase: "warmup",
      step: -1,
      target: cfg.warmupWatts,
      elapsed: t,
      remaining: cfg.warmupSeconds - t,
      nextTarget: stepWatts(cfg, 0),
    };
  }
  const r = t - cfg.warmupSeconds;
  const step = Math.floor(r / cfg.stepSeconds);
  const elapsed = r - step * cfg.stepSeconds;
  return {
    phase: "ramp",
    step,
    target: stepWatts(cfg, step),
    elapsed,
    remaining: cfg.stepSeconds - elapsed,
    nextTarget: stepWatts(cfg, step + 1),
  };
}

/** Number of ramp steps fully completed after riding `t` seconds. */
export function completedSteps(cfg: RampConfig, t: number): number {
  return Math.max(0, Math.floor((t - cfg.warmupSeconds) / cfg.stepSeconds));
}

export interface RampResult {
  /** undefined when no ramp step was completed. */
  ftp?: number;
  completedSteps: number;
  /** Target of the last fully completed step. */
  lastStepWatts?: number;
  /** Best measured 60 s average power. */
  bestMinutePower?: number;
  maxPower?: number;
  maxHeartRate?: number;
  duration: number;
  endedInWarmup: boolean;
}

export interface Sample {
  t: number;
  power: number;
  target: number;
  heartRate?: number;
}

/** Records 1 Hz samples and evaluates the test. */
export class RampRecorder {
  readonly samples: Sample[] = [];
  constructor(readonly cfg: RampConfig) {}

  /** Call often; keeps one sample per whole second. */
  record(t: number, power: number, heartRate?: number): void {
    const sec = Math.floor(t);
    const last = this.samples.at(-1);
    if (last && Math.floor(last.t) === sec) return;
    this.samples.push({ t: sec, power, target: rampStateAt(this.cfg, sec).target, heartRate });
  }

  /** Drop samples after `t` (the clock was wound back, e.g. to when a paused warm-up stopped). */
  truncate(t: number): void {
    while (this.samples.length && this.samples.at(-1)!.t > t) this.samples.pop();
  }

  result(duration: number): RampResult {
    const cfg = this.cfg;
    const steps = completedSteps(cfg, duration);
    const lastStepWatts = steps > 0 ? stepWatts(cfg, steps - 1) : undefined;
    const p = this.samples.map((s) => s.power);
    let best: number | undefined;
    if (p.length >= 60) {
      let sum = p.slice(0, 60).reduce((a, b) => a + b, 0);
      best = sum;
      for (let i = 60; i < p.length; i++) {
        sum += p[i]! - p[i - 60]!;
        best = Math.max(best, sum);
      }
      best /= 60;
    }
    const hr = this.samples.map((s) => s.heartRate).filter((v): v is number => v !== undefined);
    return {
      ftp: lastStepWatts === undefined ? undefined : Math.round(lastStepWatts * cfg.ftpFactor),
      completedSteps: steps,
      lastStepWatts,
      bestMinutePower: best === undefined ? undefined : Math.round(best),
      maxPower: p.length ? Math.max(...p) : undefined,
      maxHeartRate: hr.length ? Math.max(...hr) : undefined,
      duration,
      endedInWarmup: duration < cfg.warmupSeconds,
    };
  }
}

/**
 * Detects that the rider stopped pedalling: cadence (or power, for devices
 * without cadence) below a threshold, or no data at all, for `holdSeconds`.
 */
export class StopDetector {
  private lastPedalling: number | undefined;
  constructor(
    readonly holdSeconds = 4,
    readonly minCadence = 20,
    readonly minPower = 20,
  ) {}

  isPedalling(cadence: number | undefined, power: number | undefined): boolean {
    return cadence !== undefined ? cadence >= this.minCadence : (power ?? 0) >= this.minPower;
  }

  /** `now` in seconds. `fresh` = data arrived recently. Returns true once stopped. */
  update(now: number, cadence: number | undefined, power: number | undefined, fresh = true): boolean {
    if (fresh && this.isPedalling(cadence, power)) this.lastPedalling = now;
    this.lastPedalling ??= now;
    return now - this.lastPedalling >= this.holdSeconds;
  }

  /** Time the rider was last seen pedalling (when the stop actually happened). */
  get lastPedallingAt(): number | undefined {
    return this.lastPedalling;
  }

  reset(): void {
    this.lastPedalling = undefined;
  }
}

/**
 * What stopping does at test time `t` (when the rider was last seen pedalling): during the warm-up the
 * test only pauses and goes on when the rider pedals again; once the ramp has started it ends the test.
 */
export function onStop(cfg: RampConfig, t: number): "pause" | "finish" {
  return rampStateAt(cfg, t).phase === "warmup" ? "pause" : "finish";
}

/**
 * Where the horde settles behind a rider who holds the target, by cadence: 50 m at 90 rpm or more,
 * 10 m at 40 rpm or less, on a straight line in between (0.8 m per rpm). Grinding a low cadence lets them close in.
 */
export function restGapForCadence(rpm: number): number {
  const c = Math.min(90, Math.max(40, rpm));
  return 10 + (c - 40) * 0.8;
}

/**
 * A little life in the chase: how far (metres, within ±5) the horde surges ahead of or falls back from where it
 * should be at time `t` (seconds). Two slow waves that never line up exactly, so it doesn't feel mechanical.
 */
export function gapSurge(t: number): number {
  return 3 * Math.sin(t * 0.8) + 2 * Math.sin(t * 1.9 + 1.3);
}

/** Flat-road speed in m/s for a power, same physics as the library's SIM mode (84 kg system). */
export function speedFromPower(watts: number, mass = 84, crr = 0.004, cw = 0.51): number {
  if (watts <= 0) return 0;
  const a = mass * 9.81 * crr;
  let v = Math.cbrt(watts / cw);
  for (let i = 0; i < 20; i++) {
    const f = a * v + cw * v ** 3 - watts;
    v -= f / (a + 3 * cw * v * v);
  }
  return v;
}
