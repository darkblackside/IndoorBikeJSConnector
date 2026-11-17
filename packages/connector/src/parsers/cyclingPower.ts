/**
 * Cycling Power Measurement (0x2A63), Bluetooth SIG Cycling Power Service spec.
 * Power is reported directly; cadence and speed must be derived from cumulative
 * crank/wheel revolution counters and their event timestamps.
 */
export interface CyclingPowerMeasurement {
  power: number;
  wheel?: { revolutions: number; eventTime: number }; // eventTime in 1/2048 s
  crank?: { revolutions: number; eventTime: number }; // eventTime in 1/1024 s
}

const Flag = {
  PedalPowerBalance: 1 << 0,
  AccumulatedTorque: 1 << 2,
  WheelRevolution: 1 << 4,
  CrankRevolution: 1 << 5,
} as const;

export function parseCyclingPowerMeasurement(view: DataView): CyclingPowerMeasurement {
  const flags = view.getUint16(0, true);
  const out: CyclingPowerMeasurement = { power: view.getInt16(2, true) };
  let o = 4;
  if (flags & Flag.PedalPowerBalance) o += 1;
  if (flags & Flag.AccumulatedTorque) o += 2;
  if (flags & Flag.WheelRevolution) {
    out.wheel = { revolutions: view.getUint32(o, true), eventTime: view.getUint16(o + 4, true) };
    o += 6;
  }
  if (flags & Flag.CrankRevolution) {
    out.crank = { revolutions: view.getUint16(o, true), eventTime: view.getUint16(o + 2, true) };
    o += 4;
  }
  // Remaining optional fields (force/torque extremes, angles, energy) are not needed.
  return out;
}

/**
 * Turns successive cumulative revolution counters into a rate, handling counter
 * roll-over and stopping (no new revolution for `stopAfterMs` → 0).
 */
export class RevolutionRate {
  private last?: { revolutions: number; eventTime: number };
  private lastChange = 0;
  private rate?: number;

  constructor(
    /** Counter modulus, e.g. 2**16 for uint16 crank revolutions. */
    private readonly revolutionModulus: number,
    /** Event time ticks per second (1024 for crank, 2048 for wheel). */
    private readonly ticksPerSecond: number,
    private readonly stopAfterMs = 2500,
  ) {}

  /** Returns revolutions per second, or undefined until two samples were seen. */
  update(sample: { revolutions: number; eventTime: number }, nowMs: number): number | undefined {
    const last = this.last;
    this.last = sample;
    if (!last) {
      this.lastChange = nowMs;
      return undefined;
    }
    const revs = mod(sample.revolutions - last.revolutions, this.revolutionModulus);
    const ticks = mod(sample.eventTime - last.eventTime, 0x10000);
    if (revs > 0 && ticks > 0) {
      this.rate = revs / (ticks / this.ticksPerSecond);
      this.lastChange = nowMs;
    } else if (nowMs - this.lastChange > this.stopAfterMs) {
      this.rate = 0;
    }
    return this.rate;
  }

  reset(): void {
    this.last = undefined;
    this.rate = undefined;
  }
}

const mod = (a: number, m: number) => ((a % m) + m) % m;
