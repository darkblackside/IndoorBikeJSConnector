/**
 * Encoders/decoders for the FTMS "Fitness Machine Control Point" (0x2AD9), spec §4.16.
 * The client writes a request; the machine answers with an indication
 * [0x80, requestOpCode, resultCode, ...].
 */
export const enum OpCode {
  RequestControl = 0x00,
  Reset = 0x01,
  SetTargetResistanceLevel = 0x04,
  SetTargetPower = 0x05,
  StartOrResume = 0x07,
  StopOrPause = 0x08,
  SetIndoorBikeSimulation = 0x11,
  ResponseCode = 0x80,
}

export const enum ResultCode {
  Success = 0x01,
  OpCodeNotSupported = 0x02,
  InvalidParameter = 0x03,
  OperationFailed = 0x04,
  ControlNotPermitted = 0x05,
}

const resultNames: Record<number, string> = {
  [ResultCode.Success]: "success",
  [ResultCode.OpCodeNotSupported]: "op code not supported",
  [ResultCode.InvalidParameter]: "invalid parameter",
  [ResultCode.OperationFailed]: "operation failed",
  [ResultCode.ControlNotPermitted]: "control not permitted",
};

export function resultName(code: number): string {
  return resultNames[code] ?? `unknown result 0x${code.toString(16)}`;
}

export function requestControl(): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(OpCode.RequestControl);
}

export function reset(): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(OpCode.Reset);
}

export function startOrResume(): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(OpCode.StartOrResume);
}

/** ERG mode: ask the trainer to hold `watts` regardless of cadence. */
export function setTargetPower(watts: number): Uint8Array<ArrayBuffer> {
  const buf = new DataView(new ArrayBuffer(3));
  buf.setUint8(0, OpCode.SetTargetPower);
  buf.setInt16(1, Math.round(watts), true);
  return new Uint8Array(buf.buffer);
}

/**
 * SIM mode: grade-based resistance.
 * @param gradePercent road grade in percent (e.g. 4.5)
 * @param windSpeed m/s, @param crr rolling resistance, @param cw wind resistance kg/m
 */
export function setIndoorBikeSimulation(
  gradePercent: number,
  windSpeed = 0,
  crr = 0.004,
  cw = 0.51,
): Uint8Array<ArrayBuffer> {
  const buf = new DataView(new ArrayBuffer(7));
  buf.setUint8(0, OpCode.SetIndoorBikeSimulation);
  buf.setInt16(1, Math.round(windSpeed * 1000), true);
  buf.setInt16(3, Math.round(gradePercent * 100), true);
  buf.setUint8(5, Math.round(crr * 10000));
  buf.setUint8(6, Math.round(cw * 100));
  return new Uint8Array(buf.buffer);
}

export interface ControlPointResponse {
  requestOpCode: number;
  resultCode: number;
}

export function parseResponse(view: DataView): ControlPointResponse | undefined {
  if (view.byteLength < 3 || view.getUint8(0) !== OpCode.ResponseCode) return undefined;
  return { requestOpCode: view.getUint8(1), resultCode: view.getUint8(2) };
}

export interface PowerRange {
  min: number;
  max: number;
  increment: number;
}

/** Supported Power Range characteristic (0x2AD8). */
export function parsePowerRange(view: DataView): PowerRange {
  return {
    min: view.getInt16(0, true),
    max: view.getInt16(2, true),
    increment: view.getUint16(4, true),
  };
}
