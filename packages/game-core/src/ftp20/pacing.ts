/**
 * Pacing coach for the 20-minute test. It compares the rider's recent power with their own running average of the
 * test so far and says whether to ease off, hold or push, adapted to the block (don't start too hot, empty the tank
 * in the last minutes).
 *
 * The advice never contains watts, the average or an FTP estimate: the rider should pace by feel and steadiness,
 * not chase a number. Only the relative deviation (e.g. "+4 % above your average") is exposed, and it is based on a
 * 20-second average, not the 3-second power shown in the HUD.
 */
import { PHASE_SECONDS } from "./plan.ts";

export type PaceZone = "way-under" | "under" | "steady" | "over" | "way-over";
export type PaceTone = "info" | "good" | "warn" | "push";

export interface PacingAdvice {
  /** False in the first minute: there is no average to compare with yet. */
  ready: boolean;
  /** Recent power relative to the running average (0.04 = 4 % above), when ready. */
  deviation?: number;
  zone?: PaceZone;
  text: string;
  tone: PaceTone;
}

/** Seconds of the recent window compared with the average. */
export const RECENT_SECONDS = 20;
/** Seconds of test before the gauge starts comparing. */
export const PACING_READY_SECONDS = 60;
/** Within ±STEADY of the average counts as steady; beyond ±STRONG as way off. */
export const STEADY_BAND = 0.03;
export const STRONG_BAND = 0.08;
/** From here (test seconds) the advice is to empty the tank. */
export const FINAL_PUSH_AT = 17 * 60;

export function paceZone(deviation: number): PaceZone {
  if (deviation > STRONG_BAND) return "way-over";
  if (deviation > STEADY_BAND) return "over";
  if (deviation < -STRONG_BAND) return "way-under";
  if (deviation < -STEADY_BAND) return "under";
  return "steady";
}

/** Advice for a zone at `t` seconds into the test. Texts only, no numbers. */
export function pacingText(zone: PaceZone, t: number): { text: string; tone: PaceTone } {
  const block = Math.min(3, Math.floor(t / 300));
  if (t >= FINAL_PUSH_AT) {
    if (zone === "way-over" || zone === "over") return { text: "That's it – empty the tank!", tone: "good" };
    return { text: "Everything you have left – push!", tone: "push" };
  }
  if (block === 3) {
    if (zone === "way-over") return { text: "Strong! Hold this – the all-out comes at 17:00", tone: "good" };
    if (zone === "over") return { text: "Building – good", tone: "good" };
    if (zone === "steady") return { text: "Steady – start lifting it gradually", tone: "good" };
    return { text: "You have more – push", tone: "push" };
  }
  switch (zone) {
    case "way-over":
      return {
        text: block === 0 ? "Too hot – ease off a little. The start should feel controlled" : "Too hot – ease off a little",
        tone: "warn",
      };
    case "over":
      return block === 0
        ? { text: "A bit hot – settle back into your rhythm", tone: "warn" }
        : { text: "Slightly above your average – only if you can hold it", tone: "warn" };
    case "steady":
      return { text: "Steady, hold this", tone: "good" };
    case "under":
      return { text: "A touch under your average – lift it slightly", tone: "push" };
    case "way-under":
      return { text: "You have more – push", tone: "push" };
  }
}

/** Feed it the test's 1 Hz power samples; ask it for advice at any time. */
export class PacingCoach {
  private readonly powers: number[] = [];
  private sum = 0;

  /** Power of test second `t` (whole seconds, in order; repeated seconds are ignored). */
  push(t: number, power: number): void {
    const sec = Math.floor(t);
    if (sec < this.powers.length) return;
    while (this.powers.length < sec) this.add(this.powers.at(-1) ?? 0); // fill gaps (sped-up simulation)
    this.add(Math.max(0, power));
  }

  /** Drop seconds after `t` (the clock was wound back to when the rider stopped). */
  truncate(t: number): void {
    while (this.powers.length > Math.floor(t) + 1) this.sum -= this.powers.pop()!;
  }

  /** Seconds recorded. */
  get seconds(): number {
    return this.powers.length;
  }

  advice(t = this.powers.length): PacingAdvice {
    if (this.powers.length < PACING_READY_SECONDS || t < PACING_READY_SECONDS) {
      return { ready: false, text: "Ease into it – controlled, don't start too hot", tone: "info" };
    }
    const avg = this.sum / this.powers.length;
    const recent = this.powers.slice(-RECENT_SECONDS);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const deviation = avg > 0 ? recentAvg / avg - 1 : 0;
    const zone = paceZone(deviation);
    return { ready: true, deviation, zone, ...pacingText(zone, Math.min(t, PHASE_SECONDS.test)) };
  }

  private add(p: number): void {
    this.powers.push(p);
    this.sum += p;
  }
}
