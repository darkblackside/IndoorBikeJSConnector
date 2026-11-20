/**
 * Workouts for Feed the Horde. Targets are fractions of FTP, so the same workout fits every rider. Each workout has
 * a full version and a short (~20 min) one; free play has no blocks (the game judges 3-minute stretches instead).
 *
 * Zones (Coggan): recovery < 55 %, endurance 56–75 %, tempo 76–90 %, sweet spot 88–94 %, threshold 91–105 %,
 * VO2max 106–120 %, anaerobic 121–150 %, sprint > 150 %.
 */

export type BlockKind = "warmup" | "work" | "rest" | "cooldown" | "free";

export interface WorkoutBlock {
  label: string;
  kind: BlockKind;
  seconds: number;
  /** Target band as a fraction of FTP. For free play both are 0 (judged by steadiness instead). */
  low: number;
  high: number;
  /** Suggested cadence (rpm), shown only. */
  cadence?: [number, number];
}

export type WorkoutId =
  | "free"
  | "recovery"
  | "endurance"
  | "tempo"
  | "sweetspot"
  | "threshold"
  | "overunder"
  | "vo2max"
  | "speed";

export interface Workout {
  id: WorkoutId;
  title: string;
  /** One line: what it trains. */
  goal: string;
  /** 1 (easy) … 5 (brutal), shown as skulls. */
  difficulty: number;
  /** Empty for free play. */
  blocks: WorkoutBlock[];
}

/** Length of a judged stretch in free play (s). */
export const FREE_BLOCK_SECONDS = 180;

const m = (minutes: number) => Math.round(minutes * 60);
const blk = (
  label: string,
  kind: BlockKind,
  minutes: number,
  low: number,
  high: number,
  cadence?: [number, number],
): WorkoutBlock => ({ label, kind, seconds: m(minutes), low, high, cadence });
const repeat = (n: number, make: (i: number) => WorkoutBlock[]) => Array.from({ length: n }, (_, i) => make(i)).flat();
/** Splits a long steady block into equal judged pieces (each one is a chance to raise the multiplier). */
const split = (n: number, block: WorkoutBlock) =>
  repeat(n, (i) => [{ ...block, label: `${block.label} ${i + 1}/${n}`, seconds: Math.round(block.seconds / n) }]);
/** Drops the last rest block before the cool-down. */
const trimRest = (blocks: WorkoutBlock[]) => blocks.filter((b, i) => !(b.kind === "rest" && blocks[i + 1] === undefined));

const warm = (minutes: number) => blk("Warm-up", "warmup", minutes, 0.45, 0.65, [85, 95]);
const cool = (minutes: number) => blk("Cool-down", "cooldown", minutes, 0.35, 0.55, [80, 95]);
const rest = (minutes: number) => blk("Recover", "rest", minutes, 0.4, 0.6, [85, 95]);

type Builder = (short: boolean) => Omit<Workout, "id">;

const BUILDERS: Record<Exclude<WorkoutId, "free">, Builder> = {
  recovery: (short) => ({
    title: "Recovery ride",
    goal: "Flush the legs. Easy spinning, no strain: discipline is the workout.",
    difficulty: 1,
    blocks: [
      blk("Spin in", "warmup", short ? 4 : 5, 0.4, 0.55, [85, 95]),
      ...split(short ? 3 : 6, blk("Easy spin", "work", short ? 12 : 30, 0.45, 0.6, [85, 100])),
      blk("Spin out", "cooldown", short ? 4 : 5, 0.35, 0.55, [80, 95]),
    ],
  }),
  endurance: (short) => ({
    title: "Endurance",
    goal: "Zone 2: build the aerobic engine. Steady, conversational, long.",
    difficulty: 2,
    blocks: [warm(short ? 4 : 10), ...split(short ? 3 : 8, blk("Zone 2", "work", short ? 12 : 40, 0.62, 0.75, [85, 95])), cool(short ? 4 : 10)],
  }),
  tempo: (short) => ({
    title: "Tempo",
    goal: "Zone 3: comfortably hard, the 'muscular endurance' sweet ride.",
    difficulty: 3,
    blocks: [
      warm(short ? 5 : 10),
      ...trimRest(repeat(short ? 2 : 3, () => [blk("Tempo", "work", short ? 5 : 12, 0.76, 0.87, [85, 95]), rest(short ? 2 : 4)])),
      cool(short ? 3 : 10),
    ],
  }),
  sweetspot: (short) => ({
    title: "Sweet Spot",
    goal: "88–94 % FTP: the most FTP gain per minute of suffering.",
    difficulty: 3,
    blocks: [
      warm(short ? 5 : 10),
      ...trimRest(repeat(short ? 2 : 3, () => [blk("Sweet spot", "work", short ? 5 : 10, 0.88, 0.94, [88, 95]), rest(short ? 2 : 5)])),
      cool(short ? 3 : 5),
    ],
  }),
  threshold: (short) => ({
    title: short ? "Threshold 2×5" : "Threshold 2×20",
    goal: "Right at FTP: raises the power you can hold for an hour.",
    difficulty: 4,
    blocks: [
      warm(short ? 5 : 15),
      ...trimRest(
        repeat(2, (i) => [
          ...split(short ? 1 : 4, blk(`Threshold ${i + 1}`, "work", short ? 5 : 20, 0.95, 1.05, [88, 98])),
          rest(short ? 2 : 5),
        ]),
      ),
      cool(short ? 3 : 10),
    ],
  }),
  overunder: (short) => ({
    title: "Over-Unders",
    goal: "Alternate just under and just over FTP: teaches the legs to clear lactate under load.",
    difficulty: 4,
    blocks: [
      warm(short ? 5 : 10),
      ...trimRest(
        repeat(short ? 1 : 3, () => [
          ...repeat(4, () => [blk("Under", "work", 2, 0.9, 0.97, [88, 95]), blk("Over", "work", 1, 1.03, 1.1, [92, 100])]),
          rest(short ? 0 : 5),
        ]).filter((b) => b.seconds > 0),
      ),
      cool(short ? 3 : 10),
    ],
  }),
  vo2max: (short) => ({
    title: short ? "VO2max 3×2" : "VO2max 5×3",
    goal: "Hard 2–3 minute efforts at 110–120 %: raise the ceiling.",
    difficulty: 5,
    blocks: [
      warm(short ? 6 : 12),
      blk("Opener", "work", short ? 1 : 2, 0.95, 1.05, [95, 105]),
      rest(short ? 1 : 3),
      ...trimRest(
        repeat(short ? 3 : 5, (i) => [
          blk(`VO2 ${i + 1}`, "work", short ? 2 : 3, 1.1, 1.2, [95, 110]),
          rest(short ? 2 : 3),
        ]),
      ),
      cool(short ? 2 : 10),
    ],
  }),
  speed: (short) => ({
    title: "Speed & Sprints",
    goal: "High-cadence spin-ups and 15 s all-out sprints: leg speed and punch.",
    difficulty: 4,
    blocks: [
      warm(short ? 4 : 10),
      ...(short
        ? []
        : repeat(3, () => [blk("Spin-up", "work", 1, 0.65, 0.8, [105, 120]), blk("Easy", "rest", 1, 0.4, 0.6, [85, 95])])),
      ...repeat(short ? 6 : 8, (i) => [
        // A sprint has no upper limit: everything you have.
        { label: `Sprint ${i + 1}`, kind: "work" as const, seconds: 15, low: 1.5, high: 2.5, cadence: [100, 130] as [number, number] },
        { ...rest(1.75), label: "Recover" },
      ]),
      cool(short ? 3 : 10),
    ],
  }),
};

export const WORKOUT_IDS: WorkoutId[] = ["free", "recovery", "endurance", "tempo", "sweetspot", "threshold", "overunder", "vo2max", "speed"];

export function isWorkoutId(v: unknown): v is WorkoutId {
  return typeof v === "string" && (WORKOUT_IDS as string[]).includes(v);
}

export function getWorkout(id: WorkoutId, short = false): Workout {
  if (id === "free") {
    return {
      id,
      title: "Free play",
      goal: "Ride however you like. Every steady 3-minute stretch above 55 % FTP raises your multiplier.",
      difficulty: 0,
      blocks: [],
    };
  }
  return { id, ...BUILDERS[id](short) };
}

export const workoutSeconds = (w: Workout) => w.blocks.reduce((s, b) => s + b.seconds, 0);

/** All selectable workouts (free play first). */
export const listWorkouts = (short: boolean) => WORKOUT_IDS.map((id) => getWorkout(id, short));
