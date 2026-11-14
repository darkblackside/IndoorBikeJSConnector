import { getCharacteristicOrUndefined, getServiceOrUndefined, SerialQueue, subscribe } from "../gatt.ts";
import {
  encodeRequestControl,
  encodeSetIndoorBikeSimulation,
  encodeSetTargetPower,
  encodeStartOrResume,
  FtmsResult,
  ftmsResultName,
  parseFitnessMachineFeature,
  parseFtmsResponse,
  parseIndoorBikeData,
  parsePowerRange,
} from "../parsers/ftms.ts";
import type { ResolvedSimulationParams, TrainerCapabilities } from "../types.ts";
import { Characteristic, Service } from "../uuids.ts";
import { UnsupportedError, type ProtocolContext, type ProtocolDriver, type TrainerProtocol } from "./protocol.ts";

const RESPONSE_TIMEOUT_MS = 3000;

/**
 * Bluetooth Fitness Machine Service: the standard protocol of current trainers
 * (Wahoo KICKR with recent firmware, Tacx/Garmin, Elite, Saris, JetBlack, Zwift Hub, Wattbike…).
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

class FtmsProtocol implements TrainerProtocol {
  readonly name = "ftms" as const;
  capabilities: TrainerCapabilities = { erg: false, simulation: false };
  powerRange?: { min: number; max: number };

  private controlPoint?: BluetoothRemoteGATTCharacteristic;
  private queue = new SerialQueue();
  private pending?: { opCode: number; resolve: (result: number) => void };

  constructor(private readonly ctx: ProtocolContext) {}

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

    this.controlPoint = await getCharacteristicOrUndefined(service, Characteristic.fitnessMachineControlPoint);
    if (!this.controlPoint) return;
    await subscribe(this.controlPoint, this.onResponse);
    await this.command(encodeRequestControl());
    await this.command(encodeStartOrResume()).catch(() => undefined); // optional on many trainers
    this.capabilities = { erg: powerSupported, simulation: simSupported };
  }

  async setTargetPower(watts: number) {
    if (!this.capabilities.erg) throw new UnsupportedError(this.name, "ERG");
    await this.command(encodeSetTargetPower(watts));
  }

  async setSimulation(p: ResolvedSimulationParams) {
    if (!this.capabilities.simulation) throw new UnsupportedError(this.name, "Simulation");
    await this.command(encodeSetIndoorBikeSimulation(p));
  }

  /** Write a request and wait for its indication; requests are serialized. */
  private command(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    return this.queue.run(async () => {
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
      const result = await response;
      if (result !== FtmsResult.Success) throw new Error(`FTMS: ${ftmsResultName(result)}`);
    });
  }

  private onResponse = (value: DataView) => {
    const r = parseFtmsResponse(value);
    if (r && this.pending?.opCode === r.requestOpCode) {
      const { resolve } = this.pending;
      this.pending = undefined;
      resolve(r.resultCode);
    }
  };
}
