import { describe, expect, it } from "vitest";
import { buildActivity, encodeFit, encodeTcx, fitCrc } from "../demo/zombie-ramp/activity.ts";
import { defaultRampConfig, RampRecorder, rampStateAt } from "../demo/zombie-ramp/ramp.ts";

const cfg = { ...defaultRampConfig, warmupSeconds: 120, stepSeconds: 60 };
const start = new Date("2026-11-17T18:00:00Z");

/** 2 min warm-up, 2 full steps and 30 s into the third, with HR from 1 min on. */
function ride() {
  const rec = new RampRecorder(cfg);
  for (let t = 0; t < 120 + 150; t++) {
    rec.record(t, rampStateAt(cfg, t).target, t >= 60 ? 120 + Math.floor(t / 10) : undefined, { cadence: 90, speed: 30 });
  }
  return buildActivity(rec.samples, cfg, start, 270);
}

type FitMessage = { global: number; fields: Map<number, number> };

/** Minimal FIT reader (normal headers, little endian, integer fields) to check what we write. */
function readFit(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = v.getUint8(0);
  const dataSize = v.getUint32(4, true);
  const signature = String.fromCharCode(...bytes.slice(8, 12));
  const headerCrcOk = fitCrc(bytes.slice(0, 12)) === v.getUint16(12, true);
  const fileCrcOk = fitCrc(bytes.slice(headerSize, headerSize + dataSize)) === v.getUint16(headerSize + dataSize, true);
  const defs = new Map<number, { global: number; fields: [number, number, number][] }>();
  const messages: FitMessage[] = [];
  let o = headerSize;
  while (o < headerSize + dataSize) {
    const header = v.getUint8(o++);
    const local = header & 0x0f;
    if (header & 0x40) {
      const global = v.getUint16(o + 2, true);
      const n = v.getUint8(o + 4);
      o += 5;
      const fields: [number, number, number][] = [];
      for (let i = 0; i < n; i++, o += 3) fields.push([v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2)]);
      defs.set(local, { global, fields });
    } else {
      const def = defs.get(local)!;
      const fields = new Map<number, number>();
      for (const [num, size] of def.fields) {
        let value = 0;
        for (let b = 0; b < size; b++) value += v.getUint8(o + b) * 2 ** (8 * b);
        const invalid = size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
        if (value !== invalid) fields.set(num, value);
        o += size;
      }
      messages.push({ global: def.global, fields });
    }
  }
  return { headerSize, signature, headerCrcOk, fileCrcOk, length: headerSize + dataSize + 2, messages };
}

describe("activity export", () => {
  it("summarizes the ride and splits it into one lap per warm-up/step", () => {
    const a = ride();
    expect(a.points).toHaveLength(270);
    expect(a.laps.map((l) => [l.start, l.duration])).toEqual([
      [0, 120],
      [120, 60],
      [180, 60],
      [240, 30],
    ]);
    expect(a.laps[1]!.summary.avgPower).toBe(100);
    expect(a.laps[2]!.summary.avgPower).toBe(125);
    expect(a.summary.distance).toBeCloseTo((30 / 3.6) * 269, 0);
    expect(a.summary.maxHeartRate).toBe(146);
    expect(a.summary.avgCadence).toBe(90);
    expect(a.summary.work).toBeCloseTo((120 * 100 + 60 * 100 + 60 * 125 + 30 * 150) / 1000);
  });

  it("derives speed from power when the device reports none", () => {
    const rec = new RampRecorder(cfg);
    for (let t = 0; t < 10; t++) rec.record(t, 200);
    const a = buildActivity(rec.samples, cfg, start);
    expect(a.points[5]!.speed).toBeCloseTo(7.0, 1); // ~25 km/h at 200 W
    expect(a.summary.distance).toBeGreaterThan(60);
  });

  it("writes a valid FIT activity file", () => {
    const a = ride();
    const fit = readFit(encodeFit(a));
    expect(fit.signature).toBe(".FIT");
    expect(fit.headerCrcOk).toBe(true);
    expect(fit.fileCrcOk).toBe(true);
    const of = (global: number) => fit.messages.filter((m) => m.global === global);
    const fitStart = start.getTime() / 1000 - 631065600;

    expect(of(0)[0]!.fields.get(0)).toBe(4); // file type: activity
    const records = of(20);
    expect(records).toHaveLength(270);
    expect(records[0]!.fields.get(253)).toBe(fitStart);
    expect(records[0]!.fields.has(3)).toBe(false); // no heart rate yet
    expect(records[200]!.fields.get(7)).toBe(125); // power
    expect(records[200]!.fields.get(4)).toBe(90); // cadence
    expect(records[200]!.fields.get(3)).toBe(140); // heart rate
    expect(records[200]!.fields.get(6)).toBe(8333); // 30 km/h in mm/s

    const laps = of(19);
    expect(laps).toHaveLength(4);
    expect(laps[1]!.fields.get(2)).toBe(fitStart + 120); // start_time
    expect(laps[1]!.fields.get(8)).toBe(60_000); // timer time, ms
    expect(laps[1]!.fields.get(19)).toBe(100); // avg power

    const [session] = of(18);
    expect(session!.fields.get(5)).toBe(2); // cycling
    expect(session!.fields.get(6)).toBe(6); // indoor cycling
    expect(session!.fields.get(7)).toBe(270_000);
    expect(session!.fields.get(26)).toBe(4); // laps
    expect(session!.fields.get(21)).toBe(150); // max power
    expect(of(34)).toHaveLength(1); // activity
    expect(of(21).map((e) => e.fields.get(1))).toEqual([0, 4]); // timer start, stop all
  });

  it("writes TCX with power in the activity extension", () => {
    const tcx = encodeTcx(ride(), "FTP 94 W <test>");
    expect(tcx).toContain('<Activity Sport="Biking">');
    expect(tcx).toContain("<Id>2026-11-17T18:00:00Z</Id>");
    expect(tcx.match(/<Lap /g)).toHaveLength(4);
    expect(tcx.match(/<Trackpoint>/g)).toHaveLength(270);
    expect(tcx).toContain("<Time>2026-11-17T18:03:20Z</Time>");
    expect(tcx).toContain("<ns3:Watts>125</ns3:Watts>");
    expect(tcx).toContain("<Notes>FTP 94 W &lt;test&gt;</Notes>");
  });
});
