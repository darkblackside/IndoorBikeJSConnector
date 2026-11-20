import { describe, expect, it } from "vitest";
import {
  BOT_PERSONAS,
  BotPilot,
  getWorkout,
  hordeLevel,
  levelForTotal,
  levelThreshold,
  listWorkouts,
  MULTIPLIER_STEPS,
  RiderSession,
  sweatPerSecond,
  SWEAT_PER_HOUR_AT_FTP,
  WORKOUT_IDS,
  workoutSeconds,
  type SessionEvent,
} from "../src/horde/index.ts";
import { mulberry32 } from "../src/zombie-ramp/index.ts";
import { checkHordeJoin, checkStart, cleanName, PROTOCOL_VERSION } from "../src/net/index.ts";

/** Rides `seconds` at a fixed power, 4 ticks per second. */
function ride(s: RiderSession, seconds: number, power: number, cadence = 90): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (let i = 0; i < seconds * 4; i++) events.push(...s.tick(0.25, { power, cadence }));
  return events;
}

describe("sweat", () => {
  it("is fair across FTPs: one hour at FTP is the same sweat for everyone", () => {
    for (const ftp of [150, 250, 350]) {
      const s = new RiderSession(ftp, "free");
      ride(s, 3600, ftp);
      // Multipliers rise in free play, so compare the base rate instead.
      expect(sweatPerSecond(ftp / ftp) * 3600).toBeCloseTo(SWEAT_PER_HOUR_AT_FTP);
      expect(s.sweat).toBeGreaterThan(SWEAT_PER_HOUR_AT_FTP);
    }
  });

  it("grows with the square of the intensity", () => {
    expect(sweatPerSecond(2) / sweatPerSecond(1)).toBeCloseTo(4);
    expect(sweatPerSecond(10)).toBe(sweatPerSecond(2.5));
  });
});

describe("workouts", () => {
  it("short versions are about 20 minutes, full ones longer", () => {
    for (const id of WORKOUT_IDS.filter((id) => id !== "free")) {
      const short = workoutSeconds(getWorkout(id, true)) / 60;
      const full = workoutSeconds(getWorkout(id, false)) / 60;
      expect(short, id).toBeGreaterThanOrEqual(17);
      expect(short, id).toBeLessThanOrEqual(24);
      expect(full, id).toBeGreaterThan(short);
    }
  });

  it("has sane blocks", () => {
    for (const w of [...listWorkouts(false), ...listWorkouts(true)]) {
      for (const b of w.blocks) {
        expect(b.seconds, `${w.id} ${b.label}`).toBeGreaterThan(0);
        expect(b.low).toBeLessThan(b.high);
      }
      expect(w.blocks.at(-1)?.kind ?? "cooldown").toBe("cooldown");
    }
  });
});

describe("RiderSession", () => {
  it("raises the multiplier for blocks on target and drops it for misses", () => {
    const s = new RiderSession(200, "sweetspot", true);
    // Warm-up 5 min at 55 % → hit
    let ev = ride(s, 300, 110);
    expect(ev).toContainEqual(expect.objectContaining({ type: "block", hit: true, multiplier: MULTIPLIER_STEPS[1] }));
    // Sweet spot 5 min at 91 % → hit
    ev = ride(s, 300, 182);
    expect(ev).toContainEqual(expect.objectContaining({ type: "block", hit: true, streak: 2 }));
    // Recovery block ridden way too hard → miss
    ev = ride(s, 120, 200);
    expect(ev).toContainEqual(expect.objectContaining({ type: "block", hit: false, streak: 0, multiplier: MULTIPLIER_STEPS[1] }));
    expect(s.bestStreak).toBe(2);
  });

  it("finishes the workout", () => {
    const s = new RiderSession(200, "recovery", true);
    const ev = ride(s, workoutSeconds(s.workout) + 5, 100);
    expect(ev.at(-1)).toEqual({ type: "done" });
    expect(s.done).toBe(true);
    expect(s.summary()).toMatchObject({ completed: true, blocksHit: s.workout.blocks.length });
  });

  it("judges sprints by their average only", () => {
    const s = new RiderSession(200, "speed", true);
    ride(s, 240, 110); // warm-up
    const ev = ride(s, 15, 400);
    expect(ev).toContainEqual(expect.objectContaining({ label: "Sprint 1", hit: true }));
  });

  it("pauses the clock when the rider stops pedalling", () => {
    const s = new RiderSession(200, "endurance", true);
    ride(s, 10, 140);
    const t = s.t;
    ride(s, 20, 0, 0);
    expect(s.paused).toBe(true);
    expect(s.t).toBeCloseTo(t + 3, 0);
  });

  it("free play rewards steady stretches", () => {
    const s = new RiderSession(250, "free");
    const ev = ride(s, 180, 200);
    expect(ev).toContainEqual(expect.objectContaining({ type: "block", hit: true }));
    const easy = ride(s, 180, 80);
    expect(easy).toContainEqual(expect.objectContaining({ type: "block", hit: false }));
  });

  it("caps a rider whose FTP is clearly too low", () => {
    const s = new RiderSession(100, "free");
    ride(s, 600, 250);
    expect(s.governed).toBe(true);
    expect(s.rate).toBeLessThanOrEqual(sweatPerSecond(1) * s.multiplier + 1e-9);
  });
});

describe("horde levels", () => {
  it("levels are quadratic and consistent", () => {
    expect(levelForTotal(0)).toBe(1);
    for (let l = 1; l < 30; l++) {
      expect(levelForTotal(levelThreshold(l))).toBe(l);
      expect(levelForTotal(levelThreshold(l + 1) - 0.01)).toBe(l);
    }
    const h = hordeLevel(levelThreshold(4) + (levelThreshold(5) - levelThreshold(4)) / 2);
    expect(h).toMatchObject({ level: 4, name: "Hungry Horde" });
    expect(h.progress).toBeCloseTo(0.5);
  });
});

describe("bots", () => {
  it("ride their workouts well enough to build a multiplier", () => {
    for (const persona of BOT_PERSONAS) {
      const pilot = new BotPilot(persona, mulberry32(7));
      const s = new RiderSession(persona.ftp, "sweetspot", true);
      while (!s.done) s.tick(0.25, pilot.ride(0.25, s.block));
      expect(s.blocksHit / s.blocksJudged, persona.name).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe("horde protocol checks", () => {
  it("cleans names and falls back to Guest", () => {
    expect(cleanName("  <b>Ann</b>\u0007 ")).toBe("bAnn/b");
    expect(checkHordeJoin({ protocol: PROTOCOL_VERSION, name: "" })).toEqual({ ok: true, value: { protocol: PROTOCOL_VERSION, name: "Guest" } });
    expect(checkHordeJoin({ protocol: 0, name: "x" }).ok).toBe(false);
  });

  it("validates start options", () => {
    expect(checkStart({ workout: "vo2max", short: true, ftp: 250.4 })).toEqual({ workout: "vo2max", short: true, ftp: 250 });
    expect(checkStart({ workout: "nope", ftp: 250 })).toBeUndefined();
    expect(checkStart({ workout: "free", ftp: 5000 })).toBeUndefined();
    expect(checkStart({ workout: "free", ftp: "250" })).toBeUndefined();
  });
});
