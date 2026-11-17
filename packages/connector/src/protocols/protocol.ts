import type {
  BikeData,
  SpinDownProgress,
  SpinDownResult,
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
  /** Report a non-fatal problem (e.g. control refused at connect). */
  warn?(error: Error): void;
  /** `capabilities`/`controlDenied` changed while connected (control lost or regained). */
  controlChanged?(): void;
  /**
   * Something outside our commands changed the trainer's state: another client (e.g. a
   * watch connected to the same trainer) took control, reset it, stopped it or set its
   * own target. The current mode should be sent again.
   */
  overridden?(): void;
}

/** A connected trainer speaking one specific protocol. */
export interface TrainerProtocol {
  readonly name: ProtocolName;
  /** What can be controlled right now. May change while connected (see `ProtocolContext.controlChanged`). */
  readonly capabilities: TrainerCapabilities;
  /**
   * True while the trainer could be controlled but refuses it, because another client
   * (an app or a watch) holds control. Commands keep trying to take control back.
   */
  readonly controlDenied?: boolean;
  /** Supported ERG range if the trainer reports one. */
  readonly powerRange?: { min: number; max: number };
  setTargetPower(watts: number): Promise<void>;
  setSimulation(params: ResolvedSimulationParams): Promise<void>;
  /** The trainer can run a spin-down calibration. */
  readonly spinDownSupported?: boolean;
  /**
   * Run a spin-down calibration. Report progress through `onProgress` (not the final
   * done/failed, the trainer does that); resolve when finished. Must give up and cancel
   * when `signal` aborts.
   */
  spinDown?(onProgress: (p: SpinDownProgress) => void, signal: AbortSignal): Promise<SpinDownResult>;
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
