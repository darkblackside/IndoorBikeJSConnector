/**
 * The 20-minute FTP test, as a plan of coached blocks.
 *
 * Protocol: 20 min warm-up in ERG (easy spinning, a moderate block, cadence spin-ups, a ~2 min opener that lifts
 * the heart rate briefly towards ~90 % of max, then recovery), 20 min all-out at maximal but EVEN power (no ERG:
 * the rider sets the power with gears and cadence), 10 min cool-down in ERG. FTP = average power of the 20 min × 0.95.
 *
 * Every block says what to ride (ERG wattage, cadence), how it should feel (RPE / talk test) and a soft heart-rate
 * guide as a share of max HR. The feeling always matters more than the heart rate.
 */

export type Ftp20Phase = "warmup" | "test" | "cooldown";

export interface Ftp20Config {
  /** Easy warm-up / cool-down wattage (ERG). */
  easyWatts: number;
  /** Hard wattage for the opener (ERG). */
  hardWatts: number;
  /** FTP = 20-min average power × this. */
  ftpFactor: number;
}

export const defaultFtp20Config: Ftp20Config = { easyWatts: 120, hardWatts: 250, ftpFactor: 0.95 };

/** Fixed phase lengths in seconds. The 20-min test is the test; warm-up and cool-down can only be skipped. */
export const PHASE_SECONDS: Readonly<Record<Ftp20Phase, number>> = { warmup: 20 * 60, test: 20 * 60, cooldown: 10 * 60 };

/**
 * Seconds at the end of the warm-up in which the trainer lets go (no ERG) so the rider can shift into the test gear,
 * with a countdown to the start. Skipping the warm-up jumps here.
 */
export const COUNTDOWN_SECONDS = 10;

/** A short message at a point in a block (e.g. "Spin-up: 110+ rpm"). */
export interface Cue {
  /** Seconds into the block. */
  at: number;
  text: string;
}

export interface Block {
  phase: Ftp20Phase;
  /** Seconds into the phase. */
  start: number;
  end: number;
  title: string;
  /** ERG target in watts; undefined during the test (the rider sets the power). */
  watts?: number;
  /** Cadence to ride, rpm. */
  cadence: readonly [number, number];
  /** How it should feel (talk test). */
  feel: string;
  /** Rate of perceived exertion, 1–10. */
  rpe: string;
  /** Soft heart-rate guide as a share of max HR. */
  hr: readonly [number, number];
  /** Pacing / technique advice for the block. */
  tip: string;
  cues: readonly Cue[];
}

const round5 = (w: number) => Math.round(w / 5) * 5;

/** The wattages used by the plan, sanitised: the opener is always harder than the easy level. */
export function planWatts(cfg: Ftp20Config): { easy: number; moderate: number; hard: number; cooldownEnd: number } {
  const easy = Math.max(30, Math.round(cfg.easyWatts));
  const hard = Math.max(easy + 10, Math.round(cfg.hardWatts));
  return { easy, moderate: round5((easy + hard) / 2), hard, cooldownEnd: Math.max(30, round5(easy * 0.85)) };
}

const min = (m: number) => m * 60;

/** All blocks of the session, in order. */
export function planBlocks(cfg: Ftp20Config): Block[] {
  const w = planWatts(cfg);
  return [
    // --- warm-up (ERG) ---
    {
      phase: "warmup",
      start: 0,
      end: min(5),
      title: "Easy spin",
      watts: w.easy,
      cadence: [85, 95],
      feel: "Very easy – you could chat in full sentences",
      rpe: "RPE 2–3",
      hr: [0.6, 0.7],
      tip: "Loosen up. The trainer holds the power, you just spin smoothly.",
      cues: [],
    },
    {
      phase: "warmup",
      start: min(5),
      end: min(10),
      title: "Build",
      watts: w.moderate,
      cadence: [88, 92],
      feel: "Comfortable – breathing a bit deeper, still talking in sentences",
      rpe: "RPE 4",
      hr: [0.7, 0.75],
      tip: "Settle on the saddle, relax your shoulders and your grip.",
      cues: [],
    },
    {
      phase: "warmup",
      start: min(10),
      end: min(13),
      title: "Spin-ups",
      watts: w.moderate,
      cadence: [90, 110],
      feel: "Light, quick legs – faster, not harder",
      rpe: "RPE 4–5",
      hr: [0.7, 0.8],
      tip: "Three 20-second spin-ups to 110+ rpm, easy spinning at 90 rpm in between.",
      cues: [
        { at: 0, text: "Spin-up 1: quick legs, 110+ rpm" },
        { at: 20, text: "Back to 90 rpm" },
        { at: 60, text: "Spin-up 2: 110+ rpm" },
        { at: 80, text: "Back to 90 rpm" },
        { at: 120, text: "Spin-up 3: 110+ rpm" },
        { at: 140, text: "Back to 90 rpm" },
      ],
    },
    {
      phase: "warmup",
      start: min(13),
      end: min(15),
      title: "Opener",
      watts: w.hard,
      cadence: [95, 100],
      feel: "Hard – only a few words at a time. Heart rate briefly towards ~90 % of max",
      rpe: "RPE 8",
      hr: [0.85, 0.9],
      tip: "Two minutes to wake the legs up: hard, but not all-out.",
      cues: [
        { at: 0, text: "Opener: 2 minutes hard" },
        { at: 90, text: "30 s left in the opener" },
      ],
    },
    {
      phase: "warmup",
      start: min(15),
      end: min(20),
      title: "Recover",
      watts: w.easy,
      cadence: [85, 95],
      feel: "Recover fully – breathing calms down, you could chat again",
      rpe: "RPE 2",
      hr: [0.55, 0.7],
      tip: "Drink, breathe, get your head ready. In the last 10 s the trainer lets go: shift into your test gear.",
      cues: [{ at: min(5) - COUNTDOWN_SECONDS, text: "Shift into your test gear – the trainer lets go" }],
    },
    // --- the test (no ERG): 5-minute blocks ---
    {
      phase: "test",
      start: 0,
      end: min(5),
      title: "Controlled start",
      cadence: [85, 95],
      feel: "Controlled – hard but sustainable. Do NOT start too hot",
      rpe: "RPE ~7",
      hr: [0.85, 0.9],
      tip: "Most riders start too hard. Hold back a little in the first minutes: you can always add later.",
      cues: [{ at: 0, text: "Go! Controlled start" }],
    },
    {
      phase: "test",
      start: min(5),
      end: min(10),
      title: "Settle in",
      cadence: [85, 95],
      feel: "Breathing heavy but rhythmic – a few words only",
      rpe: "RPE 8",
      hr: [0.88, 0.92],
      tip: "Find a steady rhythm and keep the power even: small changes, no surges.",
      cues: [{ at: 0, text: "Settle into a steady rhythm" }],
    },
    {
      phase: "test",
      start: min(10),
      end: min(15),
      title: "Hold it",
      cadence: [85, 95],
      feel: "The hardest part mentally – hold the power",
      rpe: "RPE 8–9",
      hr: [0.9, 0.95],
      tip: "Count down minute by minute. Relax your upper body, keep the cadence up.",
      cues: [{ at: 0, text: "Halfway – hold the power" }],
    },
    {
      phase: "test",
      start: min(15),
      end: min(20),
      title: "Empty the tank",
      cadence: [90, 100],
      feel: "Last minutes – from 17:00 everything you have left",
      rpe: "RPE 10",
      hr: [0.93, 1],
      tip: "Lift it gradually now; the final 2–3 minutes are all you have. Sprint the last 30 s if you can.",
      cues: [
        { at: 0, text: "5 minutes to go – start lifting it" },
        { at: min(2), text: "Last 3 minutes – empty the tank!" },
        { at: min(4), text: "Last minute – everything you have!" },
        { at: min(4) + 30, text: "30 seconds!" },
      ],
    },
    // --- cool-down (ERG) ---
    {
      phase: "cooldown",
      start: 0,
      end: min(5),
      title: "Spin easy",
      watts: w.easy,
      cadence: [85, 95],
      feel: "Spin easy – let your heart rate come down",
      rpe: "RPE 2",
      hr: [0.5, 0.65],
      tip: "Well done. Keep the legs moving, it clears them faster than stopping.",
      cues: [{ at: 0, text: "Test done! Cool-down" }],
    },
    {
      phase: "cooldown",
      start: min(5),
      end: min(10),
      title: "Wind down",
      watts: w.cooldownEnd,
      cadence: [80, 90],
      feel: "Very easy – breathing back to normal",
      rpe: "RPE 1–2",
      hr: [0.45, 0.6],
      tip: "Drink something. Your result is waiting at the end (or skip to it).",
      cues: [],
    },
  ];
}

/** Where in a phase we are. */
export interface BlockState {
  block: Block;
  /** Index into `planBlocks()`. */
  index: number;
  /** Seconds into the block. */
  elapsed: number;
  remaining: number;
  /** Seconds left in the phase. */
  phaseRemaining: number;
  /** The next block, if there is one. */
  next?: Block;
}

/** The block at `t` seconds into `phase` (clamped to the phase). */
export function blockAt(blocks: readonly Block[], phase: Ftp20Phase, t: number): BlockState {
  const len = PHASE_SECONDS[phase];
  const tt = Math.min(Math.max(0, t), len - 1e-6);
  const index = blocks.findIndex((b) => b.phase === phase && tt >= b.start && tt < b.end);
  const block = blocks[index]!;
  return {
    block,
    index,
    elapsed: tt - block.start,
    remaining: block.end - tt,
    phaseRemaining: len - tt,
    next: blocks[index + 1],
  };
}

/** ERG target at `t` seconds into `phase`; undefined in the test and in the countdown before it. */
export function ergTargetAt(blocks: readonly Block[], phase: Ftp20Phase, t: number): number | undefined {
  if (phase === "warmup" && t >= PHASE_SECONDS.warmup - COUNTDOWN_SECONDS) return undefined;
  return blockAt(blocks, phase, t).block.watts;
}

/**
 * Max heart rate: the one the rider entered, otherwise estimated from the age (Tanaka: 208 − 0.7 × age),
 * otherwise unknown (then the coaching shows only feeling and cadence).
 */
export function maxHeartRate(opts: { age?: number; maxHr?: number }): number | undefined {
  const { age, maxHr } = opts;
  if (maxHr !== undefined && Number.isFinite(maxHr) && maxHr >= 100 && maxHr <= 240) return Math.round(maxHr);
  if (age !== undefined && Number.isFinite(age) && age >= 10 && age <= 100) return Math.round(208 - 0.7 * age);
  return undefined;
}

/** The soft heart-rate guide of a block in bpm, or undefined without a max HR. */
export function heartRateGuide(block: Block, maxHr: number | undefined): { low: number; high: number } | undefined {
  if (maxHr === undefined) return undefined;
  return { low: Math.round(block.hr[0] * maxHr), high: Math.round(block.hr[1] * maxHr) };
}

/** "60–70 %" for a block's heart-rate guide. */
export const heartRatePercent = (block: Block) =>
  `${Math.round(block.hr[0] * 100)}–${Math.round(block.hr[1] * 100)} %`;
