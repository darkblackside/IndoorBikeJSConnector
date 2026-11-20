/**
 * One rider's session in Feed the Horde: the workout clock, block judging, the multiplier ladder and the sweat.
 * The server runs one per riding client (and per bot) and is the only one that counts sweat; the numbers the
 * client shows come from the synced room state.
 */
import {
  clamp,
  GOVERNOR_CAP,
  GOVERNOR_LIMIT,
  GOVERNOR_WINDOW,
  intensityOf,
  MAX_POWER,
  MULTIPLIER_STEPS,
  sweatPerSecond,
} from "./sweat.ts";
import { FREE_BLOCK_SECONDS, getWorkout, workoutSeconds, type Workout, type WorkoutBlock, type WorkoutId } from "./workouts.ts";

/** Allowed miss around the target band (fraction of FTP), for power meter noise. */
export const BAND_TOLERANCE = 0.03;
/** Share of a block that has to be inside the band. */
export const IN_BAND_SHARE = 0.7;
/** Blocks shorter than this (sprints) are judged by their average only. */
export const SHORT_BLOCK = 30;
/** Free play: a 3-minute stretch counts when its average is at least this … */
export const FREE_MIN_INTENSITY = 0.55;
/** … and it was steady (coefficient of variation of the power at most this). */
export const FREE_MAX_CV = 0.15;
/** Coasting longer than this (s) pauses the workout clock. */
export const PAUSE_AFTER = 3;
/** Smoothing of the shown intensity (s). */
const SMOOTH_TAU = 3;

export interface RiderInput {
  power: number;
  cadence: number;
}

export type SessionEvent =
  | { type: "block"; index: number; label: string; hit: boolean; multiplier: number; streak: number }
  | { type: "done" };

export interface SessionSummary {
  workout: WorkoutId;
  short: boolean;
  title: string;
  sweat: number;
  /** Seconds ridden (workout clock). */
  seconds: number;
  blocksHit: number;
  blocksJudged: number;
  bestStreak: number;
  maxMultiplier: number;
  avgPower: number;
  completed: boolean;
}

/** Running sums for judging the current block. */
class BlockJudge {
  seconds = 0;
  inBand = 0;
  sum = 0;
  sumSq = 0;
  reset() {
    this.seconds = this.inBand = this.sum = this.sumSq = 0;
  }
  add(dt: number, raw: number, smooth: number, block: WorkoutBlock) {
    this.seconds += dt;
    this.sum += raw * dt;
    this.sumSq += raw * raw * dt;
    if (smooth >= block.low - BAND_TOLERANCE && smooth <= block.high + BAND_TOLERANCE) this.inBand += dt;
  }
  get avg() {
    return this.seconds > 0 ? this.sum / this.seconds : 0;
  }
  get cv() {
    if (this.seconds <= 0 || this.avg <= 0) return Infinity;
    const variance = Math.max(0, this.sumSq / this.seconds - this.avg * this.avg);
    return Math.sqrt(variance) / this.avg;
  }
  verdict(block: WorkoutBlock): boolean {
    if (this.seconds <= 0) return false;
    if (block.kind === "free") return this.avg >= FREE_MIN_INTENSITY && this.cv <= FREE_MAX_CV;
    if (block.seconds < SHORT_BLOCK) return this.avg >= block.low - BAND_TOLERANCE;
    const avgOk = this.avg >= block.low - BAND_TOLERANCE && this.avg <= block.high + BAND_TOLERANCE;
    return avgOk && this.inBand / this.seconds >= IN_BAND_SHARE;
  }
}

export class RiderSession {
  readonly workout: Workout;
  readonly totalSeconds: number;
  /** Workout clock (s): only runs while pedalling. */
  t = 0;
  blockIndex = 0;
  /** Seconds into the current block. */
  blockT = 0;
  step = 0;
  streak = 0;
  bestStreak = 0;
  blocksHit = 0;
  blocksJudged = 0;
  maxMultiplier = 1;
  sweat = 0;
  /** Sweat per second right now (after all multipliers). */
  rate = 0;
  /** Smoothed intensity (power / FTP), for the HUD, the ring and "on target". */
  intensity = 0;
  power = 0;
  paused = true;
  done = false;
  /** True while the plausibility governor caps this rider (see `GOVERNOR_LIMIT`). */
  governed = false;
  private coasting = 0;
  private longAvg = 0;
  private workSum = 0;
  private workSeconds = 0;
  private readonly judge = new BlockJudge();

  constructor(
    readonly ftp: number,
    workoutId: WorkoutId,
    readonly short = false,
  ) {
    this.workout = getWorkout(workoutId, short);
    this.totalSeconds = workoutSeconds(this.workout);
  }

  get free() {
    return this.workout.blocks.length === 0;
  }

  /** The block being ridden (free play: an endless series of 3-minute stretches). */
  get block(): WorkoutBlock {
    if (this.free) return { label: `Stretch ${this.blockIndex + 1}`, kind: "free", seconds: FREE_BLOCK_SECONDS, low: 0, high: 0 };
    return this.workout.blocks[Math.min(this.blockIndex, this.workout.blocks.length - 1)]!;
  }

  get nextBlock(): WorkoutBlock | undefined {
    return this.free ? undefined : this.workout.blocks[this.blockIndex + 1];
  }

  get blockLeft() {
    return Math.max(0, this.block.seconds - this.blockT);
  }

  get multiplier() {
    return MULTIPLIER_STEPS[this.step]!;
  }

  /** Inside the target band right now (free play: riding at least tempo-ish). */
  get onTarget(): boolean {
    if (this.paused || this.done) return false;
    const b = this.block;
    if (b.kind === "free") return this.intensity >= 0.75;
    return this.intensity >= b.low - BAND_TOLERANCE && this.intensity <= b.high + BAND_TOLERANCE;
  }

  /**
   * Advance by `dt` seconds with the rider's latest input (undefined: no fresh sample, counts as not pedalling).
   * `bonus` multiplies the sweat on top of the personal multiplier (group frenzy).
   */
  tick(dt: number, input: RiderInput | undefined, bonus = 1): SessionEvent[] {
    const events: SessionEvent[] = [];
    if (this.done || dt <= 0) return events;
    const power = clamp(input?.power ?? 0, 0, MAX_POWER);
    const pedalling = power > 0 || (input?.cadence ?? 0) > 0;
    this.coasting = pedalling ? 0 : this.coasting + dt;
    this.paused = this.coasting >= PAUSE_AFTER;
    this.power = power;

    const raw = intensityOf(power, this.ftp);
    this.intensity += (raw - this.intensity) * (1 - Math.exp(-dt / SMOOTH_TAU));
    this.longAvg += (raw - this.longAvg) * (1 - Math.exp(-dt / GOVERNOR_WINDOW));
    this.governed = this.longAvg > GOVERNOR_LIMIT;
    const counted = this.governed ? Math.min(raw, GOVERNOR_CAP) : raw;

    this.rate = sweatPerSecond(counted) * this.multiplier * bonus;
    this.sweat += this.rate * dt;
    if (this.paused) return events;

    this.workSum += power * dt;
    this.workSeconds += dt;
    this.t += dt;
    this.blockT += dt;
    this.judge.add(dt, raw, this.intensity, this.block);
    while (!this.done && this.blockT >= this.block.seconds) {
      const block = this.block;
      this.blockT -= block.seconds;
      events.push(this.closeBlock(block));
      this.judge.reset();
      this.blockIndex++;
      if (!this.free && this.blockIndex >= this.workout.blocks.length) {
        this.done = true;
        this.blockIndex = this.workout.blocks.length - 1;
        this.blockT = block.seconds;
        events.push({ type: "done" });
      }
    }
    return events;
  }

  private closeBlock(block: WorkoutBlock): SessionEvent {
    const hit = this.judge.verdict(block);
    this.blocksJudged++;
    if (hit) {
      this.blocksHit++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.step = Math.min(MULTIPLIER_STEPS.length - 1, this.step + 1);
    } else {
      this.streak = 0;
      this.step = Math.max(0, this.step - 1);
    }
    this.maxMultiplier = Math.max(this.maxMultiplier, this.multiplier);
    return { type: "block", index: this.blockIndex, label: block.label, hit, multiplier: this.multiplier, streak: this.streak };
  }

  summary(): SessionSummary {
    return {
      workout: this.workout.id,
      short: this.short,
      title: this.workout.title,
      sweat: Math.round(this.sweat),
      seconds: Math.round(this.t),
      blocksHit: this.blocksHit,
      blocksJudged: this.blocksJudged,
      bestStreak: this.bestStreak,
      maxMultiplier: this.maxMultiplier,
      avgPower: this.workSeconds > 0 ? Math.round(this.workSum / this.workSeconds) : 0,
      completed: this.done,
    };
  }
}
