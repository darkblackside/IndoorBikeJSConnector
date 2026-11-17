import { defaultDrivers, type ProtocolContext, type ProtocolDriver, type TrainerProtocol } from "./protocols/index.ts";
import { BleSensor, type SensorOptions } from "./sensor.ts";
import {
  riderDefaults,
  simulationDefaults,
  type ProtocolName,
  type RiderProfile,
  type SimulationParams,
  type TrainerCapabilities,
  type TrainerMode,
} from "./types.ts";

export interface TrainerOptions extends SensorOptions {
  /** Protocol drivers in priority order. Default: FTMS, Tacx FE-C, Wahoo, Cycling Power (read-only). */
  drivers?: readonly ProtocolDriver[];
  rider?: Partial<RiderProfile>;
  /** Monotonic clock in ms. Default `performance.now()`. */
  now?: () => number;
}

const NO_CAPABILITIES: TrainerCapabilities = { erg: false, simulation: false };

/**
 * A smart trainer (or power meter). Detects the protocol automatically and offers
 * one control API: `setTargetPower` (ERG), `setSimulation` (SIM), `freeRide`, and
 * `releaseControl` to stop controlling it and only read data.
 *
 * Control calls are cheap and can be made every frame: only the latest request is
 * kept, at most one command is in flight, and unchanged values are not resent.
 * The current mode is re-applied after an automatic reconnect.
 */
export class Trainer extends BleSensor {
  private readonly drivers: readonly ProtocolDriver[];
  private readonly rider: RiderProfile;
  private readonly now: () => number;
  private protocol?: TrainerProtocol;
  private wanted: TrainerMode = { kind: "none" };
  private sent: TrainerMode = { kind: "none" };
  private applying = false;

  constructor(options: TrainerOptions = {}) {
    super(options);
    this.drivers = options.drivers ?? defaultDrivers;
    this.rider = { ...riderDefaults, ...options.rider };
    this.now = options.now ?? (() => performance.now());
  }

  /** Detected protocol, once connected. */
  get protocolName(): ProtocolName | undefined {
    return this.protocol?.name;
  }
  get capabilities(): TrainerCapabilities {
    return this.protocol?.capabilities ?? NO_CAPABILITIES;
  }
  get powerRange(): { min: number; max: number } | undefined {
    return this.protocol?.powerRange;
  }
  /** The mode most recently requested (applied as soon as possible). */
  get mode(): TrainerMode {
    return this.wanted;
  }
  /** True when the trainer is connected, supports ERG and an ERG target is requested. */
  get ergActive(): boolean {
    return this.wanted.kind === "erg" && this.capabilities.erg && this.status === "connected";
  }

  /** ERG mode: hold `watts` regardless of cadence. */
  setTargetPower(watts: number): void {
    if (!Number.isFinite(watts)) throw new RangeError("watts must be a finite number");
    this.request({ kind: "erg", watts: Math.max(0, Math.round(watts)) });
  }

  /** SIM mode: resistance follows the given road grade/wind. */
  setSimulation(params: SimulationParams): void {
    if (!Number.isFinite(params.grade)) throw new RangeError("grade must be a finite number");
    this.request({ kind: "simulation", params: { ...simulationDefaults, ...params } });
  }

  /** Release ERG: flat road simulation, the rider sets the effort via gears/cadence. */
  freeRide(): void {
    this.setSimulation({ grade: 0 });
  }

  /**
   * Stop controlling the trainer and only read its data (power, cadence, speed).
   * If an ERG target was active it is lifted first (flat-road SIM, when supported),
   * so the rider sets the effort with gears and cadence. Nothing is re-applied on reconnect.
   */
  releaseControl(): void {
    this.request({ kind: "none" });
  }

  /** Update rider/bike data used by simulation (takes effect with the next SIM command). */
  setRider(rider: Partial<RiderProfile>): void {
    Object.assign(this.rider, rider);
  }

  protected requestOptions(): RequestDeviceOptions {
    const services = [...new Set(this.drivers.flatMap((d) => d.services))];
    return { filters: services.map((s) => ({ services: [s] })), optionalServices: services };
  }

  protected async setup(server: BluetoothRemoteGATTServer): Promise<void> {
    let fallback: TrainerProtocol | undefined;
    let active: TrainerProtocol | undefined;
    for (const driver of this.drivers) {
      // Several drivers may subscribe while probing; only the chosen one's data is forwarded.
      let protocol: TrainerProtocol | undefined;
      const ctx: ProtocolContext = {
        rider: this.rider,
        now: this.now,
        emit: (data) => {
          if (protocol && protocol === active) this.updateData(data);
        },
      };
      try {
        protocol = await driver.connect(server, ctx);
      } catch (error) {
        this.reportError(new Error(`${driver.name}: ${(error as Error).message}`));
        continue;
      }
      if (!protocol) continue;
      if (protocol.capabilities.erg || protocol.capabilities.simulation) {
        active = protocol;
        break;
      }
      fallback ??= protocol; // read-only for now, keep looking for one with control
    }
    active ??= fallback;
    if (!active) throw new Error("Device does not speak any supported trainer protocol");
    this.protocol = active;
    this.sent = { kind: "none" };
    void this.apply();
  }

  protected teardown(): void {
    this.protocol = undefined;
    this.sent = { kind: "none" };
  }

  private request(mode: TrainerMode): void {
    this.wanted = mode;
    void this.apply();
  }

  private async apply(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      while (this.protocol && !sameMode(this.wanted, this.sent)) {
        const protocol = this.protocol;
        const mode = this.wanted;
        try {
          if (mode.kind === "erg") {
            const range = protocol.powerRange;
            const watts = range ? Math.min(range.max, Math.max(range.min, mode.watts)) : mode.watts;
            await protocol.setTargetPower(watts);
          } else if (mode.kind === "simulation") {
            await protocol.setSimulation(mode.params);
          } else if (this.sent.kind === "erg" && protocol.capabilities.simulation) {
            // Leaving ERG: drop the power target so the rider controls the effort again.
            await protocol.setSimulation({ ...simulationDefaults, grade: 0 });
          }
        } catch (error) {
          this.reportError(error);
        }
        // Mark as handled even on failure so a rejected command is not retried in a loop.
        if (this.protocol === protocol) this.sent = mode;
      }
    } finally {
      this.applying = false;
    }
  }
}

function sameMode(a: TrainerMode, b: TrainerMode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "erg" && b.kind === "erg") return a.watts === b.watts;
  if (a.kind === "simulation" && b.kind === "simulation") {
    const p = a.params;
    const q = b.params;
    return p.grade === q.grade && p.windSpeed === q.windSpeed && p.crr === q.crr && p.cw === q.cw;
  }
  return true;
}
