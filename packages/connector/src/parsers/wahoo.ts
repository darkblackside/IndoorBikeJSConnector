/**
 * Wahoo proprietary trainer control ("WCPMCP"), used by KICKR / KICKR SNAP / KICKR CORE
 * firmware that predates FTMS. Commands are written to characteristic
 * A026E005-0A7D-4AB3-97FA-F1500F9FEB8B inside the Cycling Power Service; power/speed
 * data come from the standard Cycling Power Measurement characteristic.
 *
 * The protocol is not publicly documented; the encoding follows the long-standing
 * open-source implementations (GoldenCheetah, Zwack, pycycling).
 */
export const WahooOpCode = {
  Unlock: 0x20,
  SetResistanceMode: 0x40,
  SetStandardMode: 0x41,
  SetErgMode: 0x42,
  SetSimMode: 0x43,
  SetCrr: 0x44,
  SetWindResistance: 0x45,
  SetGrade: 0x46,
  SetWindSpeed: 0x47,
  SetWheelCircumference: 0x48,
} as const;

const u16Command = (op: number, value: number): Uint8Array<ArrayBuffer> => {
  const v = new DataView(new ArrayBuffer(3));
  v.setUint8(0, op);
  v.setUint16(1, clampU16(value), true);
  return new Uint8Array(v.buffer);
};

/** Must be sent once after connecting before the trainer accepts commands. */
export const encodeWahooUnlock = () => Uint8Array.of(WahooOpCode.Unlock, 0xee, 0xfc);

/** ERG: target watts, uint16. */
export const encodeWahooErg = (watts: number) => u16Command(WahooOpCode.SetErgMode, Math.round(watts));

/** Enter SIM mode: total weight (0.01 kg), Crr (0.0001), wind resistance coefficient (0.001 kg/m). */
export function encodeWahooSimMode(weightKg: number, crr: number, cw: number): Uint8Array<ArrayBuffer> {
  const v = new DataView(new ArrayBuffer(7));
  v.setUint8(0, WahooOpCode.SetSimMode);
  v.setUint16(1, clampU16(Math.round(weightKg * 100)), true);
  v.setUint16(3, clampU16(Math.round(crr * 10000)), true);
  v.setUint16(5, clampU16(Math.round(cw * 1000)), true);
  return new Uint8Array(v.buffer);
}

/** Grade in percent, mapped from [-100 %, +100 %] onto [0, 65535]. */
export function encodeWahooGrade(gradePercent: number): Uint8Array<ArrayBuffer> {
  const fraction = Math.min(1, Math.max(-1, gradePercent / 100));
  return u16Command(WahooOpCode.SetGrade, Math.round(((fraction + 1) * 65535) / 2));
}

/** Wind speed in m/s, offset by 32.768 m/s, resolution 0.001 m/s. */
export const encodeWahooWindSpeed = (mps: number) =>
  u16Command(WahooOpCode.SetWindSpeed, Math.round((mps + 32.768) * 1000));

/** Wheel circumference in metres (resolution 0.1 mm). */
export const encodeWahooWheelCircumference = (metres: number) =>
  u16Command(WahooOpCode.SetWheelCircumference, Math.round(metres * 10000));

const clampU16 = (v: number) => Math.min(0xffff, Math.max(0, v));
