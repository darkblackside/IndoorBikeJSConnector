import type {
  BikeData,
  ProtocolName,
  ResolvedSimulationParams,
  RiderProfile,
  TrainerCapabilities,
} from "../types.ts";

export interface ProtocolContext {
  /** Report new values (only the fields that changed/are known). */
  emit(data: BikeData): void;
  readonly rider: RiderProfile;
  /** Monotonic milliseconds; injectable for tests. */
  now(): number;
}

/** A connected trainer speaking one specific protocol. */
export interface TrainerProtocol {
  readonly name: ProtocolName;
  readonly capabilities: TrainerCapabilities;
  /** Supported ERG range if the trainer reports one. */
  readonly powerRange?: { min: number; max: number };
  setTargetPower(watts: number): Promise<void>;
  setSimulation(params: ResolvedSimulationParams): Promise<void>;
}

/**
 * Detects and starts a protocol on a connected GATT server.
 * Resolves undefined if the device does not speak this protocol.
 */
export interface ProtocolDriver {
  readonly name: ProtocolName;
  /** Primary services this driver needs; used to build the device chooser filter. */
  readonly services: readonly string[];
  connect(server: BluetoothRemoteGATTServer, ctx: ProtocolContext): Promise<TrainerProtocol | undefined>;
}

export class UnsupportedError extends Error {
  constructor(protocol: ProtocolName, feature: string) {
    super(`${feature} is not supported by this trainer (${protocol})`);
    this.name = "UnsupportedError";
  }
}
