/**
 * Draws a `CityWorld` (the simulation from @indoor-bike/game-core) on a 2D canvas. The renderer owns only view
 * state (the camera); replacing it with a game-engine scene does not touch the simulation.
 */
import { BLOCK, hash, STREET, type CityWorld, type Pt } from "@indoor-bike/game-core/zombie-ramp";

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

export class CityCanvasRenderer {
  private camX = 0;
  private camY = 0;
  private placed = false;

  /** Jump the camera to the rider on the next frame (after switching to a new world). */
  reset(): void {
    this.placed = false;
  }

  draw(ctx: CanvasRenderingContext2D, world: CityWorld, w: number, h: number, c: Colors, danger: number): void {
    const me = world.route.at(world.s);
    if (!this.placed) {
      this.camX = me.x;
      this.camY = me.y;
      this.placed = true;
    }
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
    line(world.route.polyline(world.s, world.s + 220), c.route, 2.2, [4, 4]);
    line(world.route.polyline(world.s - 45, world.s), "rgba(64,224,208,0.45)", 1.8);

    // Wanderers
    for (const z of world.wanderers) this.dot(ctx, z.x, z.y, 1.7, c.zombie, 0.55);
    // Horde
    for (const z of world.horde) this.dot(ctx, z.x, z.y, 2, c.zombie, 0.95, 6);

    // Player
    const pulse = 1 + Math.sin(world.time * 6) * 0.08;
    ctx.shadowColor = c.player;
    ctx.shadowBlur = 18;
    this.dot(ctx, me.x, me.y, 3 * pulse, c.player, 1);
    ctx.shadowBlur = 0;
    ctx.restore();

    // Red vignette when the horde is close
    if (danger > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, "rgba(255,0,0,0)");
      g.addColorStop(1, `rgba(255,30,30,${(0.15 + 0.25 * Math.abs(Math.sin(world.time * 5))) * danger})`);
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
