/**
 * Parser for the FTMS "Indoor Bike Data" characteristic (0x2AD2).
 * Field layout follows the Bluetooth SIG Fitness Machine Service spec v1.0, §4.9.
 * Every field after the 16-bit flags is optional and present only if its flag is set,
 * so offsets must be computed from the flags rather than hard-coded.
 */
export interface IndoorBikeData {
  /** km/h */
  instantaneousSpeed?: number;
  /** km/h */
  averageSpeed?: number;
  /** rpm */
  instantaneousCadence?: number;
  /** rpm */
  averageCadence?: number;
  /** metres */
  totalDistance?: number;
  /** unitless, as reported by the machine */
  resistanceLevel?: number;
  /** watts */
  instantaneousPower?: number;
  /** watts */
  averagePower?: number;
  /** kcal */
  totalEnergy?: number;
  /** kcal/h */
  energyPerHour?: number;
  /** kcal/min */
  energyPerMinute?: number;
  /** bpm */
  heartRate?: number;
  metabolicEquivalent?: number;
  /** seconds */
  elapsedTime?: number;
  /** seconds */
  remainingTime?: number;
}

const enum Flag {
  MoreData = 1 << 0, // inverted: 0 means Instantaneous Speed IS present
  AverageSpeed = 1 << 1,
  InstantaneousCadence = 1 << 2,
  AverageCadence = 1 << 3,
  TotalDistance = 1 << 4,
  ResistanceLevel = 1 << 5,
  InstantaneousPower = 1 << 6,
  AveragePower = 1 << 7,
  ExpendedEnergy = 1 << 8,
  HeartRate = 1 << 9,
  MetabolicEquivalent = 1 << 10,
  ElapsedTime = 1 << 11,
  RemainingTime = 1 << 12,
}

/** Not-available sentinels defined by the spec for the energy fields. */
const UINT16_NA = 0xffff;
const UINT8_NA = 0xff;

export function parseIndoorBikeData(view: DataView): IndoorBikeData {
  const flags = view.getUint16(0, true);
  let o = 2;
  const out: IndoorBikeData = {};

  if (!(flags & Flag.MoreData)) {
    out.instantaneousSpeed = view.getUint16(o, true) / 100;
    o += 2;
  }
  if (flags & Flag.AverageSpeed) {
    out.averageSpeed = view.getUint16(o, true) / 100;
    o += 2;
  }
  if (flags & Flag.InstantaneousCadence) {
    out.instantaneousCadence = view.getUint16(o, true) / 2;
    o += 2;
  }
  if (flags & Flag.AverageCadence) {
    out.averageCadence = view.getUint16(o, true) / 2;
    o += 2;
  }
  if (flags & Flag.TotalDistance) {
    out.totalDistance = view.getUint16(o, true) | (view.getUint8(o + 2) << 16);
    o += 3;
  }
  if (flags & Flag.ResistanceLevel) {
    out.resistanceLevel = view.getInt16(o, true);
    o += 2;
  }
  if (flags & Flag.InstantaneousPower) {
    out.instantaneousPower = view.getInt16(o, true);
    o += 2;
  }
  if (flags & Flag.AveragePower) {
    out.averagePower = view.getInt16(o, true);
    o += 2;
  }
  if (flags & Flag.ExpendedEnergy) {
    const total = view.getUint16(o, true);
    const perHour = view.getUint16(o + 2, true);
    const perMinute = view.getUint8(o + 4);
    if (total !== UINT16_NA) out.totalEnergy = total;
    if (perHour !== UINT16_NA) out.energyPerHour = perHour;
    if (perMinute !== UINT8_NA) out.energyPerMinute = perMinute;
    o += 5;
  }
  if (flags & Flag.HeartRate) {
    out.heartRate = view.getUint8(o);
    o += 1;
  }
  if (flags & Flag.MetabolicEquivalent) {
    out.metabolicEquivalent = view.getUint8(o) / 10;
    o += 1;
  }
  if (flags & Flag.ElapsedTime) {
    out.elapsedTime = view.getUint16(o, true);
    o += 2;
  }
  if (flags & Flag.RemainingTime) {
    out.remainingTime = view.getUint16(o, true);
    o += 2;
  }
  return out;
}
