/** Live values. Every field is undefined until a device has reported it. */
export interface BikeData {
  /** watts */
  power?: number;
  /** rpm */
  cadence?: number;
  /** km/h (trainer's virtual speed) */
  speed?: number;
  /** bpm */
  heartRate?: number;
  /** metres since the trainer connected/reset */
  distance?: number;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export type ProtocolName = "ftms" | "wahoo" | "tacx-fec" | "cycling-power";

export interface TrainerCapabilities {
  /** Can hold a target power (ERG). */
  erg: boolean;
  /** Can simulate grade/wind (SIM). */
  simulation: boolean;
}

/** Who controls the trainer right now; emitted as the trainer's `control` event whenever it changes. */
export interface TrainerControl {
  /** What can be controlled right now (false while another client holds control). */
  capabilities: TrainerCapabilities;
  /** The trainer could be controlled, but another app or device (e.g. a watch) holds control. */
  controlDenied: boolean;
  /** An ERG target is requested and the trainer accepted it: the trainer really holds the wattage. */
  ergActive: boolean;
}

/** Progress of a spin-down calibration (`spinDown` event); tell the rider what to do. */
export interface SpinDownProgress {
  /**
   * starting: request sent · speed-up: ride faster than `targetSpeed.high` ·
   * coast: stop pedalling and let the flywheel run down · done / failed: finished.
   */
  phase: "starting" | "speed-up" | "coast" | "done" | "failed";
  /** km/h; the trainer wants you above `high` (FE-C reports one value, given as both). */
  targetSpeed?: { low: number; high: number };
  /** Spin-down time in ms when the trainer reports it (done). */
  spinDownTime?: number;
  /** Why it failed. */
  message?: string;
}

export interface SpinDownResult {
  ok: boolean;
  spinDownTime?: number;
  message?: string;
}

/** Road simulation parameters. Only `grade` is required. */
export interface SimulationParams {
  /** Road grade in percent, e.g. 4.5 for 4.5 %. Negative for downhill. */
  grade: number;
  /** Head wind in m/s (negative = tail wind). Default 0. */
  windSpeed?: number;
  /** Rolling resistance coefficient. Default 0.004 (asphalt). */
  crr?: number;
  /** Wind resistance coefficient in kg/m (0.5 · ρ · CdA). Default 0.51. */
  cw?: number;
}

export const simulationDefaults = { windSpeed: 0, crr: 0.004, cw: 0.51 } as const;

export type ResolvedSimulationParams = Required<SimulationParams>;

export interface RiderProfile {
  /** kg, default 75 */
  riderWeight: number;
  /** kg, default 9 */
  bikeWeight: number;
  /** metres, used to turn wheel revolutions into speed. Default 2.096 (700x23c, KICKR default). */
  wheelCircumference: number;
}

export const riderDefaults: RiderProfile = { riderWeight: 75, bikeWeight: 9, wheelCircumference: 2.096 };

/** What the trainer should currently be doing. */
export type TrainerMode =
  | { kind: "none" }
  | { kind: "erg"; watts: number }
  | { kind: "simulation"; params: ResolvedSimulationParams };

/** Subset of `navigator.bluetooth` the library needs; inject your own (tests, Node, Electron). */
export type BluetoothLike = Pick<Bluetooth, "requestDevice">;
