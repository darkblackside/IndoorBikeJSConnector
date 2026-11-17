/**
 * three.js set up for 2D: an orthographic camera looking straight at the XY plane, sized in world units
 * (metres, like game-core), with +x right and +y down as on a canvas (and in CityWorld). Later 3D views can
 * use a perspective camera on the same scene.
 *
 * 2D layering: put everything at z = 0 and order it with `renderOrder` (materials with `depthTest: false`).
 * Meshes are seen from behind (camera at z < 0), so use `side: DoubleSide` (or BackSide) on their materials.
 *
 * The engine only renders: game state lives in @indoor-bike/game-core and is read every frame.
 */
import { Color, OrthographicCamera, Scene, WebGLRenderer } from "three";

export interface Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  /** How many world units (metres) fit across the shorter side of the view. */
  viewSize: number;
  /** Centre the view on a world point. */
  lookAt(x: number, y: number): void;
  /** Runs `update(dt)` and renders every animation frame. Returns a function that stops the loop. */
  run(update: (dt: number) => void): () => void;
  dispose(): void;
}

export function createStage(canvas: HTMLCanvasElement, opts: { background?: string; viewSize?: number } = {}): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  scene.background = new Color(opts.background ?? "#0d1014");
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  // Behind the plane (z < 0) looking towards +z with "up" = -y: screen right is +x and screen down is +y.
  camera.up.set(0, -1, 0);

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const ratio = renderer.getPixelRatio();
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) renderer.setSize(w, h, false);
    const unitsPerPx = stage.viewSize / Math.min(w, h);
    camera.left = (-w / 2) * unitsPerPx;
    camera.right = (w / 2) * unitsPerPx;
    camera.top = (h / 2) * unitsPerPx;
    camera.bottom = (-h / 2) * unitsPerPx;
    camera.updateProjectionMatrix();
  };

  const stage: Stage = {
    renderer,
    scene,
    camera,
    viewSize: opts.viewSize ?? 230,
    lookAt(x, y) {
      camera.position.set(x, y, -10);
      camera.lookAt(x, y, 0);
    },
    run(update) {
      let prev = performance.now();
      let raf = 0;
      const frame = (now: number) => {
        const dt = Math.min(0.1, Math.max(0, (now - prev) / 1000));
        prev = now;
        update(dt);
        resize();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
    },
    dispose() {
      renderer.dispose();
    },
  };
  stage.lookAt(0, 0);
  return stage;
}
