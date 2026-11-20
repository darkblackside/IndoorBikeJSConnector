/**
 * What the arena shows, independent of how it is drawn: riders circling on the outer ring, the horde milling in the
 * middle, sweat drops flying from riders into the horde, and the effects (block bursts, frenzy, level-ups). Both
 * renderers (3D and flat 2D) draw this same model, so the two drafts behave identically.
 *
 * World units: metres on the ground plane (x, z), centre of the horde at the origin.
 */
import { hordeRoster, type HordeRoster } from "@indoor-bike/game-core/horde";

export const ARENA = {
  /** Lanes of the riders' ring. */
  lanes: [21, 23.5, 26],
  /** Barrier between the horde and the ring. */
  barrier: 17,
  /** Outer edge of the ground. */
  edge: 31,
} as const;

/** Ring colours (index = HordeRider.color). */
export const RIDER_COLORS = [
  "#3ef0a0", "#ff4fd8", "#ffb347", "#59c3ff", "#c18cff", "#ff6b6b",
  "#f4f46a", "#4dffea", "#ff9a3d", "#9dff5c", "#ff7ab8", "#8ab4ff",
];
export const SWEAT_COLOR = "#7fd8ff";

export interface RiderView {
  id: string;
  name: string;
  color: number;
  me: boolean;
  bot: boolean;
  intensity: number;
  rate: number;
  multiplier: number;
  onTarget: boolean;
  paused: boolean;
}

export interface ArenaRider extends RiderView {
  angle: number;
  radius: number;
  x: number;
  z: number;
  /** 0 … 1 fade in/out. */
  presence: number;
  leaving: boolean;
  dropClock: number;
  /** Last burst (for the renderer's glow): seconds since, and whether it was a hit. */
  burst: number;
  burstHit: boolean;
}

export type ZombieKind = "walker" | "brute" | "wraith";

export interface Zombie {
  kind: ZombieKind;
  /** Home radius as a share of the horde radius, and current polar position. */
  home: number;
  r: number;
  a: number;
  /** Angular wander speed (rad/s), bob phase, "just ate" glow 0…1. */
  wander: number;
  phase: number;
  fed: number;
  x: number;
  z: number;
  /** Facing (rad). */
  heading: number;
  /** 0 … 1 while appearing. */
  grow: number;
}

export interface Drop {
  fromX: number;
  fromZ: number;
  target: Zombie;
  t: number;
  duration: number;
  size: number;
  /** Current position (y: height for the 3D view). */
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface Shockwave {
  x: number;
  z: number;
  t: number;
  duration: number;
  maxRadius: number;
  color: string;
}

const MAX_DROPS = 600;

export class ArenaSim {
  readonly riders = new Map<string, ArenaRider>();
  readonly zombies: Zombie[] = [];
  drops: Drop[] = [];
  waves: Shockwave[] = [];
  level = 1;
  roster: HordeRoster = hordeRoster(1);
  /** 0 (starving, pushing at the barrier) … 1 (fed and calm), eased. */
  calm = 0.5;
  frenzy = false;
  /** Seconds since the last level-up (for the giant's roar etc.). */
  sinceLevelUp = 99;
  time = 0;

  get hordeRadius() {
    return Math.min(ARENA.barrier - 3, 6 + this.level * 0.7);
  }

  /** Update the horde size; new creatures crawl out of the ground. */
  setLevel(level: number) {
    if (!Number.isFinite(level) || level < 1) return; // not synced yet
    if (level !== this.level) this.sinceLevelUp = 0;
    this.level = level;
    this.roster = hordeRoster(level);
    const want: [ZombieKind, number][] = [
      ["walker", this.roster.walkers],
      ["brute", this.roster.brutes],
      ["wraith", this.roster.wraiths],
    ];
    for (const [kind, n] of want) {
      const have = this.zombies.filter((z) => z.kind === kind).length;
      for (let i = have; i < n; i++) this.zombies.push(this.spawnZombie(kind));
    }
  }

  private spawnZombie(kind: ZombieKind): Zombie {
    const home = Math.sqrt(Math.random()) * (kind === "brute" ? 0.8 : 1);
    const a = Math.random() * Math.PI * 2;
    return {
      kind,
      home,
      r: home * this.hordeRadius,
      a,
      wander: (Math.random() - 0.5) * (kind === "wraith" ? 0.35 : 0.12),
      phase: Math.random() * Math.PI * 2,
      fed: 0,
      x: 0,
      z: 0,
      heading: a,
      grow: 0,
    };
  }

  /** Sync the riders shown on the ring (only active ones). */
  setRiders(views: RiderView[]) {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      const r = this.riders.get(v.id);
      if (r) {
        Object.assign(r, v, { intensity: v.intensity || 0, rate: v.rate || 0, multiplier: v.multiplier || 1 });
        r.leaving = false;
      } else {
        const lane = ARENA.lanes[v.color % ARENA.lanes.length]!;
        const angle = Math.random() * Math.PI * 2;
        this.riders.set(v.id, {
          ...v,
          angle,
          radius: lane,
          x: Math.cos(angle) * lane,
          z: Math.sin(angle) * lane,
          presence: 0,
          leaving: false,
          dropClock: 0,
          burst: 99,
          burstHit: false,
        });
      }
    }
    for (const r of this.riders.values()) if (!seen.has(r.id)) r.leaving = true;
  }

  burst(riderId: string, hit: boolean) {
    const r = this.riders.get(riderId);
    if (!r) return;
    r.burst = 0;
    r.burstHit = hit;
    this.waves.push({ x: r.x, z: r.z, t: 0, duration: hit ? 1.2 : 0.7, maxRadius: hit ? 6 : 3, color: hit ? "#ffd84a" : "#7a8494" });
  }

  levelUp() {
    this.waves.push({ x: 0, z: 0, t: 0, duration: 2.5, maxRadius: ARENA.edge, color: "#b6ff5c" });
  }

  /** `totalRate`: everyone's sweat per second (sets how calm the horde is). */
  update(dt: number, totalRate: number) {
    // Values come straight from the synced state, which can be incomplete for a moment: never let NaN in, it sticks.
    if (!Number.isFinite(totalRate)) totalRate = 0;
    this.time += dt;
    this.sinceLevelUp += dt;
    // About 12 sweat/s (a few riders around threshold) keeps them fully calm.
    const calmTarget = Math.min(1, totalRate / 12) * (this.frenzy ? 1 : 0.9);
    this.calm += (calmTarget - this.calm) * (1 - Math.exp(-dt / 4));

    this.updateRiders(dt);
    this.updateZombies(dt);
    this.updateDrops(dt);
    for (const w of this.waves) w.t += dt;
    this.waves = this.waves.filter((w) => w.t < w.duration);
  }

  private updateRiders(dt: number) {
    for (const r of [...this.riders.values()]) {
      r.presence = Math.max(0, Math.min(1, r.presence + (r.leaving ? -dt : dt) / 1.2));
      if (r.leaving && r.presence <= 0) {
        this.riders.delete(r.id);
        continue;
      }
      r.burst += dt;
      // Laps: harder riding, faster laps (about 45 s per lap at FTP).
      const speed = r.paused ? 0 : 0.02 + Math.min(2, r.intensity) * 0.12;
      r.angle = (r.angle + speed * dt) % (Math.PI * 2);
      r.x = Math.cos(r.angle) * r.radius;
      r.z = Math.sin(r.angle) * r.radius;
      if (r.paused || r.leaving || r.rate <= 0 || this.zombies.length === 0) continue;
      // Drops per second follow the sweat rate; bigger with a multiplier.
      const perSecond = Math.min(16, 1.5 + r.rate * 1.4);
      r.dropClock += dt * perSecond;
      while (r.dropClock >= 1) {
        r.dropClock -= 1;
        this.spawnDrop(r);
      }
    }
  }

  private spawnDrop(r: ArenaRider) {
    if (this.drops.length >= MAX_DROPS) return;
    const target = this.zombies[Math.floor(Math.random() * this.zombies.length)]!;
    this.drops.push({
      fromX: r.x,
      fromZ: r.z,
      target,
      t: 0,
      duration: 1.1 + Math.random() * 0.6,
      size: 0.3 + 0.08 * r.multiplier + (this.frenzy ? 0.1 : 0),
      x: r.x,
      y: 1,
      z: r.z,
      color: this.frenzy ? "#ff5a7a" : r.multiplier >= 2 ? "#ffd84a" : SWEAT_COLOR,
    });
  }

  private updateZombies(dt: number) {
    const hunger = 1 - this.calm;
    const R = this.hordeRadius;
    const nearest = [...this.riders.values()];
    for (const z of this.zombies) {
      z.grow = Math.min(1, z.grow + dt / 2);
      z.fed = Math.max(0, z.fed - dt * 1.5);
      z.phase += dt * (z.kind === "wraith" ? 1.5 : 3 + hunger * 4 + (this.frenzy ? 4 : 0));
      // Hungry: they shamble outwards, towards the barrier and the riders behind it.
      const reach = z.kind === "wraith" ? 1.1 : 1;
      const want = Math.min(ARENA.barrier - 1, z.home * R * reach + hunger * (ARENA.barrier - 1.5 - z.home * R) * 0.5);
      z.r += (want - z.r) * (1 - Math.exp(-dt / 3));
      z.a += z.wander * dt * (1 + hunger);
      const px = z.x;
      const pz = z.z;
      z.x = Math.cos(z.a) * z.r;
      z.z = Math.sin(z.a) * z.r;
      // Face the nearest rider when hungry, otherwise where they shamble.
      let face = Math.atan2(z.z - pz, z.x - px);
      if (hunger > 0.4 && nearest.length) {
        let best = nearest[0]!;
        let bd = Infinity;
        for (const r of nearest) {
          const d = (r.x - z.x) ** 2 + (r.z - z.z) ** 2;
          if (d < bd) {
            bd = d;
            best = r;
          }
        }
        face = Math.atan2(best.z - z.z, best.x - z.x);
      }
      if (Number.isFinite(face)) z.heading += angleDiff(face, z.heading) * Math.min(1, dt * 2);
    }
  }

  private updateDrops(dt: number) {
    for (const d of this.drops) {
      d.t += dt;
      const k = Math.min(1, d.t / d.duration);
      const e = k * k * (3 - 2 * k);
      d.x = d.fromX + (d.target.x - d.fromX) * e;
      d.z = d.fromZ + (d.target.z - d.fromZ) * e;
      d.y = 1 + Math.sin(k * Math.PI) * 7;
      if (k >= 1) d.target.fed = 1;
    }
    this.drops = this.drops.filter((d) => d.t < d.duration);
  }
}

export function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
