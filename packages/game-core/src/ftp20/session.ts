/**
 * The clock of a 20-minute FTP test session: which phase and block we are in, what happens next, skipping the
 * warm-up or the cool-down, and winding the clock back when the rider stopped (pauses). The game feeds it game
 * seconds; it reports what changed as events so the game can show banners, set ERG and change the scenery.
 */
import {
  blockAt,
  COUNTDOWN_SECONDS,
  ergTargetAt,
  PHASE_SECONDS,
  planBlocks,
  type Block,
  type BlockState,
  type Ftp20Config,
  type Ftp20Phase,
} from "./plan.ts";

export type Ftp20Event =
  | { type: "phase"; phase: Ftp20Phase }
  | { type: "block"; block: Block; index: number }
  | { type: "cue"; text: string }
  /** Whole seconds left before the test starts (counts down from COUNTDOWN_SECONDS). */
  | { type: "countdown"; seconds: number }
  /** The full 20 minutes of the test were ridden. */
  | { type: "test-complete" }
  /** The cool-down is over (or was skipped): show the result. */
  | { type: "done" };

export interface Ftp20SessionState extends BlockState {
  phase: Ftp20Phase;
  /** Seconds into the phase. */
  phaseTime: number;
  /** ERG target right now, undefined when the rider sets the power (test, countdown). */
  target?: number;
  /** Seconds before the test starts, during the countdown at the end of the warm-up. */
  countdown?: number;
}

export class Ftp20Session {
  readonly blocks: Block[];
  /** Session time in seconds: ridden time over all phases, pauses not counted. */
  t = 0;
  phase: Ftp20Phase = "warmup";
  /** Seconds into the current phase. */
  phaseTime = 0;
  /** Session time at which each phase started (the test's start is where the 20 minutes count from). */
  readonly phaseStarts: Partial<Record<Ftp20Phase, number>> = { warmup: 0 };
  done = false;
  /**
   * How often the rider stopped during the test and chose to go on. Paused time is not counted towards the 20
   * minutes (the clock waits), but the rest lets the rider recover, so the average (and the FTP) is no longer a
   * true 20-minute effort: the result is shown as unreliable.
   */
  interruptions = 0;
  /** The rider chose to abort the test after stopping. */
  aborted = false;
  private lastBlock = -1;
  private lastCountdown = -1;
  /** Phase time of the last advance: cues between it and the new phase time fire. */
  private lastPhaseTime = -1e-9;

  constructor(readonly cfg: Ftp20Config) {
    this.blocks = planBlocks(cfg);
  }

  get state(): Ftp20SessionState {
    const b = blockAt(this.blocks, this.phase, this.phaseTime);
    const left = PHASE_SECONDS.warmup - this.phaseTime;
    return {
      ...b,
      phase: this.phase,
      phaseTime: this.phaseTime,
      target: ergTargetAt(this.blocks, this.phase, this.phaseTime),
      countdown: this.phase === "warmup" && left <= COUNTDOWN_SECONDS ? left : undefined,
    };
  }

  /** Seconds of the test ridden so far (0 before it, 1200 once complete). */
  get testTime(): number {
    if (this.phase === "warmup") return 0;
    return this.phase === "test" ? this.phaseTime : PHASE_SECONDS.test;
  }

  /**
   * What stopping pedalling does right now: during the warm-up and the cool-down the session just pauses until the
   * rider pedals again; during the test the rider is asked whether to continue (result unreliable) or abort.
   */
  stopAction(): "pause" | "ask" {
    return this.phase === "test" ? "ask" : "pause";
  }

  /** The rider stopped during the test and chose to continue. */
  markInterrupted(): void {
    if (this.phase === "test") this.interruptions++;
  }

  /** The rider stopped during the test and chose to abort: the session is over, without a valid FTP. */
  abort(): Ftp20Event[] {
    if (this.done) return [];
    this.aborted = true;
    this.done = true;
    return [{ type: "done" }];
  }

  /** Move the clock on by `dt` game seconds. Returns what happened, in order. */
  advance(dt: number): Ftp20Event[] {
    const events: Ftp20Event[] = [];
    if (this.done) return events;
    if (this.lastBlock === -1) this.emitBlock(events);
    let left = Math.max(0, dt);
    // A big step (sped-up simulation) can cross a phase boundary: carry the rest into the next phase.
    while (left > 0 && !this.done) {
      const len = PHASE_SECONDS[this.phase];
      const step = Math.min(left, len - this.phaseTime);
      this.t += step;
      this.phaseTime += step;
      left -= step;
      this.emitWithin(events);
      if (this.phaseTime >= len - 1e-9) this.nextPhase(events);
    }
    return events;
  }

  /** Jump to the countdown before the test (the rider is warmed up already). */
  skipWarmup(): Ftp20Event[] {
    if (this.phase !== "warmup") return [];
    const at = PHASE_SECONDS.warmup - COUNTDOWN_SECONDS;
    if (this.phaseTime < at) {
      this.phaseTime = at;
      this.lastPhaseTime = at - 1e-6;
    }
    const events: Ftp20Event[] = [];
    this.emitWithin(events);
    return events;
  }

  /** End the cool-down now. */
  skipCooldown(): Ftp20Event[] {
    if (this.phase !== "cooldown" || this.done) return [];
    this.done = true;
    return [{ type: "done" }];
  }

  /**
   * Wind the clock back to session time `t` (when the rider was last seen pedalling), never before the start of
   * the current phase.
   */
  rewind(t: number): void {
    const start = this.phaseStarts[this.phase] ?? 0;
    const to = Math.max(start, Math.min(this.t, t));
    this.phaseTime -= this.t - to;
    this.t = to;
    this.lastPhaseTime = this.phaseTime;
  }

  private emitWithin(events: Ftp20Event[]): void {
    const st = blockAt(this.blocks, this.phase, this.phaseTime);
    if (st.index !== this.lastBlock) this.emitBlock(events);
    for (const cue of st.block.cues) {
      const at = st.block.start + cue.at;
      if (this.lastPhaseTime < at && at <= this.phaseTime) events.push({ type: "cue", text: cue.text });
    }
    const left = PHASE_SECONDS.warmup - this.phaseTime;
    if (this.phase === "warmup" && left <= COUNTDOWN_SECONDS) {
      const s = Math.ceil(left);
      if (s !== this.lastCountdown && s > 0) events.push({ type: "countdown", seconds: s });
      this.lastCountdown = s;
    }
    this.lastPhaseTime = this.phaseTime;
  }

  private emitBlock(events: Ftp20Event[]): void {
    const st = blockAt(this.blocks, this.phase, this.phaseTime);
    this.lastBlock = st.index;
    events.push({ type: "block", block: st.block, index: st.index });
    // Cues at the very start of a block fire with it.
    for (const cue of st.block.cues) {
      const at = st.block.start + cue.at;
      if (at === st.block.start && this.lastPhaseTime < at && at <= this.phaseTime) {
        events.push({ type: "cue", text: cue.text });
      }
    }
    this.lastPhaseTime = Math.max(this.lastPhaseTime, st.block.start);
  }

  private nextPhase(events: Ftp20Event[]): void {
    if (this.phase === "cooldown") {
      this.phaseTime = PHASE_SECONDS.cooldown;
      this.done = true;
      events.push({ type: "done" });
      return;
    }
    if (this.phase === "test") events.push({ type: "test-complete" });
    this.phase = this.phase === "warmup" ? "test" : "cooldown";
    this.phaseTime = 0;
    this.phaseStarts[this.phase] = this.t;
    this.lastPhaseTime = -1e-9;
    events.push({ type: "phase", phase: this.phase });
    this.emitBlock(events);
  }
}
