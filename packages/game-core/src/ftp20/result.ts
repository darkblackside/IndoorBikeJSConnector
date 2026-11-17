/**
 * Recording a 20-minute FTP test session and working out the result: FTP = average power of the 20-minute test ×
 * 0.95, plus how even the pacing was.
 */
import type { Sample } from "../zombie-ramp/ramp.ts";
import { blockAt, PHASE_SECONDS, type Block, type Ftp20Config, type Ftp20Phase } from "./plan.ts";

export interface Ftp20Sample extends Sample {
  phase: Ftp20Phase;
  /** Seconds into the phase. */
  phaseTime: number;
}

/** Records 1 Hz samples over the whole session and the lap starts (one lap per block) for the activity file. */
export class Ftp20Recorder {
  readonly samples: Ftp20Sample[] = [];
  /** Session times at which a block started (with samples), for `buildActivity`. */
  readonly lapStarts: number[] = [];
  private lapKeys: number[] = [];

  constructor(readonly blocks: readonly Block[]) {}

  /**
   * Call often; keeps one sample per whole session second. `target` is the ERG target (0 when the rider sets the
   * power, as in the test).
   */
  record(
    t: number,
    phase: Ftp20Phase,
    phaseTime: number,
    power: number,
    heartRate?: number,
    extra: { cadence?: number; speed?: number; target?: number } = {},
  ): void {
    const sec = Math.floor(t);
    const last = this.samples.at(-1);
    if (last && last.t >= sec) return;
    const { target = 0, ...rest } = extra;
    this.samples.push({ t: sec, power, target, heartRate, phase, phaseTime, ...rest });
    const key = blockAt(this.blocks, phase, phaseTime).index;
    if (this.lapKeys.at(-1) !== key) {
      this.lapKeys.push(key);
      this.lapStarts.push(sec);
    }
  }

  /** Drop samples after `t` (the clock was wound back to when the rider stopped). */
  truncate(t: number): void {
    while (this.samples.length && this.samples.at(-1)!.t > t) this.samples.pop();
    while (this.lapStarts.length && this.lapStarts.at(-1)! > t) {
      this.lapStarts.pop();
      this.lapKeys.pop();
    }
  }

  /** The samples of the 20-minute test. */
  testSamples(): Ftp20Sample[] {
    return this.samples.filter((s) => s.phase === "test");
  }
}

export type PacingVerdict = "even" | "faded" | "negative-split";

export interface Ftp20Result {
  /** All 20 minutes of the test were ridden. */
  complete: boolean;
  /** The rider aborted the test after stopping. */
  aborted: boolean;
  /** Times the rider stopped during the test and went on: the FTP is then unreliable. */
  interruptions: number;
  /** The FTP is a proper 20-minute test result (complete, not interrupted). */
  reliable: boolean;
  /** Seconds of the test ridden. */
  testSeconds: number;
  /** Average power over the test seconds ridden. */
  avgPower?: number;
  /** avgPower × 0.95; only for a complete, not aborted test (shown as unreliable when interrupted). */
  ftp?: number;
  /** Average power of each 5-minute block of the test. */
  blockPowers: number[];
  firstHalfPower?: number;
  secondHalfPower?: number;
  /** secondHalf / firstHalf − 1. */
  split?: number;
  pacing?: PacingVerdict;
  /** Coefficient of variation of the 30 s rolling power (0.05 = 5 %): lower = steadier. */
  variability?: number;
  maxPower?: number;
  avgCadence?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
}

/** A test this close to 20 minutes (in seconds) counts as complete (whole-second sampling). */
const COMPLETE_TOLERANCE = 2;
/** Halves within ±5 % count as even pacing. */
export const EVEN_SPLIT = 0.05;

const mean = (v: readonly number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined);
const round = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));

export function ftp20Result(
  cfg: Ftp20Config,
  testSamples: readonly Sample[],
  opts: { testSeconds: number; interruptions?: number; aborted?: boolean },
): Ftp20Result {
  const interruptions = opts.interruptions ?? 0;
  const aborted = opts.aborted ?? false;
  const complete = !aborted && opts.testSeconds >= PHASE_SECONDS.test - COMPLETE_TOLERANCE;
  const p = testSamples.map((s) => s.power);
  const avg = mean(p);
  const half = Math.floor(p.length / 2);
  const first = mean(p.slice(0, half));
  const second = mean(p.slice(half));
  const split = first && second !== undefined ? second / first - 1 : undefined;
  const blockPowers: number[] = [];
  for (let i = 0; i < p.length; i += 300) blockPowers.push(Math.round(mean(p.slice(i, i + 300))!));

  let variability: number | undefined;
  if (p.length >= 60) {
    const rolling: number[] = [];
    let sum = p.slice(0, 30).reduce((a, b) => a + b, 0);
    rolling.push(sum / 30);
    for (let i = 30; i < p.length; i++) {
      sum += p[i]! - p[i - 30]!;
      rolling.push(sum / 30);
    }
    const m = mean(rolling)!;
    const sd = Math.sqrt(mean(rolling.map((r) => (r - m) ** 2))!);
    variability = m > 0 ? sd / m : undefined;
  }
  const hr = testSamples.map((s) => s.heartRate).filter((v): v is number => v !== undefined);
  const cad = testSamples.map((s) => s.cadence).filter((v): v is number => !!v);

  return {
    complete,
    aborted,
    interruptions,
    reliable: complete && interruptions === 0,
    testSeconds: opts.testSeconds,
    avgPower: round(avg),
    ftp: complete && avg !== undefined ? Math.round(avg * cfg.ftpFactor) : undefined,
    blockPowers,
    firstHalfPower: round(first),
    secondHalfPower: round(second),
    split,
    pacing:
      split === undefined || p.length < 120
        ? undefined
        : split > EVEN_SPLIT
          ? "negative-split"
          : split < -EVEN_SPLIT
            ? "faded"
            : "even",
    variability,
    maxPower: p.length ? Math.max(...p) : undefined,
    avgCadence: round(mean(cad)),
    avgHeartRate: round(mean(hr)),
    maxHeartRate: hr.length ? Math.max(...hr) : undefined,
  };
}

/** One or two sentences on the pacing, for the result screen. */
export function pacingSummary(r: Ftp20Result): string | undefined {
  if (r.pacing === undefined || r.split === undefined) return undefined;
  const pct = Math.round(Math.abs(r.split) * 100);
  switch (r.pacing) {
    case "even":
      return `Even pacing: your second half was within ${Math.max(pct, 1)} % of the first. That's how a 20-minute test should be ridden.`;
    case "faded":
      return `You faded: your second half was ${pct} % below the first. Next time start a little easier – you'll likely get a higher FTP.`;
    case "negative-split":
      return `Your second half was ${pct} % stronger than the first: you had more in the tank. Next time start a little harder.`;
  }
}

/** Honest note on how far to trust the FTP, for the result screen. */
export function resultNote(r: Ftp20Result, cfg: Ftp20Config): string {
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  if (r.aborted) {
    return `Test aborted after ${mmss(r.testSeconds)} of 20:00 – no valid FTP was measured. An FTP needs the full 20 minutes at an even, maximal effort.`;
  }
  if (!r.complete) {
    return r.testSeconds > 0
      ? `Test incomplete: ${mmss(r.testSeconds)} of 20:00 ridden, so there's no FTP. An FTP needs the full 20 minutes.`
      : "The test didn't start, so there's no FTP yet.";
  }
  const calc = `20-minute average ${r.avgPower} W × ${cfg.ftpFactor} = ${r.ftp} W.`;
  if (r.interruptions > 0) {
    return `${calc} Not reliable: the test was interrupted (${r.interruptions === 1 ? "one stop" : `${r.interruptions} stops`}). The rest lets you recover, so this is not a true 20-minute effort and the FTP is likely too high.`;
  }
  return `${calc} The 5 % off accounts for a 20-minute effort being a little above what you can hold for an hour.`;
}
