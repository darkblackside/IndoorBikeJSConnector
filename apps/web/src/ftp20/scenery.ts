/**
 * Sceneries for the runner: flat colour palettes and the roadside objects of each one, built from a handful of
 * low-poly primitives. No textures or images: every object is a few coloured boxes, cones, cylinders and
 * icosahedra, drawn with instancing by the scene (runnerScene.ts).
 */
import { mulberry32 } from "@indoor-bike/game-core/zombie-ramp";

/** Deterministic random numbers, so the world looks the same for the same seed. */
export const rng = mulberry32;

export type Geo = "box" | "cone" | "cyl" | "ico" | "pyr" | "ball";
type V3 = readonly [number, number, number];

/** One coloured primitive of an object, relative to the object's ground point (y up, metres). */
export interface Part {
  geo: Geo;
  color: number;
  pos: V3;
  scale: V3;
  rot?: V3;
}

export interface Palette {
  /** Sky at the zenith and at the horizon (= fog colour). */
  zenith: number;
  horizon: number;
  road: number;
  edge: number;
  stripe: number;
  /** Ground next to the road (sidewalk, verge, sand) and further out, on each side. */
  nearL: number;
  farL: number;
  nearR: number;
  farR: number;
  /** Distant hills/mountains and skyline. */
  hills: number;
  skyline: number;
  /** Height of the distant hills (0 = flat) and of the skyline boxes (0 = none). */
  hillHeight: number;
  skylineHeight: number;
}

export interface Scenery {
  name: string;
  palette: Palette;
  /** Objects right next to the road (one slot every few metres) and further out. */
  near: PropKind[];
  far: PropKind[];
  /** Chance that a slot stays empty. */
  nearGap: number;
  farGap: number;
  /** Distance of the near / far objects from the road's centre line, metres. */
  nearX: readonly [number, number];
  farX: readonly [number, number];
}

export interface PropKind {
  weight: number;
  /** Keep the object square to the road (buildings) instead of turning it randomly. */
  aligned?: boolean;
  /** Only on this side of the road. */
  side?: "L" | "R";
  build(rnd: () => number): Part[];
}

const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const range = (rnd: () => number, a: number, b: number) => a + rnd() * (b - a);

// --- objects ---------------------------------------------------------------------------------

function building(rnd: () => number, colors: readonly number[], tall: [number, number]): Part[] {
  const w = range(rnd, 5, 8);
  const d = range(rnd, 5, 8);
  const h = range(rnd, tall[0], tall[1]);
  const c = pick(rnd, colors);
  const parts: Part[] = [{ geo: "box", color: c, pos: [0, h / 2, 0], scale: [w, h, d] }];
  // Window bands: slightly larger thin boxes in a lighter tone read as rows of windows from afar.
  const bands = Math.min(4, Math.floor(h / 6));
  for (let i = 0; i < bands; i++) {
    const y = 3 + i * ((h - 4) / Math.max(1, bands));
    parts.push({ geo: "box", color: 0xbfe3f2, pos: [0, y, 0], scale: [w + 0.1, 0.9, d + 0.1] });
  }
  parts.push({ geo: "box", color: 0x3a4250, pos: [0, h + 0.3, 0], scale: [w * 0.5, 0.6, d * 0.5] });
  return parts;
}

/** A street lamp at the kerb: its slot is set back with the buildings, so the lamp stands 5.5 m closer to the road. */
const lamp = (): Part[] => [
  { geo: "cyl", color: 0x4a5260, pos: [0, 2.6, 5.5], scale: [0.18, 5.2, 0.18] },
  { geo: "box", color: 0x4a5260, pos: [0, 5.2, 6.1], scale: [0.14, 0.14, 1.3] },
  { geo: "box", color: 0xfff1a8, pos: [0, 5.05, 6.7], scale: [0.45, 0.2, 0.45] },
];

const roundTree = (rnd: () => number, greens: readonly number[], size = 1): Part[] => {
  const s = size * range(rnd, 0.8, 1.3);
  return [
    { geo: "cyl", color: 0x7a5233, pos: [0, 1.2 * s, 0], scale: [0.35 * s, 2.4 * s, 0.35 * s] },
    { geo: "ico", color: pick(rnd, greens), pos: [0, 3.3 * s, 0], scale: [3 * s, 2.8 * s, 3 * s] },
  ];
};

const pine = (rnd: () => number, greens: readonly number[], snow = false): Part[] => {
  const s = range(rnd, 0.8, 1.5);
  const g = pick(rnd, greens);
  return [
    { geo: "cyl", color: 0x6b4527, pos: [0, 0.6 * s, 0], scale: [0.3 * s, 1.2 * s, 0.3 * s] },
    { geo: "cone", color: g, pos: [0, 2.4 * s, 0], scale: [3 * s, 3 * s, 3 * s] },
    { geo: "cone", color: snow ? 0xf4f8fb : g, pos: [0, 4.1 * s, 0], scale: [2.1 * s, 2.4 * s, 2.1 * s] },
  ];
};

const rock = (rnd: () => number, colors: readonly number[], size = 1): Part[] => {
  const s = size * range(rnd, 0.6, 1.6);
  return [{ geo: "ico", color: pick(rnd, colors), pos: [0, 0.35 * s, 0], scale: [1.6 * s, 1.1 * s, 1.3 * s] }];
};

const palm = (rnd: () => number): Part[] => {
  const h = range(rnd, 5, 7);
  const lean = range(rnd, -0.15, 0.15);
  const top: V3 = [Math.sin(lean) * h, h, 0];
  const leaves: Part[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.4;
    leaves.push({
      geo: "box",
      color: i % 2 ? 0x2f9e5b : 0x3cb371,
      pos: [top[0] + Math.cos(a) * 1.3, h - 0.35, Math.sin(a) * 1.3],
      scale: [2.8, 0.12, 0.7],
      rot: [0, -a, -0.45],
    });
  }
  return [
    { geo: "cyl", color: 0xa47548, pos: [top[0] / 2, h / 2, 0], scale: [0.35, h, 0.35], rot: [0, 0, -lean] },
    { geo: "ball", color: 0x7a5233, pos: [top[0], h, 0], scale: [0.7, 0.7, 0.7] },
    ...leaves,
  ];
};

const umbrella = (rnd: () => number): Part[] => {
  const c = pick(rnd, [0xff5a5f, 0xffc145, 0x4ecdc4, 0xf78fb3]);
  return [
    { geo: "cyl", color: 0xeeeeee, pos: [0, 1.1, 0], scale: [0.08, 2.2, 0.08] },
    { geo: "cone", color: c, pos: [0, 2.35, 0], scale: [2.8, 0.7, 2.8] },
    { geo: "box", color: pick(rnd, [0x4ecdc4, 0xffffff, 0xff8a5b]), pos: [1.2, 0.1, 0], scale: [0.9, 0.12, 1.9] },
  ];
};

const cactus = (rnd: () => number): Part[] => {
  const h = range(rnd, 2.2, 4.2);
  const g = pick(rnd, [0x3d8b4f, 0x4a9a5a]);
  const arm = range(rnd, 0.9, h * 0.6);
  return [
    { geo: "cyl", color: g, pos: [0, h / 2, 0], scale: [0.55, h, 0.55] },
    { geo: "cyl", color: g, pos: [0.55, arm, 0], scale: [0.6, 0.3, 0.3], rot: [0, 0, Math.PI / 2] },
    { geo: "cyl", color: g, pos: [0.8, arm + 0.55, 0], scale: [0.32, 1.1, 0.32] },
    { geo: "cyl", color: g, pos: [-0.5, arm * 0.8, 0], scale: [0.5, 0.28, 0.28], rot: [0, 0, Math.PI / 2] },
    { geo: "cyl", color: g, pos: [-0.72, arm * 0.8 + 0.4, 0], scale: [0.3, 0.8, 0.3] },
  ];
};

const mesa = (rnd: () => number): Part[] => {
  const w = range(rnd, 10, 22);
  const h = range(rnd, 6, 14);
  return [
    { geo: "box", color: pick(rnd, [0xc8693f, 0xb85c38, 0xd4805a]), pos: [0, h / 2, 0], scale: [w, h, w * 0.7] },
    { geo: "box", color: 0xe2a26f, pos: [0, h + 0.4, 0], scale: [w * 0.95, 0.8, w * 0.65] },
  ];
};

const house = (rnd: () => number): Part[] => {
  const w = range(rnd, 4, 6);
  return [
    { geo: "box", color: pick(rnd, [0xf2e6d0, 0xe8d6b5, 0xfafafa]), pos: [0, 1.6, 0], scale: [w, 3.2, w * 0.8] },
    { geo: "pyr", color: pick(rnd, [0xb5452f, 0x8c3a2b, 0x5a6b7a]), pos: [0, 4.1, 0], scale: [w * 1.25, 1.8, w]},
    { geo: "box", color: 0x6b4a2f, pos: [0, 0.9, w * 0.4 + 0.02], scale: [0.9, 1.8, 0.05] },
  ];
};

const hayBale = (rnd: () => number): Part[] => [
  { geo: "cyl", color: 0xe8c45a, pos: [0, 0.7, 0], scale: [1.4, 1.4, 1.4], rot: [Math.PI / 2, 0, rnd() * 0.5] },
];

const fence = (): Part[] => [
  { geo: "box", color: 0xffffff, pos: [0, 0.5, -2], scale: [0.12, 1, 0.12] },
  { geo: "box", color: 0xffffff, pos: [0, 0.5, 2], scale: [0.12, 1, 0.12] },
  { geo: "box", color: 0xffffff, pos: [0, 0.75, 0], scale: [0.08, 0.1, 4] },
  { geo: "box", color: 0xffffff, pos: [0, 0.4, 0], scale: [0.08, 0.1, 4] },
];

const hut = (rnd: () => number): Part[] => [
  { geo: "box", color: pick(rnd, [0x9bd3e0, 0xffd6a5, 0xffadad]), pos: [0, 1.3, 0], scale: [3, 2.6, 3] },
  { geo: "pyr", color: 0xf6f1e7, pos: [0, 3.2, 0], scale: [3.9, 1.3, 3.9] },
];

const cabin = (rnd: () => number): Part[] => [
  { geo: "box", color: 0x8a5a3c, pos: [0, 1.4, 0], scale: [5, 2.8, 4] },
  { geo: "pyr", color: 0xf4f8fb, pos: [0, 3.6, 0], scale: [6.4, 1.8, 5.2] },
  { geo: "box", color: 0xfff1a8, pos: [0, 1.4, 2.02], scale: [1, 0.8, 0.05] },
  ...(rnd() < 0.5 ? [] : [{ geo: "box" as const, color: 0x5c5c5c, pos: [1.5, 4.2, 0] as V3, scale: [0.5, 1.4, 0.5] as V3 }]),
];

const snowman = (): Part[] => [
  { geo: "ball", color: 0xffffff, pos: [0, 0.6, 0], scale: [1.2, 1.2, 1.2] },
  { geo: "ball", color: 0xffffff, pos: [0, 1.45, 0], scale: [0.8, 0.8, 0.8] },
  { geo: "cone", color: 0xff8c1a, pos: [0, 1.5, 0.45], scale: [0.12, 0.4, 0.12], rot: [Math.PI / 2, 0, 0] },
];

const greens = [0x2e8b57, 0x3fa34d, 0x56b85a, 0x2f7d4f];
const darkGreens = [0x1f5f3f, 0x2a6e47, 0x245a3a];

// --- sceneries ---------------------------------------------------------------------------------

export const SCENERIES: Scenery[] = [
  {
    name: "City",
    palette: {
      zenith: 0x5aa9e6, horizon: 0xcfe3f2, road: 0x3b4048, edge: 0xd9dde3, stripe: 0xffffff,
      nearL: 0x9aa3ad, farL: 0x6f7883, nearR: 0x9aa3ad, farR: 0x6f7883,
      hills: 0x9fb4c6, skyline: 0x8aa0b4, hillHeight: 0.15, skylineHeight: 1,
    },
    near: [
      { weight: 6, aligned: true, build: (r) => building(r, [0xf28f6b, 0xf6c177, 0x7fb7be, 0xd3d0cb, 0x9a8fbf], [8, 22]) },
      { weight: 2, aligned: true, build: () => lamp() },
      { weight: 1, build: (r) => roundTree(r, greens, 0.8) },
    ],
    far: [{ weight: 1, aligned: true, build: (r) => building(r, [0x7d8ca3, 0xa3b1c2, 0x6c7a91, 0xc0c8d4], [18, 48]) }],
    nearGap: 0.05, farGap: 0.1, nearX: [9.5, 12], farX: [22, 45],
  },
  {
    name: "Fields",
    palette: {
      zenith: 0x4fa3e0, horizon: 0xdff0f7, road: 0x44474d, edge: 0xf2f2f2, stripe: 0xffffff,
      nearL: 0x8cc152, farL: 0xd9c75b, nearR: 0x8cc152, farR: 0x6fb04a,
      hills: 0x7fb069, skyline: 0x7fb069, hillHeight: 0.35, skylineHeight: 0,
    },
    near: [
      { weight: 3, build: () => fence() },
      { weight: 2, build: (r) => hayBale(r) },
      { weight: 1, build: (r) => roundTree(r, greens) },
    ],
    far: [
      { weight: 2, aligned: true, build: (r) => house(r) },
      { weight: 3, build: (r) => roundTree(r, greens, 1.3) },
      { weight: 2, build: (r) => hayBale(r) },
    ],
    nearGap: 0.35, farGap: 0.45, nearX: [6, 9], farX: [16, 55],
  },
  {
    name: "Forest",
    palette: {
      zenith: 0x5b9bd5, horizon: 0xcde6d6, road: 0x3f4247, edge: 0xe6e6e6, stripe: 0xf5f5f5,
      nearL: 0x4f8f3a, farL: 0x3b7a33, nearR: 0x4f8f3a, farR: 0x3b7a33,
      hills: 0x3f7a4a, skyline: 0x3f7a4a, hillHeight: 0.6, skylineHeight: 0,
    },
    near: [
      { weight: 5, build: (r) => pine(r, darkGreens) },
      { weight: 3, build: (r) => roundTree(r, greens) },
      { weight: 1, build: (r) => rock(r, [0x8d9399, 0x7a8086]) },
    ],
    far: [
      { weight: 5, build: (r) => pine(r, darkGreens) },
      { weight: 2, build: (r) => roundTree(r, greens, 1.4) },
    ],
    nearGap: 0.1, farGap: 0.05, nearX: [6.5, 14], farX: [15, 45],
  },
  {
    name: "Mountains",
    palette: {
      zenith: 0x3d7cc9, horizon: 0xe4eef7, road: 0x4a4e55, edge: 0xffffff, stripe: 0xffd84d,
      nearL: 0xf2f6fa, farL: 0xe3ebf2, nearR: 0xf2f6fa, farR: 0xdfe8f0,
      hills: 0xb7c7d9, skyline: 0xb7c7d9, hillHeight: 1.6, skylineHeight: 0,
    },
    near: [
      { weight: 5, build: (r) => pine(r, darkGreens, true) },
      { weight: 1, build: (r) => rock(r, [0x9aa5b1, 0x7d8894]) },
      { weight: 0.4, build: () => snowman() },
    ],
    far: [
      { weight: 4, build: (r) => pine(r, darkGreens, true) },
      { weight: 1, aligned: true, build: (r) => cabin(r) },
      { weight: 1, build: (r) => rock(r, [0x9aa5b1, 0x8693a0], 3) },
    ],
    nearGap: 0.25, farGap: 0.25, nearX: [6.5, 12], farX: [15, 50],
  },
  {
    name: "Desert",
    palette: {
      zenith: 0x4a90d9, horizon: 0xf6dcb0, road: 0x4b4744, edge: 0xf2e2c4, stripe: 0xffffff,
      nearL: 0xe9c48a, farL: 0xdcae6e, nearR: 0xe9c48a, farR: 0xd9a865,
      hills: 0xd08a5a, skyline: 0xd08a5a, hillHeight: 0.5, skylineHeight: 0,
    },
    near: [
      { weight: 3, build: (r) => cactus(r) },
      { weight: 2, build: (r) => rock(r, [0xc9875a, 0xb5764d]) },
    ],
    far: [
      { weight: 2, aligned: true, build: (r) => mesa(r) },
      { weight: 2, build: (r) => cactus(r) },
      { weight: 1, build: (r) => rock(r, [0xc9875a, 0xb5764d], 2.5) },
    ],
    nearGap: 0.55, farGap: 0.55, nearX: [6.5, 14], farX: [20, 60],
  },
  {
    name: "Beach",
    palette: {
      zenith: 0x2f9ee8, horizon: 0xd4f1fb, road: 0x494c52, edge: 0xffffff, stripe: 0xffffff,
      nearL: 0xf3dfa8, farL: 0x8fd18a, nearR: 0xf6e4b0, farR: 0x2bb3d9,
      hills: 0x68b07a, skyline: 0x68b07a, hillHeight: 0.3, skylineHeight: 0,
    },
    near: [
      { weight: 4, build: (r) => palm(r) },
      { weight: 3, side: "R", build: (r) => umbrella(r) },
      { weight: 1, side: "L", aligned: true, build: (r) => hut(r) },
    ],
    far: [
      { weight: 3, side: "L", build: (r) => palm(r) },
      { weight: 1, side: "L", build: (r) => hut(r) },
    ],
    nearGap: 0.3, farGap: 0.4, nearX: [6.5, 11], farX: [16, 40],
  },
];

/** Scenery number `i`, cycling through the list. */
export const sceneryAt = (i: number) => SCENERIES[((i % SCENERIES.length) + SCENERIES.length) % SCENERIES.length]!;
