/**
 * ANT+ FE-C (Fitness Equipment Control) messages as used by "FE-C over BLE"
 * (Tacx Neo/Flux/Vortex/Bushido, many Elite trainers). Every BLE packet is a
 * complete ANT message: [0xA4 sync, length, message id, channel, 8-byte page, checksum].
 * Data page layouts follow the ANT+ Fitness Equipment Device Profile.
 */
const SYNC = 0xa4;
const MSG_BROADCAST = 0x4e;
const MSG_ACKNOWLEDGED = 0x4f;
const CHANNEL = 0x05;

export const FecPage = {
  CalibrationRequestResponse: 0x01,
  CalibrationInProgress: 0x02,
  GeneralFeData: 0x10,
  SpecificTrainerData: 0x19,
  TargetPower: 0x31,
  WindResistance: 0x32,
  TrackResistance: 0x33,
  UserConfiguration: 0x37,
} as const;

/** Extract the 8-byte data page from an ANT message, or undefined if malformed. */
export function unwrapFecMessage(view: DataView): DataView | undefined {
  if (view.byteLength < 13 || view.getUint8(0) !== SYNC) return undefined;
  const length = view.getUint8(1);
  const id = view.getUint8(2);
  if (length !== 9 || (id !== MSG_BROADCAST && id !== MSG_ACKNOWLEDGED)) return undefined;
  let checksum = 0;
  for (let i = 0; i < 12; i++) checksum ^= view.getUint8(i);
  if (checksum !== view.getUint8(12)) return undefined;
  return new DataView(view.buffer, view.byteOffset + 4, 8);
}

/** Wrap an 8-byte data page into an acknowledged ANT message for writing. */
export function wrapFecPage(page: Uint8Array): Uint8Array<ArrayBuffer> {
  if (page.length !== 8) throw new Error("FE-C data pages are 8 bytes");
  const msg = new Uint8Array(13);
  msg.set([SYNC, 0x09, MSG_ACKNOWLEDGED, CHANNEL]);
  msg.set(page, 4);
  let checksum = 0;
  for (let i = 0; i < 12; i++) checksum ^= msg[i]!;
  msg[12] = checksum;
  return msg;
}

export interface FecGeneralData {
  page: typeof FecPage.GeneralFeData;
  elapsedTime: number; // 0.25 s units, rolls over at 64 s
  distance?: number; // m, rolls over at 256 m
  speed?: number; // km/h
  heartRate?: number;
}

export interface FecTrainerData {
  page: typeof FecPage.SpecificTrainerData;
  cadence?: number;
  power?: number;
}

/** Page 1 from the trainer: result of a calibration. */
export interface FecCalibrationResponse {
  page: typeof FecPage.CalibrationRequestResponse;
  spinDownSuccess: boolean;
  zeroOffsetSuccess: boolean;
  /** °C, undefined if not reported */
  temperature?: number;
  /** ms */
  spinDownTime?: number;
}

/** Page 2: calibration running; tells the rider what to do. */
export interface FecCalibrationProgress {
  page: typeof FecPage.CalibrationInProgress;
  spinDownPending: boolean;
  /** "too-low": ride faster; "ok": target speed reached, stop pedalling. */
  speedCondition: "n/a" | "too-low" | "ok";
  temperatureCondition: "n/a" | "too-low" | "ok" | "too-high";
  /** km/h, undefined if not reported */
  targetSpeed?: number;
}

/** Page 1 to the trainer: request a spin-down calibration. */
export function encodeFecSpinDownRequest(): Uint8Array<ArrayBuffer> {
  return wrapFecPage(Uint8Array.of(FecPage.CalibrationRequestResponse, 0x40, 0, 0, 0, 0, 0, 0));
}

export function parseFecPage(
  page: DataView,
): FecGeneralData | FecTrainerData | FecCalibrationResponse | FecCalibrationProgress | undefined {
  switch (page.getUint8(0)) {
    case FecPage.CalibrationRequestResponse: {
      const temp = page.getUint8(2);
      const time = page.getUint16(5, true);
      return {
        page: FecPage.CalibrationRequestResponse,
        spinDownSuccess: (page.getUint8(1) & 0x40) !== 0,
        zeroOffsetSuccess: (page.getUint8(1) & 0x80) !== 0,
        temperature: temp === 0xff ? undefined : temp * 0.5 - 25,
        spinDownTime: time === 0xffff ? undefined : time,
      };
    }
    case FecPage.CalibrationInProgress: {
      const conditions = page.getUint8(2);
      const speed = page.getUint16(4, true);
      return {
        page: FecPage.CalibrationInProgress,
        spinDownPending: (page.getUint8(1) & 0x40) !== 0,
        speedCondition: (["n/a", "too-low", "ok", "n/a"] as const)[(conditions >> 6) & 0x03]!,
        temperatureCondition: (["n/a", "too-low", "ok", "too-high"] as const)[(conditions >> 4) & 0x03]!,
        targetSpeed: speed === 0xffff ? undefined : (speed / 1000) * 3.6,
      };
    }
    case FecPage.GeneralFeData: {
      const speedRaw = page.getUint16(4, true);
      const hr = page.getUint8(6);
      const distanceEnabled = (page.getUint8(7) & 0x04) !== 0;
      return {
        page: FecPage.GeneralFeData,
        elapsedTime: page.getUint8(2),
        distance: distanceEnabled ? page.getUint8(3) : undefined,
        speed: speedRaw === 0xffff ? undefined : (speedRaw / 1000) * 3.6,
        heartRate: hr === 0xff || hr === 0 ? undefined : hr,
      };
    }
    case FecPage.SpecificTrainerData: {
      const cadence = page.getUint8(2);
      const power = page.getUint8(5) | ((page.getUint8(6) & 0x0f) << 8);
      return {
        page: FecPage.SpecificTrainerData,
        cadence: cadence === 0xff ? undefined : cadence,
        power: power === 0xfff ? undefined : power,
      };
    }
    default:
      return undefined;
  }
}

/** Page 49: target power, 0.25 W resolution. */
export function encodeFecTargetPower(watts: number): Uint8Array<ArrayBuffer> {
  const raw = Math.min(0xffff, Math.max(0, Math.round(watts * 4)));
  return wrapFecPage(Uint8Array.of(FecPage.TargetPower, 0xff, 0xff, 0xff, 0xff, 0xff, raw & 0xff, raw >> 8));
}

/** Page 51: grade (0.01 % with +200 % offset) and Crr (5e-5 units). */
export function encodeFecTrackResistance(gradePercent: number, crr: number): Uint8Array<ArrayBuffer> {
  const grade = Math.min(0xffff, Math.max(0, Math.round((gradePercent + 200) * 100)));
  const crrRaw = Math.min(0xfe, Math.max(0, Math.round(crr / 0.00005)));
  return wrapFecPage(Uint8Array.of(FecPage.TrackResistance, 0xff, 0xff, 0xff, 0xff, grade & 0xff, grade >> 8, crrRaw));
}

/** Page 50: wind resistance coefficient (0.01 kg/m), wind speed (km/h, offset 127), drafting factor (0.01). */
export function encodeFecWindResistance(cw: number, windSpeedMps: number, drafting = 1): Uint8Array<ArrayBuffer> {
  const cwRaw = Math.min(0xfe, Math.max(0, Math.round(cw * 100)));
  const wind = Math.min(254, Math.max(0, Math.round(windSpeedMps * 3.6) + 127));
  const draft = Math.min(100, Math.max(0, Math.round(drafting * 100)));
  return wrapFecPage(Uint8Array.of(FecPage.WindResistance, 0xff, 0xff, 0xff, 0xff, cwRaw, wind, draft));
}

/** Page 55: user weight (0.01 kg), bike weight (0.05 kg, 12 bit), wheel diameter (0.01 m). */
export function encodeFecUserConfiguration(
  riderKg: number,
  bikeKg: number,
  wheelCircumferenceM: number,
): Uint8Array<ArrayBuffer> {
  const user = Math.min(0xfffe, Math.max(0, Math.round(riderKg * 100)));
  const bike = Math.min(0xffe, Math.max(0, Math.round(bikeKg / 0.05)));
  const diameter = Math.min(0xfe, Math.max(0, Math.round((wheelCircumferenceM / Math.PI) * 100)));
  return wrapFecPage(
    Uint8Array.of(
      FecPage.UserConfiguration,
      user & 0xff,
      user >> 8,
      0xff,
      ((bike & 0x0f) << 4) | 0x0, // low nibble: wheel diameter offset (0 mm)
      bike >> 4,
      diameter,
      0x00, // gear ratio: invalid/unused
    ),
  );
}
