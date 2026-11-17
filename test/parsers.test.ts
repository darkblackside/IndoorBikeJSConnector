import { describe, expect, it } from "vitest";
import { cyclingPower, fec, ftms, parseHeartRate, wahoo } from "../src/index.ts";

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("FTMS indoor bike data", () => {
  it("parses a typical KICKR CORE packet (speed, cadence, power)", () => {
    const d = ftms.parseIndoorBikeData(view(0x44, 0x00, 0xb2, 0x0c, 0xb4, 0x00, 0xd7, 0x00));
    expect(d).toEqual({ instantaneousSpeed: 32.5, instantaneousCadence: 90, instantaneousPower: 215 });
  });

  it("omits speed when More Data is set", () => {
    expect(ftms.parseIndoorBikeData(view(0x41, 0x00, 0x2c, 0x01))).toEqual({ instantaneousPower: 300 });
  });

  it("walks every optional field in order", () => {
    const bytes = [
      0xff, 0x1f, 0xe8, 0x03, 0xa0, 0x00, 0x96, 0x00, 0x10, 0x27, 0x00, 0x05, 0x00, 0xfa, 0x00, 0xc8, 0x00,
      0x64, 0x00, 0xff, 0xff, 0xff, 0x8c, 0x41, 0x3c, 0x00, 0x78, 0x00,
    ];
    expect(ftms.parseIndoorBikeData(view(...bytes))).toEqual({
      averageSpeed: 10,
      instantaneousCadence: 80,
      averageCadence: 75,
      totalDistance: 10000,
      resistanceLevel: 5,
      instantaneousPower: 250,
      averagePower: 200,
      totalEnergy: 100,
      heartRate: 140,
      metabolicEquivalent: 6.5,
      elapsedTime: 60,
      remainingTime: 120,
    });
  });

  it("reads features, power range and responses", () => {
    expect(ftms.parseFitnessMachineFeature(view(0, 0, 0, 0, 0x08, 0x20, 0, 0))).toMatchObject({
      powerTargetSupported: true,
      simulationSupported: true,
    });
    expect(ftms.parsePowerRange(view(0, 0, 0xd0, 0x07, 1, 0))).toEqual({ min: 0, max: 2000, increment: 1 });
    expect(ftms.parseFtmsResponse(view(0x80, 0x05, 0x01))).toEqual({ requestOpCode: 5, resultCode: 1 });
    expect(ftms.parseFtmsResponse(view(0x05, 0x01))).toBeUndefined();
  });

  it("encodes control point commands", () => {
    expect(hex(ftms.encodeSetTargetPower(250))).toBe("05 fa 00");
    expect(hex(ftms.encodeSetIndoorBikeSimulation({ grade: 4.5, windSpeed: 0, crr: 0.004, cw: 0.51 }))).toBe(
      "11 00 00 c2 01 28 33",
    );
    expect(hex(ftms.encodeSetIndoorBikeSimulation({ grade: -2, windSpeed: -1.5, crr: 0.004, cw: 0.51 }))).toBe(
      "11 24 fa 38 ff 28 33",
    );
  });
});

describe("FTMS fitness machine status", () => {
  const view = (...b: number[]) => new DataView(Uint8Array.from(b).buffer);
  it("decodes what other clients did to the trainer", () => {
    expect(ftms.parseFitnessMachineStatus(view(0xff))).toEqual({ kind: "control-lost" });
    expect(ftms.parseFitnessMachineStatus(view(0x01))).toEqual({ kind: "reset" });
    expect(ftms.parseFitnessMachineStatus(view(0x02, 0x01))).toEqual({ kind: "stopped" });
    expect(ftms.parseFitnessMachineStatus(view(0x08, 0xc8, 0x00))).toEqual({ kind: "target-power", watts: 200 });
    // wind 0.5 m/s, grade -2.5 %
    expect(ftms.parseFitnessMachineStatus(view(0x12, 0xf4, 0x01, 0x06, 0xff, 40, 51))).toEqual({
      kind: "simulation",
      windSpeed: 0.5,
      grade: -2.5,
    });
    expect(ftms.parseFitnessMachineStatus(view(0x0a))).toEqual({ kind: "other", opCode: 0x0a });
    expect(ftms.parseFitnessMachineStatus(view())).toBeUndefined();
  });
});

describe("Cycling Power", () => {
  it("parses power with wheel and crank data", () => {
    const m = cyclingPower.parseCyclingPowerMeasurement(
      view(0x30, 0x00, 0xc8, 0x00, 0x0a, 0, 0, 0, 0x00, 0x08, 0x05, 0x00, 0x00, 0x04),
    );
    expect(m).toEqual({
      power: 200,
      wheel: { revolutions: 10, eventTime: 2048 },
      crank: { revolutions: 5, eventTime: 1024 },
    });
  });

  it("skips pedal balance and torque fields", () => {
    const m = cyclingPower.parseCyclingPowerMeasurement(view(0x25, 0x00, 0x64, 0x00, 0x32, 0x10, 0x00, 0x07, 0x00, 0x00, 0x08));
    expect(m).toEqual({ power: 100, crank: { revolutions: 7, eventTime: 2048 } });
  });

  it("derives a rate across counter roll-over and drops to 0 when stopped", () => {
    const rate = new cyclingPower.RevolutionRate(0x10000, 1024, 2000);
    expect(rate.update({ revolutions: 0xffff, eventTime: 0xfc00 }, 0)).toBeUndefined();
    // 1.5 revolutions/s: 3 revs in 2 s (2048 ticks), both counters wrap
    expect(rate.update({ revolutions: 2, eventTime: 0x0400 }, 1000)).toBe(1.5);
    expect(rate.update({ revolutions: 2, eventTime: 0x0400 }, 2000)).toBe(1.5);
    expect(rate.update({ revolutions: 2, eventTime: 0x0400 }, 3500)).toBe(0);
  });
});

describe("Wahoo legacy", () => {
  it("encodes commands", () => {
    expect(hex(wahoo.encodeWahooUnlock())).toBe("20 ee fc");
    expect(hex(wahoo.encodeWahooErg(250))).toBe("42 fa 00");
    expect(hex(wahoo.encodeWahooSimMode(84, 0.004, 0.51))).toBe("43 d0 20 28 00 fe 01");
    expect(hex(wahoo.encodeWahooGrade(0))).toBe("46 00 80"); // 32768 = flat
    expect(hex(wahoo.encodeWahooGrade(-100))).toBe("46 00 00");
    expect(hex(wahoo.encodeWahooGrade(100))).toBe("46 ff ff");
    expect(hex(wahoo.encodeWahooWindSpeed(0))).toBe("47 00 80");
    expect(hex(wahoo.encodeWahooWheelCircumference(2.096))).toBe("48 e0 51");
  });
});

describe("FE-C", () => {
  it("wraps pages into acknowledged ANT messages with checksum", () => {
    expect(hex(fec.encodeFecTargetPower(250))).toBe("a4 09 4f 05 31 ff ff ff ff ff e8 03 c2");
    expect(hex(fec.encodeFecTrackResistance(5, 0.004))).toBe("a4 09 4f 05 33 ff ff ff ff 14 50 50 c0");
  });

  it("encodes wind and user configuration", () => {
    expect(hex(fec.encodeFecWindResistance(0.51, 0))).toBe("a4 09 4f 05 32 ff ff ff ff 33 7f 64 fd");
    // 75 kg rider, 9 kg bike (180 * 0.05), 2.096 m circumference -> 67 cm diameter
    expect(hex(fec.encodeFecUserConfiguration(75, 9, 2.096)).slice(12, 35)).toBe("37 4c 1d ff 40 0b 43 00");
  });

  it("rejects malformed messages and parses data pages", () => {
    expect(fec.unwrapFecMessage(view(0xa4, 0x09, 0x4e, 0x05, 0x10, 0, 0, 0, 0, 0, 0, 0, 0x00))).toBeUndefined();
    const general = Uint8Array.of(0xa4, 0x09, 0x4e, 0x05, 0x10, 0x19, 0x28, 0x64, 0x28, 0x23, 0x8c, 0x04, 0);
    general[12] = general.slice(0, 12).reduce((a, b) => a ^ b, 0);
    const page = fec.unwrapFecMessage(new DataView(general.buffer))!;
    const parsed = fec.parseFecPage(page)!;
    expect(parsed).toMatchObject({ page: 0x10, distance: 100, heartRate: 140 });
    expect((parsed as fec.FecGeneralData).speed).toBeCloseTo(32.4, 1); // 9000 mm/s

    const trainer = Uint8Array.of(0xa4, 0x09, 0x4e, 0x05, 0x19, 1, 90, 0, 0, 0x2c, 0x31, 0, 0);
    trainer[12] = trainer.slice(0, 12).reduce((a, b) => a ^ b, 0);
    expect(fec.parseFecPage(fec.unwrapFecMessage(new DataView(trainer.buffer))!)).toEqual({
      page: 0x19,
      cadence: 90,
      power: 300,
    });
  });
});

describe("Heart rate", () => {
  it("reads uint8 and uint16 formats", () => {
    expect(parseHeartRate(view(0x00, 0x48))).toBe(72);
    expect(parseHeartRate(view(0x01, 0x2c, 0x01))).toBe(300);
  });
});
