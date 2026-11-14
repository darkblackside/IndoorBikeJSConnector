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
