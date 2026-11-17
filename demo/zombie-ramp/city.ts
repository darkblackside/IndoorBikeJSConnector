/**
 * Top-down city grid: the rider drives along streets, turning at intersections,
 * and a horde of zombies follows the same route. Units are metres.
 */
export const BLOCK = 70; // distance between street centre lines
const STREET = 14; // street width

interface Pt {
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

interface Zombie {
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

interface Wanderer {
  x: number;
  y: number;
  dx: number;
  dy: number;
  phase: number;
}

const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface Colors {
  ground: string;
  street: string;
  building: string[];
  route: string;
  player: string;
  zombie: string;
}

export const darkColors: Colors = {
  ground: "#0d1014",
  street: "#232a33",
  building: ["#151a20", "#181e25", "#1b222a", "#12161b"],
  route: "rgba(64, 224, 208, 0.22)",
  player: "#40e0d0",
  zombie: "#ff3b3b",
};

export class CityScene {
  readonly route: Route;
  /** Rider's distance along the route. */
  s = 300;
  /** Distance between rider and the horde's front. */
  gap = 50;
  horde: Zombie[] = [];
  wanderers: Wanderer[] = [];
  private time = 0;
  private camX = 0;
  private camY = 0;

  constructor(rand: () => number = Math.random) {
    this.route = new Route(rand);
    const p = this.route.at(this.s);
    this.camX = p.x;
    this.camY = p.y;
    this.addZombies(4);
  }

  addZombies(n: number): void {
    const behind = this.route.at(this.s - this.gap - 40);
    for (let i = 0; i < n; i++) {
      this.horde.push({
        lag: Math.random() * Math.min(10 + this.horde.length * 1.5, 70),
        side: (Math.random() - 0.5) * (STREET - 4),
        phase: Math.random() * Math.PI * 2,
        x: behind.x + (Math.random() - 0.5) * 20,
        y: behind.y + (Math.random() - 0.5) * 20,
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
          lag: 10 + Math.random() * 40,
          s: this.s + Math.min(0, ahead),
          side: (Math.random() - 0.5) * 10,
          phase: w.phase,
          x: w.x,
          y: w.y,
        });
        return false;
      }
      return d < 260;
    });
    while (this.wanderers.length < 14) {
      const a = Math.random() * Math.PI * 2;
      const r = 140 + Math.random() * 100;
      const horizontal = Math.random() < 0.5;
      let x = me.x + Math.cos(a) * r;
      let y = me.y + Math.sin(a) * r;
      if (horizontal) y = Math.round(y / BLOCK) * BLOCK + (Math.random() - 0.5) * 8;
      else x = Math.round(x / BLOCK) * BLOCK + (Math.random() - 0.5) * 8;
      const sp = 0.6 + Math.random() * 0.8;
      const sign = Math.random() < 0.5 ? -1 : 1;
      this.wanderers.push({ x, y, dx: horizontal ? sign * sp : 0, dy: horizontal ? 0 : sign * sp, phase: Math.random() * 6 });
    }
    for (const w of this.wanderers) {
      // Shamble along the street; now and then turn towards the rider.
      const away = w.dx * (me.x - w.x) + w.dy * (me.y - w.y) < 0;
      if (away && Math.random() < dt * 0.3) {
        w.dx = -w.dx;
        w.dy = -w.dy;
      }
      w.x += w.dx * dt;
      w.y += w.dy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, c: Colors, danger: number): void {
    const me = this.route.at(this.s);
    // Camera looks a little ahead, smoothed so corners don't jerk the view.
    const scale = Math.min(w, h) / 230;
    const lookX = me.x + me.dx * 25;
    const lookY = me.y + me.dy * 25;
    const k = 0.08;
    this.camX += (lookX - this.camX) * k;
    this.camY += (lookY - this.camY) * k;

    ctx.save();
    ctx.fillStyle = c.ground;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-this.camX, -this.camY);

    // Blocks and streets
    const halfW = w / 2 / scale + BLOCK;
    const halfH = h / 2 / scale + BLOCK;
    const x0 = Math.floor((this.camX - halfW) / BLOCK);
    const x1 = Math.ceil((this.camX + halfW) / BLOCK);
    const y0 = Math.floor((this.camY - halfH) / BLOCK);
    const y1 = Math.ceil((this.camY + halfH) / BLOCK);
    ctx.fillStyle = c.street;
    ctx.fillRect(x0 * BLOCK, y0 * BLOCK, (x1 - x0) * BLOCK, (y1 - y0) * BLOCK);
    const inset = STREET / 2;
    for (let i = x0; i < x1; i++) {
      for (let j = y0; j < y1; j++) {
        const bx = i * BLOCK + inset;
        const by = j * BLOCK + inset;
        const size = BLOCK - STREET;
        // A few buildings per block
        const split = hash(i, j);
        ctx.fillStyle = c.building[Math.floor(split * c.building.length)]!;
        if (split < 0.35) {
          ctx.fillRect(bx, by, size, size);
        } else if (split < 0.7) {
          const m = size * (0.35 + hash(j, i) * 0.3);
          ctx.fillRect(bx, by, m - 1.5, size);
          ctx.fillStyle = c.building[Math.floor(hash(i + 7, j) * c.building.length)]!;
          ctx.fillRect(bx + m + 1.5, by, size - m - 1.5, size);
        } else {
          const half = size / 2;
          for (let q = 0; q < 4; q++) {
            ctx.fillStyle = c.building[Math.floor(hash(i * 4 + q, j) * c.building.length)]!;
            ctx.fillRect(bx + (q % 2) * (half + 1.5), by + Math.floor(q / 2) * (half + 1.5), half - 1.5, half - 1.5);
          }
        }
      }
    }

    // Route ahead (where you'll turn) and trail behind
    const line = (pts: Pt[], style: string | CanvasGradient, width: number, dash: number[] = []) => {
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(this.route.polyline(this.s, this.s + 220), c.route, 2.2, [4, 4]);
    line(this.route.polyline(this.s - 45, this.s), "rgba(64,224,208,0.45)", 1.8);

    // Wanderers
    for (const z of this.wanderers) this.dot(ctx, z.x, z.y, 1.7, c.zombie, 0.55);
    // Horde
    for (const z of this.horde) this.dot(ctx, z.x, z.y, 2, c.zombie, 0.95, 6);

    // Player
    const pulse = 1 + Math.sin(this.time * 6) * 0.08;
    ctx.shadowColor = c.player;
    ctx.shadowBlur = 18;
    this.dot(ctx, me.x, me.y, 3 * pulse, c.player, 1);
    ctx.shadowBlur = 0;
    ctx.restore();

    // Red vignette when the horde is close
    if (danger > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, "rgba(255,0,0,0)");
      g.addColorStop(1, `rgba(255,30,30,${(0.15 + 0.25 * Math.abs(Math.sin(this.time * 5))) * danger})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, glow = 0): void {
    ctx.globalAlpha = alpha;
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (glow) ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}
