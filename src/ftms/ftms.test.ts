import { describe, expect, it } from "vitest";
import * as cp from "./controlPoint.ts";
import { parseHeartRate } from "./heartRate.ts";
import { parseIndoorBikeData } from "./indoorBikeData.ts";

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);

describe("parseIndoorBikeData", () => {
  it("parses a typical KICKR CORE packet (speed, cadence, power)", () => {
    // flags 0x0044: speed present (bit0 clear), cadence (bit2), power (bit6)
    // speed 3250 -> 32.50 km/h, cadence 180 -> 90 rpm, power 215 W
    const data = parseIndoorBikeData(view(0x44, 0x00, 0xb2, 0x0c, 0xb4, 0x00, 0xd7, 0x00));
    expect(data).toEqual({ instantaneousSpeed: 32.5, instantaneousCadence: 90, instantaneousPower: 215 });
  });

  it("omits speed when the More Data bit is set", () => {
    const data = parseIndoorBikeData(view(0x41, 0x00, 0x2c, 0x01));
    expect(data).toEqual({ instantaneousPower: 300 });
  });

  it("walks every optional field in order", () => {
    const bytes = [
      0xff, 0x1f, // every flag (More Data set, so no instantaneous speed)
      0xe8, 0x03, // avg speed 10.00
      0xa0, 0x00, // cadence 80
      0x96, 0x00, // avg cadence 75
      0x10, 0x27, 0x00, // distance 10000 m
      0x05, 0x00, // resistance 5
      0xfa, 0x00, // power 250
      0xc8, 0x00, // avg power 200
      0x64, 0x00, 0xff, 0xff, 0xff, // energy 100 kcal, others N/A
      0x8c, // HR 140
      0x41, // MET 6.5
      0x3c, 0x00, // elapsed 60 s
      0x78, 0x00, // remaining 120 s
    ];
    expect(parseIndoorBikeData(view(...bytes))).toEqual({
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

  it("handles negative power (sint16)", () => {
    expect(parseIndoorBikeData(view(0x41, 0x00, 0xff, 0xff)).instantaneousPower).toBe(-1);
  });
});

describe("control point", () => {
  it("encodes Set Target Power as little-endian sint16", () => {
    expect([...cp.setTargetPower(250)]).toEqual([0x05, 0xfa, 0x00]);
    expect([...cp.setTargetPower(1000.4)]).toEqual([0x05, 0xe8, 0x03]);
  });

  it("encodes simulation parameters", () => {
    // wind 0, grade 4.5 % -> 450, crr 0.004 -> 40, cw 0.51 -> 51
    expect([...cp.setIndoorBikeSimulation(4.5)]).toEqual([0x11, 0, 0, 0xc2, 0x01, 40, 51]);
    expect([...cp.setIndoorBikeSimulation(-2)].slice(3, 5)).toEqual([0x38, 0xff]);
  });

  it("parses responses", () => {
    expect(cp.parseResponse(view(0x80, 0x05, 0x01))).toEqual({ requestOpCode: 5, resultCode: 1 });
    expect(cp.parseResponse(view(0x05, 0x01))).toBeUndefined();
    expect(cp.resultName(cp.ResultCode.ControlNotPermitted)).toBe("control not permitted");
  });

  it("parses the supported power range", () => {
    expect(cp.parsePowerRange(view(0x00, 0x00, 0xd0, 0x07, 0x01, 0x00))).toEqual({ min: 0, max: 2000, increment: 1 });
  });
});

describe("parseHeartRate", () => {
  it("reads uint8 and uint16 formats", () => {
    expect(parseHeartRate(view(0x00, 0x48))).toBe(72);
    expect(parseHeartRate(view(0x01, 0x2c, 0x01))).toBe(300);
  });
});
