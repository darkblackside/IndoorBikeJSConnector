/**
 * Top-down city grid: the rider drives along streets, turning at intersections,
 * and a horde of zombies follows the same route. Units are metres.
 *
 * Simulation only: no DOM, no canvas, no engine. It runs in the browser and in Node (the future multiplayer
 * server), and a renderer (canvas today, a game engine later) only reads its state. All randomness goes through
 * the injected `rand`, so a seeded generator (see `mulberry32`) makes a city reproducible on every client.
 */
export const BLOCK = 70; // distance between street centre lines
export const STREET = 14; // street width

export interface Pt {
  x: number;
  y: number;
}

/** A route along grid edges, extended on demand. Distance `s` is measured from its start. */
export class Route {
  private pts: Pt[] = [{ x: 0, y: 0 }];
  private cum: number[] = [0];
  private dir = 0; // 0 E, 1 S, 2 W, 3 N

  constructor(private rand: () => number = Math.random) {
    this.extend(600);
  }

  get length(): number {
    return this.cum.at(-1)!;
  }

  /** Make sure the route reaches `s`. */
  extend(s: number): void {
    while (this.length < s) {
      const blocks = 1 + Math.floor(this.rand() * 3);
      const last = this.pts.at(-1)!;
      const [dx, dy] = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][this.dir]!;
      const p = { x: last.x + dx! * blocks * BLOCK, y: last.y + dy! * blocks * BLOCK };
      this.pts.push(p);
      this.cum.push(this.length + blocks * BLOCK);
      this.dir = (this.dir + (this.rand() < 0.5 ? 1 : 3)) % 4; // turn left or right at the corner
    }
  }

  /** Position and unit direction at distance `s`. */
  at(s: number): { x: number; y: number; dx: number; dy: number } {
    s = Math.max(0, s);
    this.extend(s + 1);
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo]!;
    const b = this.pts[lo + 1]!;
    const len = this.cum[lo + 1]! - this.cum[lo]!;
    const f = (s - this.cum[lo]!) / len;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
  }

  /** Polyline between distances s0 and s1 (corners included). */
  polyline(s0: number, s1: number): Pt[] {
    s0 = Math.max(0, s0);
    this.extend(s1 + 1);
    const out: Pt[] = [this.at(s0)];
    for (let i = 0; i < this.cum.length; i++) {
      if (this.cum[i]! > s0 && this.cum[i]! < s1) out.push(this.pts[i]!);
    }
    out.push(this.at(s1));
    return out;
  }
}

/** How fast a picked-up stray follows the rider, relative to the rider's speed: it drops back to the horde. */
export const STRAGGLER_SPEED = 0.7;

export interface Zombie {
  /** How far behind the horde's front it runs (for a straggler: where it will join). */
  lag: number;
  /**
   * Set while it is a straggler: a stray the rider passed, chasing along the route on its own (its distance on the
   * route). It falls back until the horde reaches it, then joins it right where it is.
   */
  s?: number;
  /** Straggler only: its offset from its point on the route, easing from the side street it came from to its place in the street. */
  drift?: { x: number; y: number };
  /** Sideways offset in the street. */
  side: number;
  phase: number;
  x: number;
  y: number;
}

export interface Wanderer {
  x: number;
  y: number;
  dx: number;
  dy: number;
  phase: number;
}

/** Deterministic 0..1 hash of two integers (e.g. which buildings stand on a block). */
export const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class CityWorld {
  readonly route: Route;
  /** Rider's distance along the route. */
  s = 300;
  /** Distance between rider and the horde's front. */
  gap = 50;
  horde: Zombie[] = [];
  wanderers: Wanderer[] = [];
  /** Seconds simulated so far (drives the zombies' sway; renderers use it for animation). */
  time = 0;

  constructor(private readonly rand: () => number = Math.random) {
    this.route = new Route(rand);
    this.addZombies(4);
  }

  addZombies(n: number): void {
    const behind = this.route.at(this.s - this.gap - 40);
    for (let i = 0; i < n; i++) {
      this.horde.push({
        lag: this.rand() * Math.min(10 + this.horde.length * 1.5, 70),
        side: (this.rand() - 0.5) * (STREET - 4),
        phase: this.rand() * Math.PI * 2,
        x: behind.x + (this.rand() - 0.5) * 20,
        y: behind.y + (this.rand() - 0.5) * 20,
      });
    }
  }

  /** Advance: rider moves `ds` metres, horde front is `gap` metres behind. */
  update(dt: number, ds: number, gap: number): void {
    this.time += dt;
    this.s += ds;
    this.gap = gap;
    const front = this.s - gap;
    const k = 1 - Math.exp(-dt * 6);
    for (const z of this.horde) {
      if (z.s !== undefined) {
        this.updateStraggler(z, dt, ds, front);
        continue;
      }
      const p = this.route.at(front - z.lag);
      const o = this.streetOffset(z, p);
      z.x += (p.x + o.x - z.x) * k;
      z.y += (p.y + o.y - z.y) * k;
    }
    this.updateWanderers(dt);
  }

  /** Where in the street (sideways, from the route's centre line) a zombie runs. Turns by 90° at a corner. */
  private streetOffset(z: Zombie, p: { dx: number; dy: number }): Pt {
    const side = z.side + Math.sin(this.time * 3 + z.phase) * 1.2;
    return { x: -p.dy * side, y: p.dx * side };
  }

  /**
   * A straggler follows the rider along the route, but slower, so it drops back. It sits exactly on its own point
   * of the route (no lag) with a sideways offset that eases from where it came from (a side street) to its place
   * in the street, and smoothly round corners. It joins the horde once the horde's slot for it has come up to it
   * and it has settled into the street: right where it is, so it never jumps into the group.
   */
  private updateStraggler(z: Zombie, dt: number, ds: number, front: number): void {
    z.s! += ds * STRAGGLER_SPEED;
    const p = this.route.at(z.s!);
    const o = this.streetOffset(z, p);
    z.drift ??= { x: z.x - p.x, y: z.y - p.y };
    const settle = Math.exp(-dt * 2);
    z.drift.x = o.x + (z.drift.x - o.x) * settle;
    z.drift.y = o.y + (z.drift.y - o.y) * settle;
    z.x = p.x + z.drift.x;
    z.y = p.y + z.drift.y;
    const settled = Math.hypot(z.drift.x - o.x, z.drift.y - o.y) < 0.3;
    if (settled && front - z.lag >= z.s!) {
      z.lag = Math.max(0, front - z.s!);
      z.s = undefined;
      z.drift = undefined;
    }
  }

  /**
   * Stray zombies on side streets. When the rider passes one closely it latches on as a straggler (see `Zombie.s`):
   * it starts chasing from where it stands, level with the rider or behind, and falls back to the horde.
   */
  private updateWanderers(dt: number): void {
    const me = this.route.at(this.s);
    this.wanderers = this.wanderers.filter((w) => {
      const d = Math.hypot(w.x - me.x, w.y - me.y);
      // How far ahead of the rider it is along the route (negative: already passed).
      const ahead = (w.x - me.x) * me.dx + (w.y - me.y) * me.dy;
      if (d < 22 && ahead <= 2) {
        this.horde.push({
          lag: 10 + this.rand() * 40,
          s: this.s + Math.min(0, ahead),
          side: (this.rand() - 0.5) * 10,
          phase: w.phase,
          x: w.x,
          y: w.y,
        });
        return false;
      }
      return d < 260;
    });
    while (this.wanderers.length < 14) {
      const a = this.rand() * Math.PI * 2;
      const r = 140 + this.rand() * 100;
      const horizontal = this.rand() < 0.5;
      let x = me.x + Math.cos(a) * r;
      let y = me.y + Math.sin(a) * r;
      if (horizontal) y = Math.round(y / BLOCK) * BLOCK + (this.rand() - 0.5) * 8;
      else x = Math.round(x / BLOCK) * BLOCK + (this.rand() - 0.5) * 8;
      const sp = 0.6 + this.rand() * 0.8;
      const sign = this.rand() < 0.5 ? -1 : 1;
      this.wanderers.push({ x, y, dx: horizontal ? sign * sp : 0, dy: horizontal ? 0 : sign * sp, phase: this.rand() * 6 });
    }
    for (const w of this.wanderers) {
      // Shamble along the street; now and then turn towards the rider.
      const away = w.dx * (me.x - w.x) + w.dy * (me.y - w.y) < 0;
      if (away && this.rand() < dt * 0.3) {
        w.dx = -w.dx;
        w.dy = -w.dy;
      }
      w.x += w.dx * dt;
      w.y += w.dy * dt;
    }
  }
}

/** Small seeded PRNG (0..1), for reproducible cities: the same seed gives the same route and horde everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
