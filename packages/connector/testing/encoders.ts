/** Device-side encoders: build the packets a real trainer would send. */
import { fec, ftms } from "../src/index.ts";

export function encodeIndoorBikeData(d: {
  speed?: number;
  cadence?: number;
  power?: number;
  distance?: number;
  heartRate?: number;
}): Uint8Array {
  const F = ftms.IndoorBikeDataFlag;
  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 0xff, (v >> 8) & 0xff);
  let flags = 0;
  if (d.speed === undefined) flags |= F.MoreData;
  else u16(Math.round(d.speed * 100));
  if (d.cadence !== undefined) (flags |= F.InstantaneousCadence), u16(Math.round(d.cadence * 2));
  if (d.distance !== undefined) {
    flags |= F.TotalDistance;
    const m = Math.round(d.distance);
    bytes.push(m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff);
  }
  if (d.power !== undefined) (flags |= F.InstantaneousPower), u16(Math.round(d.power) & 0xffff);
  if (d.heartRate !== undefined) (flags |= F.HeartRate), bytes.push(d.heartRate);
  return Uint8Array.of(flags & 0xff, flags >> 8, ...bytes);
}

export function encodeCyclingPowerMeasurement(m: {
  power: number;
  wheel?: { revolutions: number; eventTime: number };
  crank?: { revolutions: number; eventTime: number };
}): Uint8Array {
  const v = new DataView(new ArrayBuffer(14));
  let flags = 0;
  let o = 4;
  v.setInt16(2, Math.round(m.power), true);
  if (m.wheel) {
    flags |= 1 << 4;
    v.setUint32(o, m.wheel.revolutions >>> 0, true);
    v.setUint16(o + 4, m.wheel.eventTime & 0xffff, true);
    o += 6;
  }
  if (m.crank) {
    flags |= 1 << 5;
    v.setUint16(o, m.crank.revolutions & 0xffff, true);
    v.setUint16(o + 2, m.crank.eventTime & 0xffff, true);
    o += 4;
  }
  v.setUint16(0, flags, true);
  return new Uint8Array(v.buffer, 0, o);
}

/** Broadcast ANT message (0x4E) as a Tacx trainer sends it. */
export function fecBroadcast(page: number[]): Uint8Array {
  const msg = fec.wrapFecPage(Uint8Array.from(page));
  msg[2] = 0x4e;
  msg[12] = msg.slice(0, 12).reduce((a, b) => a ^ b, 0);
  return msg;
}

export function encodeFecGeneral(d: { speed: number; distance: number; heartRate?: number; elapsed: number }) {
  const speed = Math.round((d.speed / 3.6) * 1000);
  return fecBroadcast([
    0x10, 25, Math.round(d.elapsed * 4) & 0xff, Math.round(d.distance) & 0xff,
    speed & 0xff, speed >> 8, d.heartRate ?? 0xff, 0x04 /* distance enabled */,
  ]);
}

export function encodeFecTrainer(d: { cadence: number; power: number; events: number }) {
  const p = Math.round(d.power) & 0xfff;
  return fecBroadcast([0x19, d.events & 0xff, Math.round(d.cadence), 0, 0, p & 0xff, p >> 8, 0]);
}

export const encodeHeartRate = (bpm: number) => (bpm > 255 ? Uint8Array.of(1, bpm & 0xff, bpm >> 8) : Uint8Array.of(0, bpm));
