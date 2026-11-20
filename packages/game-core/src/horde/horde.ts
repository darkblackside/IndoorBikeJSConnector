/**
 * The horde itself: it grows with the sweat everyone has fed it, level by level. Shared by the server (level-up
 * events) and the client (what to draw).
 */

const NAMES = [
  "Stirring Graveyard",
  "Shambling Pack",
  "Moaning Mob",
  "Hungry Horde",
  "Rotting Legion",
  "Undead Host",
  "Necropolis",
  "Plague Tide",
  "Endless Dead",
];

/** Sweat for level 2 (one rider: about 30 minutes at FTP). */
export const LEVEL_STEP = 5000;

/** Total sweat needed to reach `level` (level 1 needs 0). Quadratic: early levels come fast, later ones take days. */
export function levelThreshold(level: number): number {
  const n = Math.max(0, level - 1);
  return LEVEL_STEP * n * n;
}

export function levelForTotal(total: number): number {
  return Math.floor(Math.sqrt(Math.max(0, total) / LEVEL_STEP)) + 1;
}

export function levelName(level: number): string {
  const i = Math.max(0, level - 1);
  return i < NAMES.length ? NAMES[i]! : `${NAMES.at(-1)} ${i - NAMES.length + 2}`;
}

export interface HordeLevel {
  level: number;
  name: string;
  /** Sweat at the start of this level and needed for the next. */
  floor: number;
  next: number;
  /** 0 … 1 towards the next level. */
  progress: number;
}

export function hordeLevel(total: number): HordeLevel {
  const level = levelForTotal(total);
  const floor = levelThreshold(level);
  const next = levelThreshold(level + 1);
  return { level, name: levelName(level), floor, next, progress: (total - floor) / (next - floor) };
}

/** What the horde looks like at a level: how many of each creature (the renderers cap the total). */
export interface HordeRoster {
  walkers: number;
  /** Big ones, from level 3. */
  brutes: number;
  /** Floating spirits, from level 6. */
  wraiths: number;
  /** One giant in the middle, from level 9. */
  giant: boolean;
}

export function hordeRoster(level: number): HordeRoster {
  return {
    walkers: Math.min(260, 30 + level * 22),
    brutes: level >= 3 ? Math.min(30, (level - 2) * 3) : 0,
    wraiths: level >= 6 ? Math.min(24, (level - 5) * 4) : 0,
    giant: level >= 9,
  };
}
