import { defaultDrivers, type ProtocolContext, type ProtocolDriver, type TrainerProtocol } from "./protocols/index.ts";
import { BleSensor, type SensorOptions } from "./sensor.ts";
import {
  riderDefaults,
  simulationDefaults,
  type ProtocolName,
  type RiderProfile,
  type SimulationParams,
  type TrainerCapabilities,
  type TrainerControl,
  type TrainerMode,
} from "./types.ts";

export interface TrainerOptions extends SensorOptions {
  /** Protocol drivers in priority order. Default: FTMS, Tacx FE-C, Wahoo, Cycling Power (read-only). */
  drivers?: readonly ProtocolDriver[];
  rider?: Partial<RiderProfile>;
  /** Monotonic clock in ms. Default `performance.now()`. */
  now?: () => number;
  /**
   * Re-send the current ERG/SIM mode when nothing was sent for this many ms, so a target
   * cleared by another client (e.g. a watch connected to the same trainer) comes back.
   * Default 5000; 0 turns it off.
   */
  refreshInterval?: number;
}

const NO_CAPABILITIES: TrainerCapabilities = { erg: false, simulation: false };

/**
 * A smart trainer (or power meter). Detects the protocol automatically and offers
 * one control API: `setTargetPower` (ERG), `setSimulation` (SIM), `freeRide`, and
 * `releaseControl` to stop controlling it and only read data.
 *
 * Control calls are cheap and can be made every frame: only the latest request is
 * kept, at most one command is in flight, and unchanged values are not resent.
 * The current mode is re-applied after an automatic reconnect, when another client
 * (e.g. a watch paired to the same trainer) took over or changed the target, and
 * every `refreshInterval` ms. Watch the `control` event (or `ergActive`) to know
 * whether the trainer really does what was asked.
 */
export class Trainer extends BleSensor {
  private readonly drivers: readonly ProtocolDriver[];
  private readonly rider: RiderProfile;
  private readonly now: () => number;
  private readonly refreshInterval: number;
  private protocol?: TrainerProtocol;
  private wanted: TrainerMode = { kind: "none" };
  private sent: TrainerMode = { kind: "none" };
  private applying = false;
  /** The last command was refused/failed; cleared by the next success. */
  private failed = false;
  private lastError?: string;
  private lastSentAt = 0;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private lastControl?: TrainerControl;

  constructor(options: TrainerOptions = {}) {
    super(options);
    this.drivers = options.drivers ?? defaultDrivers;
    this.rider = { ...riderDefaults, ...options.rider };
    this.now = options.now ?? (() => performance.now());
    this.refreshInterval = options.refreshInterval ?? 5000;
  }

  /** Detected protocol, once connected. */
  get protocolName(): ProtocolName | undefined {
    return this.protocol?.name;
  }
  /** What can be controlled right now. False while another client (e.g. a watch) holds control. */
  get capabilities(): TrainerCapabilities {
    return this.protocol?.capabilities ?? NO_CAPABILITIES;
  }
  /** The trainer could be controlled, but another app or device (e.g. a watch) holds control. Retried automatically. */
  get controlDenied(): boolean {
    return this.status === "connected" && (this.protocol?.controlDenied ?? false);
  }
  get powerRange(): { min: number; max: number } | undefined {
    return this.protocol?.powerRange;
  }
  /** The mode most recently requested (applied as soon as possible). */
  get mode(): TrainerMode {
    return this.wanted;
  }
  /** True when an ERG target is requested and the trainer accepted it, i.e. the trainer really holds the wattage. */
  get ergActive(): boolean {
    return this.wanted.kind === "erg" && this.capabilities.erg && this.status === "connected" && !this.failed;
  }
  /** Snapshot of `capabilities`, `controlDenied` and `ergActive` (also delivered by the `control` event). */
  get control(): TrainerControl {
    return { capabilities: { ...this.capabilities }, controlDenied: this.controlDenied, ergActive: this.ergActive };
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
      // Several drivers may subscribe while probing; only the chosen one's data and events are used.
      let protocol: TrainerProtocol | undefined;
      const isActive = () => protocol !== undefined && protocol === this.protocol;
      const ctx: ProtocolContext = {
        rider: this.rider,
        now: this.now,
        emit: (data) => {
          if (protocol && protocol === active) this.updateData(data);
        },
        warn: (error) => this.reportError(new Error(`${driver.name}: ${error.message}`)),
        controlChanged: () => {
          if (isActive()) this.updateControl();
        },
        overridden: () => {
          if (isActive()) this.resend();
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
      // Read-only for now (no control, or another client holds it): keep looking for one with control.
      fallback ??= protocol;
    }
    active ??= fallback;
    if (!active) throw new Error("Device does not speak any supported trainer protocol");
    this.protocol = active;
    this.sent = { kind: "none" };
    this.failed = false;
    this.lastError = undefined;
    this.startRefresh();
    void this.apply();
  }

  protected teardown(): void {
    this.protocol = undefined;
    this.sent = { kind: "none" };
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    this.updateControl();
  }

  /** Status changes also change what `control` reports. */
  protected override onStatusChanged(): void {
    this.updateControl();
  }

  private request(mode: TrainerMode): void {
    this.wanted = mode;
    if (mode.kind === "none") this.failed = false;
    this.updateControl();
    void this.apply();
  }

  /** Send the wanted mode again, even if unchanged (another client changed the trainer, or refresh). */
  private resend(): void {
    if (!this.protocol || this.wanted.kind === "none") return;
    this.sent = { kind: "none" };
    void this.apply();
  }

  private startRefresh(): void {
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    if (this.refreshInterval <= 0) return;
    this.refreshTimer = setInterval(
      () => {
        if (!this.applying && this.now() - this.lastSentAt >= this.refreshInterval) this.resend();
      },
      Math.min(1000, this.refreshInterval),
    );
  }

  private async apply(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      while (this.protocol && !sameMode(this.wanted, this.sent)) {
        const protocol = this.protocol;
        const mode = this.wanted;
        let ok = true;
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
          ok = false;
          // The same refusal repeats on every retry: report it once until something works again.
          const message = error instanceof Error ? error.message : String(error);
          if (message !== this.lastError) this.reportError(error);
          this.lastError = message;
        }
        this.lastSentAt = this.now();
        if (this.protocol !== protocol) continue;
        // Mark as handled even on failure so a rejected command is not retried in a loop
        // (the refresh timer tries again later).
        this.sent = mode;
        if (ok) this.lastError = undefined;
        if (mode.kind !== "none") this.failed = !ok;
        this.updateControl();
      }
    } finally {
      this.applying = false;
    }
  }

  /** Emit `control` when capabilities, controlDenied or ergActive changed. */
  private updateControl(): void {
    const next = this.control;
    const prev = this.lastControl;
    if (
      prev &&
      prev.capabilities.erg === next.capabilities.erg &&
      prev.capabilities.simulation === next.capabilities.simulation &&
      prev.controlDenied === next.controlDenied &&
      prev.ergActive === next.ergActive
    ) {
      return;
    }
    this.lastControl = next;
    this.emit("control", next);
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
