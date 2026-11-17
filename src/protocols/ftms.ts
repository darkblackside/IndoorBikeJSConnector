import { getCharacteristicOrUndefined, getServiceOrUndefined, SerialQueue, subscribe } from "../gatt.ts";
import {
  encodeRequestControl,
  encodeSetIndoorBikeSimulation,
  encodeSetTargetPower,
  encodeStartOrResume,
  FtmsResult,
  ftmsResultName,
  parseFitnessMachineFeature,
  parseFitnessMachineStatus,
  parseFtmsResponse,
  parseIndoorBikeData,
  parsePowerRange,
} from "../parsers/ftms.ts";
import type { ResolvedSimulationParams, TrainerCapabilities } from "../types.ts";
import { Characteristic, Service } from "../uuids.ts";
import { UnsupportedError, type ProtocolContext, type ProtocolDriver, type TrainerProtocol } from "./protocol.ts";

const RESPONSE_TIMEOUT_MS = 3000;
/** After control was refused, wait this long before asking again (avoids a request per frame). */
const CONTROL_RETRY_MS = 5000;
const NO_CAPABILITIES: TrainerCapabilities = { erg: false, simulation: false };

/** Message used when another client (app or watch) holds control of the trainer. */
export const CONTROL_DENIED_MESSAGE =
  "FTMS: control not permitted (another app or device, e.g. a watch, is controlling the trainer)";

/**
 * Bluetooth Fitness Machine Service: the standard protocol of current trainers
 * (Wahoo KICKR with recent firmware, Tacx/Garmin, Elite, Saris, JetBlack, Zwift Hub, Wattbike…).
 *
 * Several clients can be connected to one trainer at the same time (e.g. this app and a
 * Garmin watch), but FTMS lets only one of them control it. If another client holds
 * control, the trainer still delivers data and every command tries to take control back
 * (at most every few seconds). Changes made by another client are seen through the
 * Fitness Machine Status characteristic and reported as `overridden`, so the trainer
 * sends its own mode again.
 */
export const ftmsDriver: ProtocolDriver = {
  name: "ftms",
  services: [Service.fitnessMachine],
  async connect(server, ctx) {
    const service = await getServiceOrUndefined(server, Service.fitnessMachine);
    if (!service) return undefined;
    const bikeData = await getCharacteristicOrUndefined(service, Characteristic.indoorBikeData);
    if (!bikeData) return undefined; // treadmill/rower etc.
    const protocol = new FtmsProtocol(ctx);
    await protocol.start(service, bikeData);
    return protocol;
  },
};

type LastTarget = { kind: "erg"; watts: number } | { kind: "simulation"; grade: number };

class FtmsProtocol implements TrainerProtocol {
  readonly name = "ftms" as const;
  powerRange?: { min: number; max: number };

  /** What the trainer supports (Fitness Machine Feature), independent of who controls it. */
  private supported: TrainerCapabilities = NO_CAPABILITIES;
  private hasControl = false;
  /** When control was last refused; undefined while not refused. */
  private deniedAt?: number;
  /** A stop/pause by another client: send Start before the next command. */
  private needStart = false;
  /** Our latest target, to tell our own status notifications from another client's. */
  private last?: LastTarget;
  private controlPoint?: BluetoothRemoteGATTCharacteristic;
  private queue = new SerialQueue();
  private pending?: { opCode: number; resolve: (result: number) => void };

  constructor(private readonly ctx: ProtocolContext) {}

  get capabilities(): TrainerCapabilities {
    return this.hasControl ? this.supported : NO_CAPABILITIES;
  }
  get controlDenied(): boolean {
    return !this.hasControl && this.deniedAt !== undefined && (this.supported.erg || this.supported.simulation);
  }

  async start(service: BluetoothRemoteGATTService, bikeData: BluetoothRemoteGATTCharacteristic) {
    await subscribe(bikeData, (value) => {
      const d = parseIndoorBikeData(value);
      this.ctx.emit({
        power: d.instantaneousPower,
        cadence: d.instantaneousCadence,
        speed: d.instantaneousSpeed,
        distance: d.totalDistance,
        heartRate: d.heartRate,
      });
    });

    let powerSupported = true;
    let simSupported = true;
    const feature = await getCharacteristicOrUndefined(service, Characteristic.fitnessMachineFeature);
    if (feature) {
      try {
        const f = parseFitnessMachineFeature(await feature.readValue());
        powerSupported = f.powerTargetSupported;
        simSupported = f.simulationSupported;
      } catch {
        // keep optimistic defaults
      }
    }

    const range = await getCharacteristicOrUndefined(service, Characteristic.supportedPowerRange);
    if (range) {
      try {
        const r = parsePowerRange(await range.readValue());
        this.powerRange = { min: r.min, max: r.max };
      } catch {
        // optional
      }
    }

    // Optional: lets us notice when another client takes over or changes the target.
    const status = await getCharacteristicOrUndefined(service, Characteristic.fitnessMachineStatus);
    if (status) await subscribe(status, this.onStatus).catch(() => undefined);

    this.controlPoint = await getCharacteristicOrUndefined(service, Characteristic.fitnessMachineControlPoint);
    if (!this.controlPoint) return;
    await subscribe(this.controlPoint, this.onResponse);
    this.supported = { erg: powerSupported, simulation: simSupported };
    // Not fatal when refused (e.g. a watch holds control): data still flows and commands retry later.
    const error = await this.queue.run(() => this.takeControl());
    if (error) this.ctx.warn?.(error);
  }

  async setTargetPower(watts: number) {
    if (!this.supported.erg) throw new UnsupportedError(this.name, "ERG");
    this.last = { kind: "erg", watts: Math.round(watts) };
    await this.command(encodeSetTargetPower(watts));
  }

  async setSimulation(p: ResolvedSimulationParams) {
    if (!this.supported.simulation) throw new UnsupportedError(this.name, "Simulation");
    this.last = { kind: "simulation", grade: Math.round(p.grade * 100) / 100 };
    await this.command(encodeSetIndoorBikeSimulation(p));
  }

  /** Send a control request, taking control first if needed; requests are serialized. */
  private command(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    return this.queue.run(async () => {
      if (!this.hasControl) {
        const error = await this.takeControl();
        if (error) throw error;
      }
      if (this.needStart) {
        this.needStart = false;
        await this.exchange(encodeStartOrResume()).catch(() => undefined);
      }
      let result = await this.exchange(bytes);
      if (result === FtmsResult.ControlNotPermitted) {
        // Another client took control without us noticing: try to take it back once.
        this.setControl(false);
        const error = await this.takeControl();
        if (error) throw error;
        result = await this.exchange(bytes);
      }
      if (result === FtmsResult.ControlNotPermitted) {
        this.setControl(false);
        throw new Error(CONTROL_DENIED_MESSAGE);
      }
      if (result !== FtmsResult.Success) throw new Error(`FTMS: ${ftmsResultName(result)}`);
    });
  }

  /** Request Control (+ Start). Resolves an error when refused. Call inside the queue. */
  private async takeControl(): Promise<Error | undefined> {
    if (this.deniedAt !== undefined && this.ctx.now() - this.deniedAt < CONTROL_RETRY_MS) {
      return new Error(CONTROL_DENIED_MESSAGE);
    }
    let error: Error | undefined;
    try {
      const result = await this.exchange(encodeRequestControl());
      if (result === FtmsResult.ControlNotPermitted) error = new Error(CONTROL_DENIED_MESSAGE);
      else if (result !== FtmsResult.Success) error = new Error(`FTMS: ${ftmsResultName(result)}`);
    } catch (e) {
      error = e as Error;
    }
    if (error) {
      this.deniedAt = this.ctx.now();
      this.setControl(false, true);
      return error;
    }
    this.deniedAt = undefined;
    this.needStart = false;
    await this.exchange(encodeStartOrResume()).catch(() => undefined); // optional on many trainers
    this.setControl(true);
    return undefined;
  }

  private setControl(granted: boolean, force = false) {
    if (this.hasControl === granted && !force) return;
    this.hasControl = granted;
    this.ctx.controlChanged?.();
  }

  /** Write one request and wait for its indication; resolves the FTMS result code. */
  private async exchange(bytes: Uint8Array<ArrayBuffer>): Promise<number> {
    const cp = this.controlPoint;
    if (!cp) throw new Error("FTMS control point not available");
    const opCode = bytes[0]!;
    const response = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error(`FTMS: no response to op code 0x${opCode.toString(16)}`));
      }, RESPONSE_TIMEOUT_MS);
      this.pending = { opCode, resolve: (r) => (clearTimeout(timer), resolve(r)) };
    });
    try {
      await cp.writeValueWithResponse(bytes);
    } catch (error) {
      this.pending = undefined;
      response.catch(() => undefined);
      throw error;
    }
    return response;
  }

  private onResponse = (value: DataView) => {
    const r = parseFtmsResponse(value);
    if (r && this.pending?.opCode === r.requestOpCode) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve(r.resultCode);
    }
  };

  /** Fitness Machine Status: also reports what other clients did to the trainer. */
  private onStatus = (value: DataView) => {
    const s = parseFitnessMachineStatus(value);
    if (!s) return;
    const last = this.last;
    switch (s.kind) {
      case "control-lost":
      case "reset":
        // Another client took control (and/or reset the trainer, which clears targets).
        this.last = undefined;
        this.setControl(false);
        this.ctx.overridden?.();
        break;
      case "stopped":
        this.needStart = true;
        this.ctx.overridden?.();
        break;
      case "target-power":
        if (last?.kind !== "erg" || last.watts !== s.watts) this.ctx.overridden?.();
        break;
      case "simulation":
        if (last?.kind !== "simulation" || Math.abs(last.grade - s.grade) > 0.005) this.ctx.overridden?.();
        break;
    }
  };
}
