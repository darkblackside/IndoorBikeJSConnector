/**
 * Simulated riders, so nobody who drops by rides alone. The server runs them in-process: a bot shows up now and
 * then, picks a workout, rides it (well, mostly) and leaves again. They feed the horde like everyone else.
 */
import { clamp } from "./sweat.ts";
import type { WorkoutBlock, WorkoutId } from "./workouts.ts";

export interface BotPersona {
  name: string;
  ftp: number;
  /** 0 … 1: how well they hold the target (higher: steadier, fewer missed blocks). */
  skill: number;
  /** Workouts they like (free play included). */
  likes: WorkoutId[];
  /** Usual cadence (rpm). */
  cadence: number;
}

export const BOT_PERSONAS: BotPersona[] = [
  { name: "Grim Gertrud", ftp: 215, skill: 0.85, likes: ["endurance", "sweetspot", "tempo", "free"], cadence: 88 },
  { name: "Bonecrusher Bo", ftp: 290, skill: 0.7, likes: ["vo2max", "speed", "threshold", "overunder"], cadence: 95 },
  { name: "Night Nurse Nia", ftp: 180, skill: 0.92, likes: ["recovery", "endurance", "free", "sweetspot"], cadence: 92 },
];

/** Random draws the bots need; pass a seeded generator (e.g. `mulberry32`) in tests. */
export type Rand = () => number;

/**
 * Produces a bot's power, second by second: aims inside the target band with some wobble, drifts off now and then
 * (lower skill: more often), and sprints flat out.
 */
export class BotPilot {
  private wobble = 0;
  private drift = 0;
  private driftLeft = 0;
  private t = 0;

  constructor(
    readonly persona: BotPersona,
    private readonly rand: Rand,
  ) {}

  /** Power (W) and cadence (rpm) for the next `dt` seconds in this block. */
  ride(dt: number, block: WorkoutBlock): { power: number; cadence: number } {
    const { ftp, skill } = this.persona;
    this.t += dt;
    // Occasional lapse: a stretch of a few tens of seconds too easy or too hard.
    if (this.driftLeft > 0) this.driftLeft -= dt;
    else {
      this.drift = 0;
      if (this.rand() < (1 - skill) * 0.006 * dt) {
        this.drift = (this.rand() < 0.6 ? -1 : 1) * (0.1 + this.rand() * 0.15);
        this.driftLeft = 15 + this.rand() * 60;
      }
    }
    // Wobble: a slow random walk around the aim, smaller for skilled riders.
    const spread = 0.02 + (1 - skill) * 0.06;
    this.wobble = clamp(this.wobble * 0.9 + (this.rand() - 0.5) * spread, -spread * 2, spread * 2);

    let aim: number;
    if (block.kind === "free") aim = 0.68 + Math.sin(this.t / 90) * 0.08;
    else if (block.high >= 2) aim = 1.7 + this.rand() * 0.4; // sprint
    else aim = (block.low + block.high) / 2;
    const intensity = Math.max(0, aim + this.wobble + this.drift);
    const cadence = Math.round(block.cadence ? (block.cadence[0] + block.cadence[1]) / 2 : this.persona.cadence) + Math.round((this.rand() - 0.5) * 6);
    return { power: Math.round(intensity * ftp), cadence };
  }
}

/** How long a bot stays away between sessions (s): a few minutes, sometimes longer. */
export const botAwaySeconds = (rand: Rand) => 120 + rand() * 900;

/** Free play length for a bot (s). */
export const botFreePlaySeconds = (rand: Rand) => 600 + rand() * 900;
