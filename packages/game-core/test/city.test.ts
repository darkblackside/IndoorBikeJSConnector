import { describe, expect, it } from "vitest";
import { CityWorld, mulberry32, STRAGGLER_SPEED } from "../src/zombie-ramp/city.ts";

describe("Zombie Ramp city: strays the rider passes", () => {
  // The route is random (turns at random corners), so try several cities.
  it.each(Array.from({ length: 20 }, (_, i) => i))("trail the rider, fall back and join the horde without jumping into it (city %i)", () => {
    const scene = new CityWorld();
    const gap = 50;
    const speed = 10; // m/s
    const dt = 1 / 60;
    // A stray standing in the street right next to the rider.
    const me = scene.route.at(scene.s);
    scene.wanderers.push({ x: me.x - me.dy * 6, y: me.y + me.dx * 6, dx: 0, dy: 0, phase: 4242 });
    scene.update(dt, 0, gap);
    const z = scene.horde.find((h) => h.phase === 4242)!;
    expect(z, "latched on").toBeDefined();
    expect(z.s, "is a straggler").toBeDefined();

    let prev = { x: z.x, y: z.y };
    let maxStep = 0;
    let behind = scene.s - z.s!;
    let joinedAfter: number | undefined;
    // Measured while it is a straggler and in the frame it joins (afterwards it moves like any horde zombie).
    for (let i = 1; i <= 90 * 60 && joinedAfter === undefined; i++) {
      scene.update(dt, speed * dt, gap);
      maxStep = Math.max(maxStep, Math.hypot(z.x - prev.x, z.y - prev.y));
      prev = { x: z.x, y: z.y };
      if (z.s === undefined) joinedAfter = i * dt;
      else {
        // It keeps falling back: it follows at a fraction of the rider's speed.
        expect(scene.s - z.s).toBeGreaterThan(behind);
        behind = scene.s - z.s;
      }
    }
    expect(joinedAfter, "joined the horde").toBeDefined();
    // It only joins once the horde has come up to it: (gap + lag) metres at (1 - 0.7) × 10 m/s.
    expect(joinedAfter!).toBeGreaterThan((gap + 10) / ((1 - STRAGGLER_SPEED) * speed) - 1);
    // Never a snap: at most ~0.5 m per frame (30 m/s) on the way, the moment it joins included.
    expect(maxStep).toBeLessThan(0.5);
    // Afterwards it runs with the horde at its slot.
    for (let i = 0; i < 120; i++) scene.update(dt, speed * dt, gap);
    const slot = scene.route.at(scene.s - gap - z.lag);
    expect(Math.hypot(z.x - slot.x, z.y - slot.y)).toBeLessThan(10);
  });
});

describe("Zombie Ramp city: seeded", () => {
  it("builds the same city and horde from the same seed (for multiplayer)", () => {
    const run = (seed: number) => {
      const w = new CityWorld(mulberry32(seed));
      for (let i = 0; i < 600; i++) w.update(1 / 60, 10 / 60, 40);
      return { route: w.route.polyline(0, w.s), horde: w.horde.map((z) => [z.x, z.y]), wanderers: w.wanderers.length };
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});
