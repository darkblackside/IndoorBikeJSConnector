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
