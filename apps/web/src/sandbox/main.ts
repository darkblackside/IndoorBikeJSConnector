// Engine sandbox (dev only: http://localhost:5173/sandbox/). Renders a game-core CityWorld with three.js in 2D,
// the way the games will once they move from the canvas renderer to the engine. Try `?seed=42`.
import { BLOCK, CityWorld, hash, mulberry32, STREET } from "@indoor-bike/game-core/zombie-ramp";
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import { createStage } from "../engine/stage.ts";

const seed = Number(new URLSearchParams(location.search).get("seed") ?? 1);
const world = new CityWorld(mulberry32(seed));
const stage = createStage(document.querySelector<HTMLCanvasElement>("#stage")!);

// DoubleSide: the stage camera looks at the XY plane from behind (to get +y down), so front faces point away.
const flat = (color: string) => new MeshBasicMaterial({ color, depthTest: false, side: DoubleSide });
const layer = <T extends Mesh | Line>(obj: T, order: number): T => {
  obj.renderOrder = order;
  obj.frustumCulled = false;
  stage.scene.add(obj);
  return obj;
};

// Streets: one big quad under everything that follows the camera; buildings on top, one instance per block.
const street = layer(new Mesh(new PlaneGeometry(1, 1), flat("#232a33")), 0);
const MAX_BLOCKS = 400;
const buildings = layer(new InstancedMesh(new PlaneGeometry(1, 1), flat("#ffffff"), MAX_BLOCKS), 1);
buildings.instanceMatrix.setUsage(DynamicDrawUsage);
const buildingColors = ["#151a20", "#181e25", "#1b222a", "#12161b"].map((c) => new Color(c));

const route = layer(new Line(new BufferGeometry(), new LineBasicMaterial({ color: "#40e0d0", transparent: true, opacity: 0.35, depthTest: false })), 2);
const MAX_DOTS = 300;
const dots = layer(new InstancedMesh(new CircleGeometry(1, 16), flat("#ffffff"), MAX_DOTS), 3);
dots.instanceMatrix.setUsage(DynamicDrawUsage);
const player = layer(new Mesh(new CircleGeometry(3, 24), flat("#40e0d0")), 4);

const m = new Matrix4();
const zombie = new Color("#ff3b3b");
const wanderer = new Color("#7a2a2a");
let camX = 0;
let camY = 0;

stage.run((dt) => {
  world.update(dt, 7 * dt, 50); // attract mode, like the Zombie Ramp setup screen
  const me = world.route.at(world.s);
  camX += (me.x + me.dx * 25 - camX) * 0.08;
  camY += (me.y + me.dy * 25 - camY) * 0.08;
  stage.lookAt(camX, camY);

  // Visible blocks
  const half = stage.viewSize;
  const x0 = Math.floor((camX - half) / BLOCK);
  const x1 = Math.ceil((camX + half) / BLOCK);
  const y0 = Math.floor((camY - half) / BLOCK);
  const y1 = Math.ceil((camY + half) / BLOCK);
  street.position.set((x0 + x1) / 2 * BLOCK, (y0 + y1) / 2 * BLOCK, 0);
  street.scale.set((x1 - x0) * BLOCK, (y1 - y0) * BLOCK, 1);
  const size = BLOCK - STREET;
  let n = 0;
  for (let i = x0; i < x1 && n < MAX_BLOCKS; i++) {
    for (let j = y0; j < y1 && n < MAX_BLOCKS; j++) {
      m.makeScale(size, size, 1).setPosition(i * BLOCK + STREET / 2 + size / 2, j * BLOCK + STREET / 2 + size / 2, 0);
      buildings.setMatrixAt(n, m);
      buildings.setColorAt(n, buildingColors[Math.floor(hash(i, j) * buildingColors.length)]!);
      n++;
    }
  }
  buildings.count = n;
  buildings.instanceMatrix.needsUpdate = true;
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;

  route.geometry.setFromPoints(world.route.polyline(world.s - 45, world.s + 220).map((p) => new Vector3(p.x, p.y, 0)));

  let d = 0;
  for (const list of [world.wanderers, world.horde] as const) {
    for (const z of list) {
      if (d >= MAX_DOTS) break;
      const r = list === world.horde ? 2 : 1.7;
      dots.setMatrixAt(d, m.makeScale(r, r, 1).setPosition(z.x, z.y, 0));
      dots.setColorAt(d, list === world.horde ? zombie : wanderer);
      d++;
    }
  }
  dots.count = d;
  dots.instanceMatrix.needsUpdate = true;
  if (dots.instanceColor) dots.instanceColor.needsUpdate = true;

  player.position.set(me.x, me.y, 0);
  player.scale.setScalar(1 + Math.sin(world.time * 6) * 0.08);
});
