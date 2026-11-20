/**
 * Draws the {@link ArenaSim} with three.js, in one of two styles (both drafts, switchable at runtime):
 *
 * - "3d": a tilted perspective camera slowly orbiting a moonlit graveyard arena. Low-poly undead (instanced), riders
 *   as glowing bikes on the ring, sweat drops arcing through the air into the horde, a glowing barrier.
 * - "2d": a flat top view with an orthographic camera: discs, triangles and rings, like a tactical map.
 *
 * Everything numerous (undead, drops, tombstones) is one InstancedMesh per shape; riders are a few small groups.
 * The renderer only reads the sim; it owns no game state.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Camera,
  type Material,
} from "three";
import { ARENA, RIDER_COLORS, type ArenaRider, type ArenaSim, type Zombie } from "./arenaSim.ts";

export type ArenaStyle = "3d" | "2d";

const MAX_ZOMBIES = 340;
const MAX_DROPS = 600;
const MAX_WAVES = 24;
const TOMBSTONES = 70;

const PALETTE = {
  "3d": { sky: "#090b10", ground: "#1b2027", pit: "#2a1f1a", track: "#232b36", lane: "#2f3a48" },
  "2d": { sky: "#0b0f14", ground: "#121821", pit: "#1d1714", track: "#1a222d", lane: "#2a3644" },
};
const ZOMBIE_SKIN = { walker: new Color("#6f8f5a"), brute: new Color("#8a6f52"), wraith: new Color("#a9c8ff") };
const FED = new Color("#7fd8ff");
const HUNGRY = new Color("#ff4a4a");
const CALM = new Color("#46ffb0");

const dummy = new Object3D();
const tmpColor = new Color();
const tmpV = new Vector3();

interface RiderMesh {
  group: Group;
  glow: Mesh;
  body: Material[];
}

export class ArenaRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  private camera: Camera;
  private readonly root = new Group();
  private readonly disposables: { dispose(): void }[] = [];
  private bodies!: InstancedMesh;
  private heads!: InstancedMesh;
  private wraiths!: InstancedMesh;
  private drops!: InstancedMesh;
  private waves: Mesh[] = [];
  private barrier!: Mesh;
  private barrierMat!: MeshBasicMaterial;
  private giant?: Group;
  private readonly riderMeshes = new Map<string, RiderMesh>();
  private orbit = 0.6;
  /** Screen area (CSS px) to centre the arena in; the rest is covered by panels. Default: the whole canvas. */
  focus?: { x: number; y: number; w: number; h: number };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly style: ArenaStyle,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    // Phones: cap the pixel ratio, the scene is busy enough.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia("(pointer: coarse)").matches ? 1.5 : 2));
    const p = PALETTE[style];
    this.scene.background = new Color(p.sky);
    this.scene.add(this.root);
    if (style === "3d") {
      this.scene.fog = new Fog(p.sky, 60, 120);
      this.scene.add(new HemisphereLight("#a8b8ff", "#2a1f1a", 1.4));
      const moon = new DirectionalLight("#cfd8ff", 1.6);
      moon.position.set(-20, 40, 15);
      this.scene.add(moon);
      this.camera = new PerspectiveCamera(42, 1, 1, 200);
    } else {
      const cam = new OrthographicCamera(-1, 1, 1, -1, 1, 200);
      cam.position.set(0, 100, 0);
      cam.up.set(0, 0, -1);
      cam.lookAt(0, 0, 0);
      this.camera = cam;
    }
    this.buildGround();
    this.buildHorde();
    this.buildDrops();
    this.buildWaves();
  }

  // --- building -----------------------------------------------------------------------------

  private own<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private flat(color: string, opts: Partial<MeshBasicMaterial> = {}) {
    return this.own(new MeshBasicMaterial({ color, side: DoubleSide, ...opts }));
  }

  private lit(color: string) {
    return this.own(new MeshLambertMaterial({ color, flatShading: true }));
  }

  /** A disc or ring lying on the ground at height y. */
  private floor(geometry: BufferGeometry, material: Material, y: number) {
    const mesh = new Mesh(this.own(geometry), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    this.root.add(mesh);
    return mesh;
  }

  private buildGround() {
    const p = PALETTE[this.style];
    const three = this.style === "3d";
    const mat = (c: string) => (three ? this.lit(c) : this.flat(c));
    this.floor(new CircleGeometry(three ? 120 : ARENA.edge, 64), mat(p.ground), -0.05);
    this.floor(new CircleGeometry(ARENA.barrier, 64), mat(p.pit), 0);
    const inner = ARENA.lanes[0] - 1.6;
    const outer = ARENA.lanes[ARENA.lanes.length - 1]! + 1.6;
    this.floor(new RingGeometry(inner, outer, 96), mat(p.track), 0.01);
    for (const r of [inner + 0.05, outer - 0.05, ...ARENA.lanes.slice(0, -1).map((l, i) => (l + ARENA.lanes[i + 1]!) / 2)]) {
      this.floor(new RingGeometry(r - 0.06, r + 0.06, 96), this.flat(p.lane), 0.02);
    }

    // Barrier: a glowing wall (3D) or ring (2D), coloured by how calm the horde is.
    this.barrierMat = this.flat("#46ffb0", { transparent: true, opacity: three ? 0.28 : 0.8, blending: AdditiveBlending, depthWrite: false });
    if (three) {
      this.barrier = new Mesh(this.own(new CylinderGeometry(ARENA.barrier, ARENA.barrier, 2.4, 96, 1, true)), this.barrierMat);
      this.barrier.position.y = 1.2;
      this.root.add(this.barrier);
      // Posts around the barrier.
      const posts = new InstancedMesh(this.own(new BoxGeometry(0.35, 3, 0.35)), this.lit("#3a3f48"), 36);
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        dummy.position.set(Math.cos(a) * ARENA.barrier, 1.5, Math.sin(a) * ARENA.barrier);
        dummy.rotation.set(0, -a, 0);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
      }
      this.root.add(posts);
    } else {
      this.barrier = this.floor(new RingGeometry(ARENA.barrier - 0.35, ARENA.barrier + 0.35, 96), this.barrierMat, 0.03);
    }

    // Tombstones and dead trees outside the ring.
    const stones = new InstancedMesh(
      this.own(three ? new BoxGeometry(0.9, 1.4, 0.3) : new BoxGeometry(0.9, 0.05, 0.5)),
      three ? this.lit("#5b6270") : this.flat("#2d3540"),
      TOMBSTONES,
    );
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < TOMBSTONES; i++) {
      const a = rand() * Math.PI * 2;
      const r = outer + 1.5 + rand() * (three ? 14 : ARENA.edge - outer - 2);
      dummy.position.set(Math.cos(a) * r, three ? 0.6 : 0.03, Math.sin(a) * r);
      dummy.rotation.set(three ? (rand() - 0.5) * 0.3 : 0, rand() * Math.PI, three ? (rand() - 0.5) * 0.3 : 0);
      dummy.scale.setScalar(0.7 + rand() * 0.6);
      dummy.updateMatrix();
      stones.setMatrixAt(i, dummy.matrix);
    }
    this.root.add(stones);
    if (three) {
      const trees = new InstancedMesh(this.own(new ConeGeometry(0.25, 5, 5)), this.lit("#2b2420"), 18);
      for (let i = 0; i < 18; i++) {
        const a = rand() * Math.PI * 2;
        const r = outer + 6 + rand() * 12;
        dummy.position.set(Math.cos(a) * r, 2.5, Math.sin(a) * r);
        dummy.rotation.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        trees.setMatrixAt(i, dummy.matrix);
      }
      this.root.add(trees);
    }
  }

  private buildHorde() {
    const three = this.style === "3d";
    if (three) {
      this.bodies = new InstancedMesh(this.own(new CylinderGeometry(0.32, 0.42, 1.4, 6)), this.lit("#ffffff"), MAX_ZOMBIES);
      this.heads = new InstancedMesh(this.own(new IcosahedronGeometry(0.3, 0)), this.lit("#ffffff"), MAX_ZOMBIES);
      this.wraiths = new InstancedMesh(
        this.own(new ConeGeometry(0.5, 1.8, 6)),
        this.own(new MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, emissive: "#3050a0" })),
        MAX_ZOMBIES,
      );
    } else {
      this.bodies = new InstancedMesh(this.own(new CircleGeometry(0.45, 10)), this.flat("#ffffff"), MAX_ZOMBIES);
      this.heads = new InstancedMesh(this.own(new CircleGeometry(0.2, 8)), this.flat("#ffffff"), MAX_ZOMBIES);
      this.wraiths = new InstancedMesh(this.own(new CircleGeometry(0.55, 3)), this.flat("#ffffff", { transparent: true, opacity: 0.6 }), MAX_ZOMBIES);
    }
    for (const mesh of [this.bodies, this.heads, this.wraiths]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
  }

  private buildGiant() {
    const g = new Group();
    if (this.style === "3d") {
      const skin = this.lit("#4d6b3f");
      const body = new Mesh(this.own(new CylinderGeometry(1.6, 2.2, 6, 7)), skin);
      body.position.y = 3;
      const head = new Mesh(this.own(new IcosahedronGeometry(1.3, 0)), skin);
      head.position.y = 7;
      const eyeMat = this.flat("#ff3030");
      for (const s of [-0.45, 0.45]) {
        const eye = new Mesh(this.own(new IcosahedronGeometry(0.2, 0)), eyeMat);
        eye.position.set(1.1, 7.2, s);
        g.add(eye);
      }
      g.add(body, head);
    } else {
      const body = this.floor(new CircleGeometry(2.4, 7), this.flat("#4d6b3f"), 0.2);
      this.root.remove(body);
      g.add(body);
    }
    this.root.add(g);
    this.giant = g;
  }

  private buildDrops() {
    const geo = this.style === "3d" ? new IcosahedronGeometry(1, 0) : new CircleGeometry(1, 8);
    this.drops = new InstancedMesh(this.own(geo), this.flat("#ffffff", { transparent: true, opacity: 0.9, depthWrite: false }), MAX_DROPS);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.root.add(this.drops);
  }

  private buildWaves() {
    const geo = this.own(new RingGeometry(0.9, 1, 64));
    for (let i = 0; i < MAX_WAVES; i++) {
      const mesh = new Mesh(geo, this.flat("#ffffff", { transparent: true, blending: AdditiveBlending, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.15;
      mesh.visible = false;
      this.root.add(mesh);
      this.waves.push(mesh);
    }
  }

  private riderMesh(r: ArenaRider): RiderMesh {
    let m = this.riderMeshes.get(r.id);
    if (m) return m;
    const color = RIDER_COLORS[r.color % RIDER_COLORS.length]!;
    const group = new Group();
    const body: Material[] = [];
    const glowMat = this.flat(color, { transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false });
    const glow = new Mesh(this.own(new CircleGeometry(r.me ? 2.2 : 1.6, 32)), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.05;
    group.add(glow);
    if (this.style === "3d") {
      const frameMat = this.own(new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
      const dark = this.lit("#1a1a1a");
      const frame = new Mesh(this.own(new BoxGeometry(1.6, 0.18, 0.12)), frameMat);
      frame.position.y = 0.75;
      const wheelGeo = this.own(new TorusGeometry(0.42, 0.07, 6, 16));
      for (const x of [-0.75, 0.75]) {
        const w = new Mesh(wheelGeo, dark);
        w.position.set(x, 0.45, 0);
        group.add(w);
      }
      const torso = new Mesh(this.own(new CylinderGeometry(0.2, 0.26, 0.9, 6)), frameMat);
      torso.position.set(0.05, 1.35, 0);
      torso.rotation.z = -0.9;
      const head = new Mesh(this.own(new IcosahedronGeometry(0.24, 0)), frameMat);
      head.position.set(0.5, 1.7, 0);
      group.add(frame, torso, head);
      body.push(frameMat);
    } else {
      const mat = this.flat(color);
      const tri = new Mesh(this.own(new CircleGeometry(r.me ? 1.2 : 0.95, 3)), mat);
      tri.rotation.x = -Math.PI / 2;
      tri.position.y = 0.3;
      group.add(tri);
      body.push(mat);
    }
    this.root.add(group);
    m = { group, glow, body };
    this.riderMeshes.set(r.id, m);
    return m;
  }

  // --- frame --------------------------------------------------------------------------------

  render(sim: ArenaSim, dt: number) {
    this.resize();
    const three = this.style === "3d";

    // Camera
    if (three) {
      this.orbit += dt * 0.025;
      const cam = this.camera as PerspectiveCamera;
      const shake = sim.frenzy ? 0.15 : 0;
      // Far enough back that the ring fits the free area (horizontally the full width, vertically foreshortened).
      const { fw, fh } = this.freeSize();
      const H = this.canvas.clientHeight || 1;
      const dist = Math.max(70 * (H / fw), 50 * (H / fh), 45);
      cam.position.set(
        Math.cos(this.orbit) * dist * 0.72 + (Math.random() - 0.5) * shake,
        dist * 0.62,
        Math.sin(this.orbit) * dist * 0.72 + (Math.random() - 0.5) * shake,
      );
      cam.lookAt(0, 0, 0);
    }

    // Barrier: red and flickering when they're hungry, green when fed, pulsing in a frenzy.
    tmpColor.copy(HUNGRY).lerp(CALM, sim.calm);
    if (sim.frenzy) tmpColor.lerp(new Color("#ff4fd8"), 0.5 + 0.5 * Math.sin(sim.time * 10));
    this.barrierMat.color.copy(tmpColor);
    this.barrierMat.opacity = (three ? 0.18 : 0.55) + 0.25 * (1 - sim.calm) * (0.5 + 0.5 * Math.sin(sim.time * 6));

    this.renderHorde(sim);
    this.renderRiders(sim);
    this.renderDrops(sim);
    this.renderWaves(sim);
    this.renderer.render(this.scene, this.camera);
  }

  private renderHorde(sim: ArenaSim) {
    const three = this.style === "3d";
    let nb = 0;
    let nw = 0;
    const hunger = 1 - sim.calm;
    const place = (mesh: InstancedMesh, i: number, z: Zombie, y: number, scale: number, color: Color, forward = 0) => {
      dummy.position.set(z.x + Math.cos(z.heading) * forward, y, z.z + Math.sin(z.heading) * forward);
      // 3D: lean forward (more when hungry) and sway. Flat: the disc (built in XY) laid on the ground.
      if (three) dummy.rotation.set(Math.sin(z.phase) * 0.12, -z.heading, 0.15 + hunger * 0.25);
      else dummy.rotation.set(-Math.PI / 2, 0, -z.heading);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color);
    };
    for (const z of sim.zombies) {
      const grow = z.grow;
      const big = z.kind === "brute" ? 1.7 : 1;
      tmpColor.copy(ZOMBIE_SKIN[z.kind]).lerp(FED, z.fed * 0.8);
      if (sim.frenzy && z.kind !== "wraith") tmpColor.lerp(HUNGRY, 0.25);
      if (z.kind === "wraith") {
        if (nw >= MAX_ZOMBIES) continue;
        const y = three ? 2.2 + Math.sin(z.phase) * 0.6 : 0.4;
        place(this.wraiths, nw++, z, y, grow, tmpColor);
        continue;
      }
      if (nb >= MAX_ZOMBIES) continue;
      const bob = Math.abs(Math.sin(z.phase)) * 0.15;
      const s = big * grow * (1 + z.fed * 0.15) * (three ? 1 : 1.25);
      if (three) {
        place(this.bodies, nb, z, (0.7 + bob) * s, s, tmpColor);
        place(this.heads, nb, z, (1.65 + bob) * s, s, tmpColor, 0.12 * s);
      } else {
        place(this.bodies, nb, z, 0.1, s, tmpColor);
        tmpColor.multiplyScalar(1.25);
        place(this.heads, nb, z, 0.12, s, tmpColor, 0.38 * s);
      }
      nb++;
    }
    this.bodies.count = this.heads.count = nb;
    this.wraiths.count = nw;
    for (const mesh of [this.bodies, this.heads, this.wraiths]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    if (sim.roster.giant && !this.giant) this.buildGiant();
    if (this.giant) {
      const roar = Math.max(0, 1 - sim.sinceLevelUp / 2);
      this.giant.rotation.y = -sim.time * 0.1;
      this.giant.scale.setScalar(1 + roar * 0.2 + Math.sin(sim.time * 1.3) * 0.03);
    }
  }

  private renderRiders(sim: ArenaSim) {
    for (const [id, m] of this.riderMeshes) {
      if (!sim.riders.has(id)) {
        this.root.remove(m.group);
        this.riderMeshes.delete(id);
      }
    }
    for (const r of sim.riders.values()) {
      const m = this.riderMesh(r);
      m.group.position.set(r.x, 0, r.z);
      // Facing along the ring (counter-clockwise as seen from above).
      m.group.rotation.y = -(r.angle + Math.PI / 2);
      const pulse = r.burst < 1 ? 1 + (1 - r.burst) * (r.burstHit ? 1.5 : 0.5) : 1;
      const onTarget = r.onTarget ? 0.15 * Math.sin(sim.time * 8) : 0;
      m.glow.scale.setScalar(pulse + onTarget);
      const glowMat = m.glow.material as MeshBasicMaterial;
      glowMat.opacity = (r.paused ? 0.1 : 0.25 + Math.min(0.4, r.intensity * 0.3)) * r.presence;
      if (r.burst < 1 && r.burstHit) glowMat.color.set("#ffd84a");
      else glowMat.color.set(RIDER_COLORS[r.color % RIDER_COLORS.length]!);
      m.group.scale.setScalar((0.2 + 0.8 * r.presence) * (this.style === "3d" ? 1.6 : 1.2));
    }
  }

  private renderDrops(sim: ArenaSim) {
    const three = this.style === "3d";
    let n = 0;
    for (const d of sim.drops) {
      if (n >= MAX_DROPS) break;
      dummy.position.set(d.x, three ? d.y : 0.5, d.z);
      dummy.rotation.set(three ? 0 : -Math.PI / 2, 0, 0);
      dummy.scale.setScalar(d.size);
      dummy.updateMatrix();
      this.drops.setMatrixAt(n, dummy.matrix);
      this.drops.setColorAt(n, tmpColor.set(d.color));
      n++;
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
    if (this.drops.instanceColor) this.drops.instanceColor.needsUpdate = true;
  }

  private renderWaves(sim: ArenaSim) {
    this.waves.forEach((mesh, i) => {
      const w = sim.waves[i];
      mesh.visible = !!w;
      if (!w) return;
      const k = w.t / w.duration;
      mesh.position.set(w.x, 0.15, w.z);
      mesh.scale.setScalar(0.5 + k * w.maxRadius);
      const mat = mesh.material as MeshBasicMaterial;
      mat.color.set(w.color);
      mat.opacity = 1 - k;
    });
  }

  /** Screen position (CSS px) of a world point, for HTML labels; undefined when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | undefined {
    tmpV.set(x, this.style === "3d" ? y : 0, z).project(this.camera);
    if (tmpV.z > 1) return undefined;
    return { x: ((tmpV.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - tmpV.y) / 2) * this.canvas.clientHeight };
  }

  private freeSize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const f = this.focus ?? { x: 0, y: 0, w, h };
    return { fw: Math.max(100, f.w), fh: Math.max(100, f.h), cx: f.x + f.w / 2, cy: f.y + f.h / 2 };
  }

  private resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const ratio = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.round(w * ratio) || this.canvas.height !== Math.round(h * ratio)) this.renderer.setSize(w, h, false);
    const { fw, fh, cx, cy } = this.freeSize();
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = w / h;
      // Shift the picture so the arena's centre lands in the middle of the free area.
      this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
      this.camera.updateProjectionMatrix();
    } else if (this.camera instanceof OrthographicCamera) {
      // The whole ring fits the free area, centred in it.
      const size = (ARENA.lanes[ARENA.lanes.length - 1]! + 3) * 2;
      const unitsPerPx = size / Math.min(fw, fh);
      this.camera.left = -cx * unitsPerPx;
      this.camera.right = (w - cx) * unitsPerPx;
      this.camera.top = cy * unitsPerPx;
      this.camera.bottom = -(h - cy) * unitsPerPx;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}
