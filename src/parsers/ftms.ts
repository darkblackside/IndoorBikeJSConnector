/**
 * Fitness Machine Service (FTMS) encoders/decoders, Bluetooth SIG FTMS spec v1.0.
 */

// ---------------------------------------------------------------------------
// Indoor Bike Data (0x2AD2), §4.9. Every field after the flags is optional,
// so offsets have to be computed from the flags.
// ---------------------------------------------------------------------------

export interface IndoorBikeData {
  instantaneousSpeed?: number; // km/h
  averageSpeed?: number; // km/h
  instantaneousCadence?: number; // rpm
  averageCadence?: number; // rpm
  totalDistance?: number; // m
  resistanceLevel?: number;
  instantaneousPower?: number; // W
  averagePower?: number; // W
  totalEnergy?: number; // kcal
  energyPerHour?: number; // kcal/h
  energyPerMinute?: number; // kcal/min
  heartRate?: number; // bpm
  metabolicEquivalent?: number;
  elapsedTime?: number; // s
  remainingTime?: number; // s
}

export const IndoorBikeDataFlag = {
  MoreData: 1 << 0, // inverted: 0 means Instantaneous Speed IS present
  AverageSpeed: 1 << 1,
  InstantaneousCadence: 1 << 2,
  AverageCadence: 1 << 3,
  TotalDistance: 1 << 4,
  ResistanceLevel: 1 << 5,
  InstantaneousPower: 1 << 6,
  AveragePower: 1 << 7,
  ExpendedEnergy: 1 << 8,
  HeartRate: 1 << 9,
  MetabolicEquivalent: 1 << 10,
  ElapsedTime: 1 << 11,
  RemainingTime: 1 << 12,
} as const;

export function parseIndoorBikeData(view: DataView): IndoorBikeData {
  const F = IndoorBikeDataFlag;
  const flags = view.getUint16(0, true);
  let o = 2;
  const out: IndoorBikeData = {};
  const u16 = () => ((o += 2), view.getUint16(o - 2, true));
  const s16 = () => ((o += 2), view.getInt16(o - 2, true));
  const u8 = () => view.getUint8(o++);

  if (!(flags & F.MoreData)) out.instantaneousSpeed = u16() / 100;
  if (flags & F.AverageSpeed) out.averageSpeed = u16() / 100;
  if (flags & F.InstantaneousCadence) out.instantaneousCadence = u16() / 2;
  if (flags & F.AverageCadence) out.averageCadence = u16() / 2;
  if (flags & F.TotalDistance) {
    out.totalDistance = view.getUint16(o, true) | (view.getUint8(o + 2) << 16);
    o += 3;
  }
  if (flags & F.ResistanceLevel) out.resistanceLevel = s16();
  if (flags & F.InstantaneousPower) out.instantaneousPower = s16();
  if (flags & F.AveragePower) out.averagePower = s16();
  if (flags & F.ExpendedEnergy) {
    const total = u16();
    const perHour = u16();
    const perMinute = u8();
    if (total !== 0xffff) out.totalEnergy = total;
    if (perHour !== 0xffff) out.energyPerHour = perHour;
    if (perMinute !== 0xff) out.energyPerMinute = perMinute;
  }
  if (flags & F.HeartRate) out.heartRate = u8();
  if (flags & F.MetabolicEquivalent) out.metabolicEquivalent = u8() / 10;
  if (flags & F.ElapsedTime) out.elapsedTime = u16();
  if (flags & F.RemainingTime) out.remainingTime = u16();
  return out;
}

// ---------------------------------------------------------------------------
// Fitness Machine Feature (0x2ACC), §4.3
// ---------------------------------------------------------------------------

export interface FitnessMachineFeatures {
  machineFeatures: number;
  targetSettingFeatures: number;
  powerTargetSupported: boolean;
  simulationSupported: boolean;
  spinDownSupported: boolean;
}

export function parseFitnessMachineFeature(view: DataView): FitnessMachineFeatures {
  const machineFeatures = view.getUint32(0, true);
  const targetSettingFeatures = view.getUint32(4, true);
  return {
    machineFeatures,
    targetSettingFeatures,
    powerTargetSupported: (targetSettingFeatures & (1 << 3)) !== 0,
    simulationSupported: (targetSettingFeatures & (1 << 13)) !== 0,
    spinDownSupported: (targetSettingFeatures & (1 << 15)) !== 0,
  };
}

// ---------------------------------------------------------------------------
// Supported Power Range (0x2AD8), §4.14
// ---------------------------------------------------------------------------

export interface PowerRange {
  min: number;
  max: number;
  increment: number;
}

export function parsePowerRange(view: DataView): PowerRange {
  return { min: view.getInt16(0, true), max: view.getInt16(2, true), increment: view.getUint16(4, true) };
}

// ---------------------------------------------------------------------------
// Fitness Machine Control Point (0x2AD9), §4.16
// Client writes a request; machine indicates [0x80, requestOpCode, resultCode].
// ---------------------------------------------------------------------------

export const FtmsOpCode = {
  RequestControl: 0x00,
  Reset: 0x01,
  SetTargetResistanceLevel: 0x04,
  SetTargetPower: 0x05,
  StartOrResume: 0x07,
  StopOrPause: 0x08,
  SetIndoorBikeSimulation: 0x11,
  SpinDownControl: 0x13,
  ResponseCode: 0x80,
} as const;

export const FtmsResult = {
  Success: 0x01,
  OpCodeNotSupported: 0x02,
  InvalidParameter: 0x03,
  OperationFailed: 0x04,
  ControlNotPermitted: 0x05,
} as const;

const resultNames: Record<number, string> = {
  [FtmsResult.Success]: "success",
  [FtmsResult.OpCodeNotSupported]: "op code not supported",
  [FtmsResult.InvalidParameter]: "invalid parameter",
  [FtmsResult.OperationFailed]: "operation failed",
  [FtmsResult.ControlNotPermitted]: "control not permitted",
};

export const ftmsResultName = (code: number): string =>
  resultNames[code] ?? `unknown result 0x${code.toString(16)}`;

export const encodeRequestControl = () => Uint8Array.of(FtmsOpCode.RequestControl);
export const encodeReset = () => Uint8Array.of(FtmsOpCode.Reset);
export const encodeStartOrResume = () => Uint8Array.of(FtmsOpCode.StartOrResume);
/** Spin Down Control: start (0x01) or ignore/cancel (0x02) a spin-down calibration. */
export const encodeSpinDownControl = (start: boolean) => Uint8Array.of(FtmsOpCode.SpinDownControl, start ? 0x01 : 0x02);

/** Spin-down target speed window from a successful Spin Down Control response (km/h). */
export function parseSpinDownTargetSpeed(parameter: DataView): { low: number; high: number } | undefined {
  if (parameter.byteLength < 4) return undefined;
  return { low: parameter.getUint16(0, true) / 100, high: parameter.getUint16(2, true) / 100 };
}

/** ERG: sint16 watts, resolution 1 W. */
export function encodeSetTargetPower(watts: number): Uint8Array<ArrayBuffer> {
  const v = new DataView(new ArrayBuffer(3));
  v.setUint8(0, FtmsOpCode.SetTargetPower);
  v.setInt16(1, Math.round(watts), true);
  return new Uint8Array(v.buffer);
}

/**
 * SIM: wind speed sint16 (0.001 m/s), grade sint16 (0.01 %), Crr uint8 (0.0001), Cw uint8 (0.01 kg/m).
 */
export function encodeSetIndoorBikeSimulation(p: {
  grade: number;
  windSpeed: number;
  crr: number;
  cw: number;
}): Uint8Array<ArrayBuffer> {
  const v = new DataView(new ArrayBuffer(7));
  v.setUint8(0, FtmsOpCode.SetIndoorBikeSimulation);
  v.setInt16(1, clamp(Math.round(p.windSpeed * 1000), -32768, 32767), true);
  v.setInt16(3, clamp(Math.round(p.grade * 100), -32768, 32767), true);
  v.setUint8(5, clamp(Math.round(p.crr * 10000), 0, 255));
  v.setUint8(6, clamp(Math.round(p.cw * 100), 0, 255));
  return new Uint8Array(v.buffer);
}

export interface FtmsResponse {
  requestOpCode: number;
  resultCode: number;
  /** Response parameter bytes after the result code (e.g. spin-down target speeds). */
  parameter: DataView;
}

export function parseFtmsResponse(view: DataView): FtmsResponse | undefined {
  if (view.byteLength < 3 || view.getUint8(0) !== FtmsOpCode.ResponseCode) return undefined;
  return {
    requestOpCode: view.getUint8(1),
    resultCode: view.getUint8(2),
    parameter: new DataView(view.buffer, view.byteOffset + 3, view.byteLength - 3),
  };
}

// ---------------------------------------------------------------------------
// Fitness Machine Status (0x2ADA), §4.17
// The machine notifies every client when its state changes, including changes made
// by another client (e.g. a watch connected to the same trainer).
// ---------------------------------------------------------------------------

export const FtmsStatusOpCode = {
  Reset: 0x01,
  StoppedOrPausedByUser: 0x02,
  StoppedBySafetyKey: 0x03,
  StartedOrResumedByUser: 0x04,
  TargetPowerChanged: 0x08,
  IndoorBikeSimulationChanged: 0x12,
  SpinDownStatus: 0x14,
  ControlPermissionLost: 0xff,
} as const;

/** Values of the Spin Down Status notification. */
export const SpinDownStatus = { Requested: 0x01, Success: 0x02, Error: 0x03, StopPedaling: 0x04 } as const;

export type FtmsStatus =
  | { kind: "reset" }
  | { kind: "stopped" }
  | { kind: "started" }
  | { kind: "target-power"; watts: number }
  | { kind: "simulation"; grade: number; windSpeed: number }
  | { kind: "control-lost" }
  | { kind: "spin-down"; status: number }
  | { kind: "other"; opCode: number };

export function parseFitnessMachineStatus(view: DataView): FtmsStatus | undefined {
  if (view.byteLength < 1) return undefined;
  const op = view.getUint8(0);
  const S = FtmsStatusOpCode;
  switch (op) {
    case S.Reset:
      return { kind: "reset" };
    case S.StoppedOrPausedByUser:
    case S.StoppedBySafetyKey:
      return { kind: "stopped" };
    case S.StartedOrResumedByUser:
      return { kind: "started" };
    case S.TargetPowerChanged:
      return view.byteLength >= 3 ? { kind: "target-power", watts: view.getInt16(1, true) } : { kind: "other", opCode: op };
    case S.IndoorBikeSimulationChanged:
      return view.byteLength >= 5
        ? { kind: "simulation", windSpeed: view.getInt16(1, true) / 1000, grade: view.getInt16(3, true) / 100 }
        : { kind: "other", opCode: op };
    case S.SpinDownStatus:
      return view.byteLength >= 2 ? { kind: "spin-down", status: view.getUint8(1) } : { kind: "other", opCode: op };
    case S.ControlPermissionLost:
      return { kind: "control-lost" };
    default:
      return { kind: "other", opCode: op };
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
