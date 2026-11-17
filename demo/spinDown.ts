import type { SpinDownProgress } from "../src/index.ts";

/** What to tell the rider during a spin-down calibration (shared by the demo pages). */
export function spinDownText(p: SpinDownProgress, speed: number | undefined): string {
  const now = speed === undefined ? "" : ` (now ${speed.toFixed(1)} km/h)`;
  switch (p.phase) {
    case "starting":
      return "Starting the spin-down…";
    case "speed-up":
      return p.targetSpeed
        ? `Speed up to more than ${Math.round(p.targetSpeed.high)} km/h${now}.`
        : `Speed up and keep going until the trainer tells you to stop${now}.`;
    case "coast":
      return "Stop pedalling now and let the flywheel run down. Don't touch the pedals.";
    case "done":
      return `Calibrated ✓${p.spinDownTime === undefined ? "" : ` (spin-down ${(p.spinDownTime / 1000).toFixed(1)} s)`}`;
    case "failed":
      return `Spin-down failed: ${p.message ?? "unknown reason"}. Warm up for ~10 minutes and try again.`;
  }
}
