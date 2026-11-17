/**
 * The 3D view of the 20-minute FTP test: a third-person camera behind a stylised cyclist on a straight road that runs
 * into the distance, like an endless runner (no jumping, no lane changes). The rider stays at the origin facing -z;
 * the world moves past. Scenery objects stream in at the far end of the road and are recycled once they are
 * behind the camera, so a ride of any length uses the same fixed pool of instances.
 *
 * Look: flat colours, flat-shaded low-poly primitives, fog for depth, no textures. Performance on phones:
 * every scenery primitive is drawn with one InstancedMesh per geometry (a handful of draw calls in total),
 * objects only get new matrices when they are recycled (the world moves as one group), and the pixel ratio is capped.
 *
 * Changing the scenery blends sky, fog, road and distant hills over a few seconds; new ground tiles and objects
 * take the new look as they stream in from the horizon.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from "three";
import { rng, sceneryAt, type Geo, type Palette, type Part, type Scenery } from "./scenery.ts";

const ROAD_HALF = 3.5;
/** Ground strips: next to the road (sidewalk, verge, sand) and beyond. */
const NEAR_W = 10;
const FAR_W = 300;
const TILE = 20;
const TILES = 14;
/** Metres behind the rider an object may be before it is recycled to the far end. */
const BEHIND = 14;
const NEAR_SLOTS = 40;
const NEAR_SPACING = 6.5;
const FAR_SLOTS = 22;
const FAR_SPACING = 12;
const STRIPES = 34;
const STRIPE_SPACING = 8;
/** Seconds a scenery change takes to blend sky, fog, road and hills. */
const BLEND_SECONDS = 6;

const CAPACITY: Record<Geo, number> = { box: 1400, cone: 500, cyl: 700, ico: 400, pyr: 120, ball: 160 };

type GroundKey = "nearL" | "farL" | "nearR" | "farR";

interface Slot {
  /** Distance along the road, metres. */
  d: number;
  side: "L" | "R";
  far: boolean;
  /** Allocated instances: [geometry, index]. */
  parts: [Geo, number][];
}

const tmpM = new Matrix4();
const tmpP = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpV = new Vector3();
const tmpS = new Vector3();
const tmpSize = new Vector2();
const UP = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);

export class RunnerScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, 1, 0.1, 1200);
  /** Everything that moves past: ground tiles, stripes, objects. Shifted by the distance ridden. */
  private readonly world = new Group();
  private readonly meshes: Record<Geo, InstancedMesh>;
  private readonly free: Record<Geo, number[]>;
  private readonly slots: Slot[] = [];
  private readonly tiles: InstancedMesh;
  private readonly tileD: number[] = [];
  private readonly stripes: InstancedMesh;
  private readonly roadMat = new MeshLambertMaterial({ color: 0x444444 });
  private readonly edgeMat = new MeshLambertMaterial({ color: 0xffffff });
  private readonly stripeMat = new MeshLambertMaterial({ color: 0xffffff });
  private readonly baseMat = new MeshLambertMaterial({ color: 0x777777 });
  private readonly hills: InstancedMesh;
  private readonly hillBase: { x: number; z: number; w: number; h: number; r: number }[] = [];
  private readonly skyline: InstancedMesh;
  private readonly skylineBase: { x: number; z: number; w: number; h: number }[] = [];
  private readonly sky: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly hemi = new HemisphereLight(0xffffff, 0x666666, 1.6);
  private readonly fog = new Fog(0xffffff, 70, 250);
  private readonly rider: ReturnType<typeof buildRider>;

  /** Distance ridden, metres. */
  private s = 0;
  private rnd = rng(1);
  private from: Palette = sceneryAt(0).palette;
  private to: Palette = sceneryAt(0).palette;
  private blend = 1;
  private current: Scenery = sceneryAt(0);
  /** Current blended colours (cached per frame). */
  private readonly col: Record<GroundKey, Color> = { nearL: new Color(), farL: new Color(), nearR: new Color(), farR: new Color() };
  private crank = 0;
  private time = 0;
  private dirty = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.scene.fog = this.fog;
    this.scene.add(this.hemi);
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(-6, 10, 4);
    this.scene.add(sun);

    // Sky dome with a vertical gradient (vertex colours), not affected by fog.
    const skyGeo = new SphereGeometry(900, 20, 12);
    skyGeo.setAttribute("color", new BufferAttribute(new Float32Array(skyGeo.attributes.position!.count * 3), 3));
    this.sky = new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    this.scene.add(this.sky);

    // A big ground plane under everything, in the far colour: fog fades it into the horizon.
    const base = new Mesh(new PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), this.baseMat);
    base.position.y = -0.05;
    this.scene.add(base);

    // Road (moves with the rider: it looks the same everywhere) and its edge lines.
    const road = new Mesh(new PlaneGeometry(ROAD_HALF * 2, 600).rotateX(-Math.PI / 2), this.roadMat);
    road.position.set(0, 0.01, -280);
    this.scene.add(road);
    for (const x of [-ROAD_HALF + 0.25, ROAD_HALF - 0.25]) {
      const edge = new Mesh(new PlaneGeometry(0.18, 600).rotateX(-Math.PI / 2), this.edgeMat);
      edge.position.set(x, 0.02, -280);
      this.scene.add(edge);
    }

    this.scene.add(this.world);
    // Ground tiles: 4 strips (near/far on each side) × TILES, recycled with the scenery's colours.
    const tileMat = new MeshLambertMaterial({ color: 0xffffff });
    this.tiles = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), tileMat, TILES * 4);
    this.world.add(this.tiles);
    this.stripes = new InstancedMesh(new PlaneGeometry(0.2, 3).rotateX(-Math.PI / 2), this.stripeMat, STRIPES);
    this.world.add(this.stripes);

    const geos: Record<Geo, BufferGeometry> = {
      box: new BoxGeometry(1, 1, 1),
      cone: new ConeGeometry(0.5, 1, 7),
      cyl: new CylinderGeometry(0.5, 0.5, 1, 7),
      ico: new IcosahedronGeometry(0.5, 0),
      pyr: new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
      ball: new IcosahedronGeometry(0.5, 1),
    };
    const propMat = new MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.meshes = {} as Record<Geo, InstancedMesh>;
    this.free = {} as Record<Geo, number[]>;
    for (const g of Object.keys(geos) as Geo[]) {
      const m = new InstancedMesh(geos[g], propMat, CAPACITY[g]);
      m.frustumCulled = false; // instances spread along the whole road; the bounding sphere would be stale
      for (let i = 0; i < CAPACITY[g]; i++) {
        m.setMatrixAt(i, ZERO);
        m.setColorAt(i, new Color(0xffffff));
      }
      this.meshes[g] = m;
      this.free[g] = Array.from({ length: CAPACITY[g] }, (_, i) => CAPACITY[g] - 1 - i);
      this.world.add(m);
    }
    this.tiles.frustumCulled = false;
    this.stripes.frustumCulled = false;

    // Distant hills and skyline: far away, not moving (infinitely far), their height blends between sceneries.
    const r = rng(7);
    this.hills = new InstancedMesh(new ConeGeometry(1, 1, 6), new MeshBasicMaterial({ color: 0x88aa88, fog: false }), 26);
    for (let i = 0; i < 26; i++) {
      this.hillBase.push({ x: -650 + i * 52 + r() * 30, z: -520 - r() * 120, w: 70 + r() * 90, h: 40 + r() * 70, r: r() * 3 });
    }
    this.skyline = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x8899aa, fog: false }), 48);
    for (let i = 0; i < 48; i++) {
      this.skylineBase.push({ x: -480 + i * 20 + r() * 8, z: -470 - r() * 60, w: 12 + r() * 14, h: 25 + r() * 90 });
    }
    this.hills.frustumCulled = false;
    this.skyline.frustumCulled = false;
    this.scene.add(this.hills, this.skyline);

    this.rider = buildRider();
    this.scene.add(this.rider.group);
    this.reset(1, 0);
  }

  get sceneryName(): string {
    return this.current.name;
  }

  /** Start over: a fresh world in scenery `index`. */
  reset(seed: number, index: number): void {
    this.rnd = rng(seed);
    this.s = 0;
    this.current = sceneryAt(index);
    this.from = this.to = this.current.palette;
    this.blend = 1;
    this.applyPalette();
    for (const slot of this.slots) this.freeSlot(slot);
    this.slots.length = 0;
    for (const side of ["L", "R"] as const) {
      for (let i = 0; i < NEAR_SLOTS; i++) this.slots.push({ d: -BEHIND + i * NEAR_SPACING, side, far: false, parts: [] });
      for (let i = 0; i < FAR_SLOTS; i++) this.slots.push({ d: -BEHIND + i * FAR_SPACING + (side === "L" ? 0 : FAR_SPACING / 2), side, far: true, parts: [] });
    }
    for (const slot of this.slots) this.spawn(slot);
    this.tileD.length = 0;
    for (let i = 0; i < TILES; i++) {
      this.tileD.push(-BEHIND - TILE + i * TILE);
      this.paintTile(i);
    }
    for (let i = 0; i < STRIPES; i++) {
      tmpM.makeTranslation(0, 0.02, -(-BEHIND + i * STRIPE_SPACING));
      this.stripes.setMatrixAt(i, tmpM);
    }
    this.stripes.instanceMatrix.needsUpdate = true;
    this.world.position.z = 0;
    this.dirty = true;
  }

  /** Blend to scenery `index`; objects and ground of the new scenery stream in from the horizon. */
  setScenery(index: number): void {
    const next = sceneryAt(index);
    if (next === this.current) return;
    this.from = this.blendedPalette();
    this.to = next.palette;
    this.current = next;
    this.blend = 0;
  }

  /**
   * Move on. `dt` real seconds (animation), `distance` metres ridden since the last call (game time),
   * `speed` m/s (wheels), `cadence` rpm (legs).
   */
  update(dt: number, distance: number, speed: number, cadence: number): void {
    this.time += dt;
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / BLEND_SECONDS);
      this.applyPalette();
    }
    this.s += Math.max(0, distance);
    this.world.position.z = this.s;

    // Recycle whatever fell behind the camera to the far end of the road.
    const nearSpan = NEAR_SLOTS * NEAR_SPACING;
    const farSpan = FAR_SLOTS * FAR_SPACING;
    for (const slot of this.slots) {
      while (slot.d - this.s < -BEHIND) {
        slot.d += slot.far ? farSpan : nearSpan;
        this.freeSlot(slot);
        this.spawn(slot);
      }
    }
    for (let i = 0; i < TILES; i++) {
      while (this.tileD[i]! + TILE - this.s < -BEHIND) {
        this.tileD[i]! += TILES * TILE;
        this.paintTile(i);
      }
    }
    // Stripes: only the dash pattern repeats, so shift them all by whole spacings.
    const base = Math.floor((this.s - BEHIND) / STRIPE_SPACING) * STRIPE_SPACING;
    for (let i = 0; i < STRIPES; i++) {
      tmpM.makeTranslation(0, 0.02, -(base + i * STRIPE_SPACING));
      this.stripes.setMatrixAt(i, tmpM);
    }
    this.stripes.instanceMatrix.needsUpdate = true;
    if (this.dirty) {
      for (const m of Object.values(this.meshes)) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      this.tiles.instanceMatrix.needsUpdate = true;
      if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
      this.dirty = false;
    }

    // Rider: wheels turn with the speed, legs with the cadence.
    this.rider.spin(speed * dt, (this.crank += (cadence / 60) * Math.PI * 2 * dt));
    const pulse = 0.28 + 0.08 * Math.sin(this.time * 3);
    this.rider.glow.material.opacity = pulse;

    // Camera: low behind the rider, a touch wider and lower as the speed rises; slight sway for life.
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const portrait = h > w;
    const fov = (portrait ? 74 : 60) + Math.min(8, speed * 0.35);
    if (Math.abs(this.camera.fov - fov) > 0.01 || this.camera.aspect !== w / h) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 2);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const sway = Math.sin(this.time * 0.7) * 0.15;
    this.camera.position.set(sway, portrait ? 2.6 : 2.3, portrait ? 5.6 : 4.8);
    this.camera.lookAt(sway * 0.3, 1.1, -10);
  }

  render(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    // Cap the pixel ratio: phones with 3× screens would otherwise render 9× the pixels for little visible gain.
    const ratio = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    const size = this.renderer.getSize(tmpSize);
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as Material | undefined)?.dispose?.();
    });
  }

  // --- internals -------------------------------------------------------------------------------

  /** Smoothstep of the blend: it starts and ends gently. */
  private get eased(): number {
    return this.blend * this.blend * (3 - 2 * this.blend);
  }

  /** The palette as it looks right now (mid-blend), to blend on from when the scenery changes again. */
  private blendedPalette(): Palette {
    const b = this.eased;
    const out = {} as Record<keyof Palette, number>;
    const c1 = new Color();
    const c2 = new Color();
    for (const k of Object.keys(this.to) as (keyof Palette)[]) {
      if (k === "hillHeight" || k === "skylineHeight") out[k] = this.from[k] + (this.to[k] - this.from[k]) * b;
      else out[k] = c1.setHex(this.from[k]).lerp(c2.setHex(this.to[k]), b).getHex();
    }
    return out as Palette;
  }

  private applyPalette(): void {
    const b = this.eased;
    const lerp = (k: keyof Palette) => new Color(this.from[k]).lerp(new Color(this.to[k]), b);
    const num = (k: "hillHeight" | "skylineHeight") => this.from[k] + (this.to[k] - this.from[k]) * b;
    const horizon = lerp("horizon");
    const zenith = lerp("zenith");
    this.scene.background = horizon;
    this.fog.color.copy(horizon);
    this.hemi.color.copy(zenith).lerp(new Color(0xffffff), 0.6);
    this.hemi.groundColor.copy(lerp("farL")).multiplyScalar(0.7);
    this.roadMat.color.copy(lerp("road"));
    this.edgeMat.color.copy(lerp("edge"));
    this.stripeMat.color.copy(lerp("stripe"));
    this.baseMat.color.copy(lerp("farL"));
    for (const k of ["nearL", "farL", "nearR", "farR"] as const) this.col[k].copy(lerp(k));
    (this.hills.material as MeshBasicMaterial).color.copy(lerp("hills")).lerp(horizon, 0.35);
    (this.skyline.material as MeshBasicMaterial).color.copy(lerp("skyline")).lerp(horizon, 0.3);

    // Sky gradient: horizon colour near the ground, zenith colour overhead.
    const pos = this.sky.geometry.attributes.position!;
    const colors = this.sky.geometry.attributes.color!;
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, Math.min(1, pos.getY(i) / 900));
      c.copy(horizon).lerp(zenith, Math.pow(t, 0.6));
      colors.setXYZ(i, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;

    const hh = num("hillHeight");
    this.hillBase.forEach((hb, i) => {
      const height = Math.max(0.01, hb.h * hh);
      tmpM.compose(tmpV.set(hb.x, height / 2 - 1, hb.z), tmpQ.setFromEuler(tmpE.set(0, hb.r, 0)), tmpS.set(hb.w, height, hb.w * 0.8));
      this.hills.setMatrixAt(i, tmpM);
    });
    this.hills.instanceMatrix.needsUpdate = true;
    const sh = num("skylineHeight");
    this.skylineBase.forEach((sb, i) => {
      const height = Math.max(0.01, sb.h * sh);
      tmpM.compose(tmpV.set(sb.x, height / 2 - 0.5, sb.z), tmpQ.identity(), tmpS.set(sb.w, height, sb.w));
      this.skyline.setMatrixAt(i, tmpM);
    });
    this.skyline.instanceMatrix.needsUpdate = true;
  }

  private paintTile(i: number): void {
    const d = this.tileD[i]!;
    const z = -(d + TILE / 2);
    const strips = [
      { x: -(ROAD_HALF + NEAR_W / 2), w: NEAR_W, c: this.col.nearL },
      { x: -(ROAD_HALF + NEAR_W + FAR_W / 2), w: FAR_W, c: this.col.farL },
      { x: ROAD_HALF + NEAR_W / 2, w: NEAR_W, c: this.col.nearR },
      { x: ROAD_HALF + NEAR_W + FAR_W / 2, w: FAR_W, c: this.col.farR },
    ];
    strips.forEach((st, k) => {
      // Tiles overlap a little so no seams show between them.
      tmpM.compose(tmpV.set(st.x, 0, z), tmpQ.identity(), tmpS.set(st.w, 1, TILE + 0.05));
      this.tiles.setMatrixAt(i * 4 + k, tmpM);
      this.tiles.setColorAt(i * 4 + k, st.c);
    });
    this.dirty = true;
  }

  private spawn(slot: Slot): void {
    const sc = this.current;
    const kinds = (slot.far ? sc.far : sc.near).filter((k) => !k.side || k.side === slot.side);
    if (!kinds.length || this.rnd() < (slot.far ? sc.farGap : sc.nearGap)) return;
    const total = kinds.reduce((a, k) => a + k.weight, 0);
    let pickW = this.rnd() * total;
    const kind = kinds.find((k) => (pickW -= k.weight) < 0) ?? kinds[0]!;
    const parts: Part[] = kind.build(this.rnd);
    const [x0, x1] = slot.far ? sc.farX : sc.nearX;
    const x = (x0 + this.rnd() * (x1 - x0)) * (slot.side === "L" ? -1 : 1);
    const z = -(slot.d + (this.rnd() - 0.5) * (slot.far ? FAR_SPACING : NEAR_SPACING) * 0.5);
    // Aligned objects (buildings, lamps, houses) turn their front (+z) towards the road; the rest at random.
    // (No mirroring with a negative scale: instanced meshes would then show their back faces.)
    const yaw = kind.aligned ? (slot.side === "L" ? Math.PI / 2 : -Math.PI / 2) : this.rnd() * Math.PI * 2;
    tmpP.compose(tmpV.set(x, 0, z), tmpQ.setFromEuler(tmpE.set(0, yaw, 0)), tmpS.set(1, 1, 1));
    const color = new Color();
    for (const p of parts) {
      const index = this.free[p.geo].pop();
      if (index === undefined) continue; // pool exhausted: skip the part rather than break the frame
      const r = p.rot ?? [0, 0, 0];
      tmpM.compose(tmpV.set(...p.pos), tmpQ.setFromEuler(tmpE.set(r[0], r[1], r[2])), tmpS.set(...p.scale));
      tmpM.premultiply(tmpP);
      this.meshes[p.geo].setMatrixAt(index, tmpM);
      this.meshes[p.geo].setColorAt(index, color.setHex(p.color));
      slot.parts.push([p.geo, index]);
    }
    this.dirty = true;
  }

  private freeSlot(slot: Slot): void {
    for (const [g, i] of slot.parts) {
      this.meshes[g].setMatrixAt(i, ZERO);
      this.free[g].push(i);
    }
    slot.parts.length = 0;
    this.dirty = true;
  }
}

// --- the rider -------------------------------------------------------------------------------------

const RIDER = { jersey: 0x40e0d0, shorts: 0x1d2530, skin: 0xf0c39a, frame: 0xf4f4f4, tyre: 0x15181c, helmet: 0xffffff };

/** A stylised cyclist built from primitives, facing -z, with turning wheels and pedalling legs. */
function buildRider() {
  const group = new Group();
  const mat = (color: number, emissive = 0) => new MeshLambertMaterial({ color, emissive, flatShading: true });
  const cyl = new CylinderGeometry(1, 1, 1, 8);
  const segment = (m: Mesh, a: Vector3, b: Vector3, radius: number) => {
    const dir = tmpV.copy(b).sub(a);
    const len = dir.length();
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    m.scale.set(radius, len, radius);
  };
  const part = (color: number, emissive = 0) => {
    const m = new Mesh(cyl, mat(color, emissive));
    group.add(m);
    return m;
  };
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

  // Wheels
  const wheels: Mesh[] = [];
  for (const z of [-0.55, 0.55]) {
    const w = new Mesh(new TorusGeometry(0.34, 0.045, 6, 20), mat(RIDER.tyre));
    w.rotation.y = Math.PI / 2;
    w.position.set(0, 0.36, z);
    const hub = new Mesh(new BoxGeometry(0.02, 0.62, 0.04), mat(0x9aa3ad));
    w.add(hub);
    const hub2 = hub.clone();
    hub2.rotation.z = Math.PI / 2;
    w.add(hub2);
    group.add(w);
    wheels.push(w);
  }
  // Frame
  const bb = v(0, 0.36, 0.05);
  const seat = v(0, 0.95, 0.22);
  const head = v(0, 0.92, -0.42);
  for (const [a, b] of [
    [bb, seat],
    [bb, head],
    [seat, head],
    [v(0, 0.36, 0.55), bb],
    [v(0, 0.36, 0.55), seat],
    [v(0, 0.36, -0.55), head],
  ] as const) {
    segment(part(RIDER.frame), a, b, 0.025);
  }
  const bar = part(0x2a2f36);
  bar.position.set(0, 0.98, -0.47);
  bar.rotation.z = Math.PI / 2;
  bar.scale.set(0.02, 0.42, 0.02);
  // Body: torso leaning forward, head with helmet, arms to the bar
  const hip = v(0, 1.0, 0.2);
  const shoulder = v(0, 1.38, -0.22);
  segment(part(RIDER.jersey, 0x0b3a36), hip, shoulder, 0.17);
  const headMesh = new Mesh(new SphereGeometry(0.12, 10, 8), mat(RIDER.skin));
  headMesh.position.set(0, 1.55, -0.32);
  group.add(headMesh);
  const helmet = new Mesh(new SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(RIDER.helmet, 0x0e5c55));
  helmet.position.set(0, 1.57, -0.31);
  helmet.rotation.x = -0.35;
  group.add(helmet);
  for (const x of [-0.17, 0.17]) segment(part(RIDER.jersey, 0x0b3a36), v(x, 1.36, -0.2), v(x * 1.05, 1.0, -0.47), 0.045);

  // Legs: thigh and shin to the pedals, knees found with two-bone IK in the side plane.
  const legs = [-0.11, 0.11].map((x) => ({ x, thigh: part(RIDER.shorts), shin: part(RIDER.skin), foot: part(0x22272e) }));
  const L1 = 0.46;
  const L2 = 0.46;
  const crankR = 0.17;
  const hipL = new Vector3();
  const foot = new Vector3();
  const knee = new Vector3();
  const u = new Vector3();
  const setLegs = (angle: number) => {
    legs.forEach((leg, i) => {
      const a = angle + i * Math.PI;
      hipL.set(leg.x, hip.y, hip.z);
      foot.set(leg.x * 1.4, bb.y + Math.cos(a) * crankR, bb.z - Math.sin(a) * crankR);
      const dist = Math.min(L1 + L2 - 1e-3, hipL.distanceTo(foot));
      u.copy(foot).sub(hipL).normalize();
      const along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
      // Perpendicular to the leg in the side (y/z) plane, pointing forward (-z): the knee bends forwards.
      knee.copy(hipL).addScaledVector(u, along).add(tmpS.set(0, -u.z, u.y).multiplyScalar(h));
      segment(leg.thigh, hipL, knee, 0.07);
      segment(leg.shin, knee, foot, 0.05);
      leg.foot.position.copy(foot);
      leg.foot.rotation.set(Math.PI / 2, 0, 0);
      leg.foot.scale.set(0.05, 0.2, 0.05);
    });
  };
  setLegs(0);

  // Glow under the rider: marks "you" and lifts the rider off the road.
  const glow = new Mesh(
    new CircleGeometry(0.9, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: RIDER.jersey, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  glow.position.y = 0.03;
  glow.scale.set(0.9, 1, 1.5);
  group.add(glow);

  return {
    group,
    glow,
    spin(distance: number, crank: number) {
      for (const w of wheels) w.rotation.x -= distance / 0.36;
      setLegs(crank);
    },
  };
}
