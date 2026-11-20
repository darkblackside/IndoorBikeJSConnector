/**
 * Feed the Horde: how pedalling turns into sweat.
 *
 * Sweat is measured relative to the rider's FTP, like TSS: the rate grows with the square of the intensity
 * (power / FTP), so an hour at FTP is the same {@link SWEAT_PER_HOUR_AT_FTP} drops for a 150 W rider and a 350 W
 * rider. Everyone contributes fairly to the shared horde, and hard work counts more than long easy spinning.
 */

/** Drops of sweat for one hour at exactly FTP, before multipliers. */
export const SWEAT_PER_HOUR_AT_FTP = 10_000;

/** Intensity is capped here (sprints are allowed, but a wrong FTP or a glitch can't explode the score). */
export const MAX_INTENSITY = 2.5;

/** Plausible FTP range (W). The server rejects others. */
export const FTP_MIN = 50;
export const FTP_MAX = 600;

/** Highest power the server accepts from any rider (W). */
export const MAX_POWER = 2000;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Power as a fraction of FTP (0 … {@link MAX_INTENSITY}). */
export function intensityOf(power: number, ftp: number): number {
  if (!(ftp > 0) || !(power > 0)) return 0;
  return clamp(power / ftp, 0, MAX_INTENSITY);
}

/** Sweat drops per second at this intensity, before multipliers. */
export function sweatPerSecond(intensity: number): number {
  const i = clamp(intensity, 0, MAX_INTENSITY);
  return (i * i * SWEAT_PER_HOUR_AT_FTP) / 3600;
}

/**
 * Personal multiplier ladder. Every block ridden on target climbs one step, a missed block drops one step
 * (the streak resets).
 */
export const MULTIPLIER_STEPS = [1, 1.25, 1.5, 2, 2.5, 3] as const;

/** Group frenzy: the horde goes into a feeding frenzy while enough riders are on target at the same time. */
export const FRENZY = {
  /** Riders on target at once to trigger it. */
  minRiders: 3,
  /** They have to hold it this long (s) before it starts. */
  holdSeconds: 5,
  /** It keeps going this long (s) after the condition last held. */
  seconds: 20,
  /** Extra multiplier for everyone riding while it lasts. */
  multiplier: 1.5,
} as const;

/**
 * Soft plausibility check (co-op, so no hard anti-cheat): a rider whose 5-minute average intensity stays above
 * this can't have entered their real FTP. Their intensity counts at most {@link GOVERNOR_CAP} until it drops.
 */
export const GOVERNOR_LIMIT = 1.35;
export const GOVERNOR_CAP = 1.0;
export const GOVERNOR_WINDOW = 300;
