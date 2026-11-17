import { describe, expect, it } from "vitest";
import {
  completedSteps,
  defaultRampConfig,
  ftpMargin,
  gapSurge,
  onStop,
  RampRecorder,
  rampStateAt,
  restGapForCadence,
  speedFromPower,
  StopDetector,
} from "../src/zombie-ramp/ramp.ts";

const cfg = { ...defaultRampConfig, warmupSeconds: 300, warmupWatts: 100, startWatts: 100, stepWatts: 25 };

describe("ramp FTP test", () => {
  it("follows warm-up then +25 W every minute", () => {
    expect(rampStateAt(cfg, 0)).toMatchObject({ phase: "warmup", target: 100, remaining: 300, nextTarget: 100 });
    expect(rampStateAt(cfg, 300)).toMatchObject({ phase: "ramp", step: 0, target: 100 });
    expect(rampStateAt(cfg, 359.5)).toMatchObject({ step: 0, target: 100, remaining: 0.5 });
    expect(rampStateAt(cfg, 360)).toMatchObject({ step: 1, target: 125, nextTarget: 150 });
    expect(rampStateAt({ ...cfg, stepWatts: 20 }, 300 + 5 * 60 + 1).target).toBe(200);
  });

  it("computes FTP from the last fully completed step × 0.75", () => {
    const rec = new RampRecorder(cfg);
    // 5 min warm-up, 8 full steps (100..275 W), 40 s into the 9th (300 W)
    const end = 300 + 8 * 60 + 40;
    for (let t = 0; t < end; t++) rec.record(t, rampStateAt(cfg, t).target);
    const r = rec.result(end);
    expect(completedSteps(cfg, end)).toBe(8);
    expect(r.lastStepWatts).toBe(275);
    expect(r.ftp).toBe(206); // 275 × 0.75 = 206.25
    expect(r.bestMinutePower).toBe(Math.round((275 * 20 + 300 * 40) / 60));
    expect(r.maxPower).toBe(300);
    expect(r.endedInWarmup).toBe(false);
  });

  it("gives no FTP when stopped during warm-up or the first step", () => {
    expect(new RampRecorder(cfg).result(200)).toMatchObject({ ftp: undefined, endedInWarmup: true });
    expect(new RampRecorder(cfg).result(330)).toMatchObject({ ftp: undefined, completedSteps: 0 });
  });

  it("pauses on a stop during the warm-up, ends the test once the ramp has started", () => {
    expect(onStop(cfg, 0)).toBe("pause");
    expect(onStop(cfg, 299.9)).toBe("pause");
    expect(onStop(cfg, 300)).toBe("finish");
    expect(onStop({ ...cfg, warmupSeconds: 0 }, 0)).toBe("finish");
  });

  it("drops samples after a paused warm-up was wound back", () => {
    const rec = new RampRecorder(cfg);
    for (let t = 0; t <= 20; t++) rec.record(t, 100);
    rec.truncate(16.4);
    expect(rec.samples.at(-1)!.t).toBe(16);
    rec.record(16.9, 100); // same second: not recorded twice
    rec.record(17.2, 100);
    expect(rec.samples.map((s) => s.t).slice(-3)).toEqual([15, 16, 17]);
  });

  it("gives the FTP a margin of ±10 %", () => {
    expect(ftpMargin(281)).toBe(28);
    expect(ftpMargin(200)).toBe(20);
    expect(ftpMargin(4)).toBe(1);
  });

  it("detects that the rider stopped pedalling", () => {
    const d = new StopDetector(4);
    expect(d.update(0, 90, 200)).toBe(false);
    expect(d.update(3, 10, 0)).toBe(false);
    expect(d.update(4.1, 0, 0)).toBe(true);
    d.reset();
    // no cadence sensor: falls back to power
    expect(d.update(10, undefined, 150)).toBe(false);
    expect(d.update(15, undefined, 150, false)).toBe(true); // stale data counts as stopped
  });

  it("lets the horde rest closer the lower the cadence", () => {
    expect(restGapForCadence(90)).toBe(50);
    expect(restGapForCadence(110)).toBe(50);
    expect(restGapForCadence(40)).toBe(10);
    expect(restGapForCadence(20)).toBe(10);
    expect(restGapForCadence(65)).toBe(30); // straight line: halfway between 40 and 90 rpm
    expect(restGapForCadence(80)).toBeCloseTo(42);
  });

  it("surges the horde by about ±5 m, smoothly", () => {
    let max = 0;
    let maxStep = 0;
    for (let t = 0; t < 600; t += 0.1) {
      max = Math.max(max, Math.abs(gapSurge(t)));
      maxStep = Math.max(maxStep, Math.abs(gapSurge(t + 0.1) - gapSurge(t)));
    }
    expect(max).toBeLessThanOrEqual(5);
    expect(max).toBeGreaterThan(4); // it does reach the full range now and then
    expect(maxStep).toBeLessThan(0.7); // < 7 m/s: a surge, not a jump
  });

  it("turns power into a plausible flat-road speed", () => {
    expect(speedFromPower(0)).toBe(0);
    expect(speedFromPower(200) * 3.6).toBeGreaterThan(20);
    expect(speedFromPower(200) * 3.6).toBeLessThan(40);
    expect(speedFromPower(300)).toBeGreaterThan(speedFromPower(200));
  });
});
