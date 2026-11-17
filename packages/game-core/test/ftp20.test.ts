import { describe, expect, it } from "vitest";
import { buildActivity } from "../src/zombie-ramp/activity.ts";
import {
  blockAt,
  COUNTDOWN_SECONDS,
  defaultFtp20Config,
  ergTargetAt,
  Ftp20Recorder,
  ftp20Result,
  Ftp20Session,
  heartRateGuide,
  maxHeartRate,
  PacingCoach,
  pacingSummary,
  paceZone,
  PHASE_SECONDS,
  planBlocks,
  planWatts,
  resultNote,
  type Ftp20Event,
} from "../src/ftp20/index.ts";

const cfg = { ...defaultFtp20Config, easyWatts: 120, hardWatts: 260 };
const blocks = planBlocks(cfg);

describe("ftp20 plan", () => {
  it("covers each phase with blocks of 2–5 minutes and no gaps", () => {
    for (const phase of ["warmup", "test", "cooldown"] as const) {
      const bs = blocks.filter((b) => b.phase === phase);
      expect(bs[0]!.start).toBe(0);
      expect(bs.at(-1)!.end).toBe(PHASE_SECONDS[phase]);
      bs.forEach((b, i) => {
        if (i > 0) expect(b.start).toBe(bs[i - 1]!.end);
        expect(b.end - b.start).toBeGreaterThanOrEqual(120);
        expect(b.end - b.start).toBeLessThanOrEqual(300);
      });
    }
    expect(PHASE_SECONDS).toEqual({ warmup: 1200, test: 1200, cooldown: 600 });
  });

  it("derives the warm-up wattages from easy and hard, and never uses ERG in the test", () => {
    expect(planWatts(cfg)).toEqual({ easy: 120, moderate: 190, hard: 260, cooldownEnd: 100 });
    expect(blocks.filter((b) => b.phase === "warmup").map((b) => b.watts)).toEqual([120, 190, 190, 260, 120]);
    expect(blocks.filter((b) => b.phase === "test").every((b) => b.watts === undefined)).toBe(true);
    expect(blocks.filter((b) => b.phase === "cooldown").map((b) => b.watts)).toEqual([120, 100]);
    // An opener below the easy level makes no sense: it is lifted above it.
    expect(planWatts({ ...cfg, easyWatts: 200, hardWatts: 150 }).hard).toBe(210);
  });

  it("has a 2-minute opener reaching towards 90 % of max HR", () => {
    const opener = blocks.find((b) => b.title === "Opener")!;
    expect(opener.end - opener.start).toBe(120);
    expect(opener.hr[1]).toBe(0.9);
  });

  it("finds the block and ERG target, releasing the trainer for the countdown", () => {
    expect(blockAt(blocks, "warmup", 0).block.title).toBe("Easy spin");
    expect(blockAt(blocks, "warmup", 13 * 60 + 5).block.title).toBe("Opener");
    expect(blockAt(blocks, "test", 17 * 60).block.title).toBe("Empty the tank");
    expect(blockAt(blocks, "test", 1200).phaseRemaining).toBeCloseTo(0);
    expect(ergTargetAt(blocks, "warmup", 14 * 60)).toBe(260);
    expect(ergTargetAt(blocks, "warmup", 1200 - COUNTDOWN_SECONDS - 1)).toBe(120);
    expect(ergTargetAt(blocks, "warmup", 1200 - COUNTDOWN_SECONDS + 1)).toBeUndefined();
    expect(ergTargetAt(blocks, "test", 100)).toBeUndefined();
  });

  it("works out max HR from the entered value or the age (Tanaka), and the HR guide", () => {
    expect(maxHeartRate({})).toBeUndefined();
    expect(maxHeartRate({ age: 40 })).toBe(180);
    expect(maxHeartRate({ age: 40, maxHr: 192 })).toBe(192);
    expect(maxHeartRate({ age: 5 })).toBeUndefined();
    expect(heartRateGuide(blocks[0]!, 180)).toEqual({ low: 108, high: 126 });
    expect(heartRateGuide(blocks[0]!, undefined)).toBeUndefined();
  });
});

const types = (events: Ftp20Event[]) => events.map((e) => e.type);

describe("ftp20 session", () => {
  it("runs warm-up → test → cool-down → done with block, cue and countdown events", () => {
    const s = new Ftp20Session(cfg);
    const all: Ftp20Event[] = [];
    for (let i = 0; i < 3000 * 4; i++) all.push(...s.advance(0.25));
    expect(s.done).toBe(true);
    expect(s.t).toBeCloseTo(3000);
    const blockTitles = all.filter((e) => e.type === "block").map((e) => (e.type === "block" ? e.block.title : ""));
    expect(blockTitles).toEqual(blocks.map((b) => b.title));
    expect(all.filter((e) => e.type === "phase").map((e) => (e.type === "phase" ? e.phase : ""))).toEqual(["test", "cooldown"]);
    expect(all.filter((e) => e.type === "countdown").map((e) => (e.type === "countdown" ? e.seconds : 0))).toEqual([
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
    const cues = all.filter((e) => e.type === "cue").map((e) => (e.type === "cue" ? e.text : ""));
    expect(cues).toContain("Last 3 minutes – empty the tank!");
    expect(cues.filter((c) => c.startsWith("Spin-up"))).toHaveLength(3);
    expect(types(all).indexOf("test-complete")).toBeLessThan(types(all).lastIndexOf("phase"));
    expect(types(all).at(-1)).toBe("done");
  });

  it("handles big steps of a sped-up clock across phase boundaries", () => {
    const s = new Ftp20Session(cfg);
    const events = s.advance(1250);
    expect(s.phase).toBe("test");
    expect(s.phaseTime).toBeCloseTo(50);
    expect(s.phaseStarts.test).toBe(1200);
    expect(types(events)).toContain("phase");
    expect(s.testTime).toBeCloseTo(50);
  });

  it("skips the warm-up to the countdown, and the cool-down to the result", () => {
    const s = new Ftp20Session(cfg);
    s.advance(30);
    const ev = s.skipWarmup();
    expect(s.phase).toBe("warmup");
    expect(s.state.countdown).toBe(COUNTDOWN_SECONDS);
    expect(s.state.target).toBeUndefined();
    expect(types(ev)).toContain("block");
    expect(types(ev)).toContain("countdown");
    expect(ev).toContainEqual({ type: "cue", text: "Shift into your test gear – the trainer lets go" });
    s.advance(COUNTDOWN_SECONDS);
    expect(s.phase).toBe("test");
    expect(s.t).toBeCloseTo(30 + COUNTDOWN_SECONDS);
    s.advance(1200);
    expect(s.phase).toBe("cooldown");
    expect(s.skipCooldown()).toEqual([{ type: "done" }]);
    expect(s.done).toBe(true);
  });

  it("pauses on a stop in warm-up/cool-down and asks in the test; continuing marks the test interrupted", () => {
    const s = new Ftp20Session(cfg);
    s.advance(100);
    expect(s.stopAction()).toBe("pause");
    s.rewind(96);
    expect(s.t).toBe(96);
    expect(s.phaseTime).toBe(96);
    s.markInterrupted(); // not in the test: no effect
    expect(s.interruptions).toBe(0);
    s.advance(1104 + 300);
    expect(s.phase).toBe("test");
    expect(s.stopAction()).toBe("ask");
    // Rewinding never goes back into the warm-up.
    s.rewind(1100);
    expect(s.phase).toBe("test");
    expect(s.phaseTime).toBe(0);
    s.advance(300);
    s.markInterrupted();
    expect(s.interruptions).toBe(1);
    s.advance(900);
    expect(s.phase).toBe("cooldown");
    expect(s.stopAction()).toBe("pause");
  });

  it("aborting ends the session", () => {
    const s = new Ftp20Session(cfg);
    s.advance(1300);
    expect(types(s.abort())).toEqual(["done"]);
    expect(s.aborted).toBe(true);
    expect(s.advance(10)).toEqual([]);
  });
});

describe("ftp20 pacing coach", () => {
  it("classifies deviations", () => {
    expect(paceZone(0)).toBe("steady");
    expect(paceZone(0.05)).toBe("over");
    expect(paceZone(0.1)).toBe("way-over");
    expect(paceZone(-0.05)).toBe("under");
    expect(paceZone(-0.2)).toBe("way-under");
  });

  it("waits a minute, then compares the recent power with the rider's own average, without numbers", () => {
    const c = new PacingCoach();
    for (let t = 0; t < 30; t++) c.push(t, 250);
    expect(c.advice().ready).toBe(false);
    for (let t = 30; t < 200; t++) c.push(t, 250);
    let a = c.advice();
    expect(a.zone).toBe("steady");
    expect(a.text).toBe("Steady, hold this");
    for (let t = 200; t < 220; t++) c.push(t, 300);
    a = c.advice();
    expect(a.zone).toBe("way-over");
    expect(a.text).toMatch(/Too hot/);
    for (let t = 220; t < 240; t++) c.push(t, 200);
    a = c.advice();
    expect(a.tone).toBe("push");
    // Never a wattage in the advice.
    expect(a.text).not.toMatch(/\d+\s*W\b/);
  });

  it("asks to empty the tank in the last 3 minutes", () => {
    const c = new PacingCoach();
    for (let t = 0; t < 1030; t++) c.push(t, 250);
    expect(c.advice().text).toMatch(/push/);
    for (let t = 1030; t < 1060; t++) c.push(t, 300);
    expect(c.advice().text).toMatch(/empty the tank/);
  });

  it("fills skipped seconds and can be wound back", () => {
    const c = new PacingCoach();
    c.push(0, 200);
    c.push(5, 200);
    expect(c.seconds).toBe(6);
    c.truncate(2);
    expect(c.seconds).toBe(3);
  });
});

describe("ftp20 result", () => {
  /** A full session: warm-up at the ERG targets, the test at `testPower(t)`, cool-down. */
  function ride(testPower: (t: number) => number, testSeconds = 1200) {
    const rec = new Ftp20Recorder(blocks);
    let t = 0;
    for (let i = 0; i < 1200; i++, t++) rec.record(t, "warmup", i, ergTargetAt(blocks, "warmup", i) ?? 150, 120, { cadence: 90, target: ergTargetAt(blocks, "warmup", i) });
    for (let i = 0; i < testSeconds; i++, t++) rec.record(t, "test", i, testPower(i), 170, { cadence: 92 });
    if (testSeconds >= 1200) for (let i = 0; i < 600; i++, t++) rec.record(t, "cooldown", i, 110, 120, { cadence: 88, target: 110 });
    return rec;
  }

  it("FTP = 20-min average × 0.95, with block powers and an even-pacing verdict", () => {
    const rec = ride(() => 260);
    const r = ftp20Result(cfg, rec.testSamples(), { testSeconds: 1200 });
    expect(r.complete).toBe(true);
    expect(r.reliable).toBe(true);
    expect(r.avgPower).toBe(260);
    expect(r.ftp).toBe(247);
    expect(r.blockPowers).toEqual([260, 260, 260, 260]);
    expect(r.pacing).toBe("even");
    expect(r.variability).toBeCloseTo(0);
    expect(r.avgCadence).toBe(92);
    expect(pacingSummary(r)).toMatch(/Even pacing/);
    expect(resultNote(r, cfg)).toContain("260 W × 0.95 = 247 W");
  });

  it("calls out a faded test and a negative split", () => {
    const faded = ftp20Result(cfg, ride((t) => (t < 600 ? 300 : 240)).testSamples(), { testSeconds: 1200 });
    expect(faded.pacing).toBe("faded");
    expect(faded.avgPower).toBe(270);
    const neg = ftp20Result(cfg, ride((t) => (t < 600 ? 240 : 280)).testSamples(), { testSeconds: 1200 });
    expect(neg.pacing).toBe("negative-split");
  });

  it("gives no FTP for an incomplete or aborted test, and flags an interrupted one as unreliable", () => {
    const part = ride(() => 250, 700);
    const inc = ftp20Result(cfg, part.testSamples(), { testSeconds: 700 });
    expect(inc.complete).toBe(false);
    expect(inc.ftp).toBeUndefined();
    expect(inc.avgPower).toBe(250);
    expect(resultNote(inc, cfg)).toMatch(/11:40 of 20:00/);
    const ab = ftp20Result(cfg, part.testSamples(), { testSeconds: 700, aborted: true });
    expect(ab.ftp).toBeUndefined();
    expect(resultNote(ab, cfg)).toMatch(/aborted.*no valid FTP/);
    const int = ftp20Result(cfg, ride(() => 250).testSamples(), { testSeconds: 1200, interruptions: 1 });
    expect(int.ftp).toBe(238);
    expect(int.reliable).toBe(false);
    expect(resultNote(int, cfg)).toMatch(/Not reliable: the test was interrupted/);
  });

  it("records one lap per block and builds the activity from them", () => {
    const rec = ride(() => 250);
    expect(rec.lapStarts).toEqual(blocks.map((b) => (b.phase === "warmup" ? 0 : b.phase === "test" ? 1200 : 2400) + b.start));
    const a = buildActivity(rec.samples, rec.lapStarts, new Date("2026-11-17T18:00:00Z"), 3000);
    expect(a.laps).toHaveLength(blocks.length);
    expect(a.laps[5]!.start).toBe(1200);
    expect(a.laps[5]!.summary.avgPower).toBe(250);
    expect(a.laps.at(-1)!.duration).toBe(300);
    rec.truncate(1250);
    expect(rec.lapStarts.at(-1)).toBe(1200);
    expect(rec.samples.at(-1)!.t).toBe(1250);
  });
});
