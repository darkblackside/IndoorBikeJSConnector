import { getCharacteristicOrUndefined, getServiceOrUndefined, SerialQueue, subscribe, write } from "../gatt.ts";
import { parseCyclingPowerMeasurement, RevolutionRate } from "../parsers/cyclingPower.ts";
import {
  encodeWahooErg,
  encodeWahooGrade,
  encodeWahooSimMode,
  encodeWahooUnlock,
  encodeWahooWheelCircumference,
  encodeWahooWindSpeed,
} from "../parsers/wahoo.ts";
import type { ResolvedSimulationParams } from "../types.ts";
import { Characteristic, Service } from "../uuids.ts";
import { UnsupportedError, type ProtocolContext, type ProtocolDriver, type TrainerProtocol } from "./protocol.ts";

/** Subscribes to Cycling Power Measurement and derives cadence/speed/distance from the revolution counters. */
async function startPowerMeasurement(service: BluetoothRemoteGATTService, ctx: ProtocolContext) {
  const measurement = await service.getCharacteristic(Characteristic.cyclingPowerMeasurement);
  const crank = new RevolutionRate(0x10000, 1024);
  const wheel = new RevolutionRate(0x100000000, 2048);
  let firstWheelRevs: number | undefined;
  await subscribe(measurement, (value) => {
    const m = parseCyclingPowerMeasurement(value);
    const now = ctx.now();
    const crankRate = m.crank && crank.update(m.crank, now);
    const wheelRate = m.wheel && wheel.update(m.wheel, now);
    if (m.wheel && firstWheelRevs === undefined) firstWheelRevs = m.wheel.revolutions;
    ctx.emit({
      power: m.power,
      cadence: crankRate === undefined ? undefined : crankRate * 60,
      speed: wheelRate === undefined ? undefined : wheelRate * ctx.rider.wheelCircumference * 3.6,
      distance:
        m.wheel && firstWheelRevs !== undefined
          ? ((m.wheel.revolutions - firstWheelRevs) >>> 0) * ctx.rider.wheelCircumference
          : undefined,
    });
  });
}

/** Any Cycling Power Service device (power meter, or a trainer without a known control protocol). Read-only. */
export const cyclingPowerDriver: ProtocolDriver = {
  name: "cycling-power",
  services: [Service.cyclingPower],
  async connect(server, ctx) {
    const service = await getServiceOrUndefined(server, Service.cyclingPower);
    if (!service) return undefined;
    await startPowerMeasurement(service, ctx);
    const unsupported = (feature: string) => () => Promise.reject(new UnsupportedError("cycling-power", feature));
    return {
      name: "cycling-power",
      capabilities: { erg: false, simulation: false },
      setTargetPower: unsupported("ERG"),
      setSimulation: unsupported("Simulation"),
    } satisfies TrainerProtocol;
  },
};

/** Wahoo KICKR family before FTMS (and later ones with FTMS disabled): Cycling Power + Wahoo control point. */
export const wahooDriver: ProtocolDriver = {
  name: "wahoo",
  services: [Service.cyclingPower],
  async connect(server, ctx) {
    const service = await getServiceOrUndefined(server, Service.cyclingPower);
    if (!service) return undefined;
    const control = await getCharacteristicOrUndefined(service, Characteristic.wahooTrainer);
    if (!control) return undefined;
    await startPowerMeasurement(service, ctx);
    const protocol = new WahooProtocol(control, ctx);
    await protocol.start();
    return protocol;
  },
};

class WahooProtocol implements TrainerProtocol {
  readonly name = "wahoo" as const;
  readonly capabilities = { erg: true, simulation: true };
  private queue = new SerialQueue();
  /** Last SIM settings sent, to only resend what changed. */
  private sim?: { weight: number; crr: number; cw: number; windSpeed: number; grade: number };

  constructor(
    private readonly control: BluetoothRemoteGATTCharacteristic,
    private readonly ctx: ProtocolContext,
  ) {}

  async start() {
    // Responses are notified on the same characteristic; enabling them is required by some firmware.
    await subscribe(this.control, () => undefined).catch(() => undefined);
    await this.send(encodeWahooUnlock());
    await this.send(encodeWahooWheelCircumference(this.ctx.rider.wheelCircumference)).catch(() => undefined);
  }

  async setTargetPower(watts: number) {
    this.sim = undefined; // ERG leaves SIM mode; re-init next time
    await this.send(encodeWahooErg(watts));
  }

  async setSimulation(p: ResolvedSimulationParams) {
    const weight = this.ctx.rider.riderWeight + this.ctx.rider.bikeWeight;
    const prev = this.sim;
    if (!prev || prev.weight !== weight || prev.crr !== p.crr || prev.cw !== p.cw) {
      await this.send(encodeWahooSimMode(weight, p.crr, p.cw));
    }
    if (!prev || prev.windSpeed !== p.windSpeed) await this.send(encodeWahooWindSpeed(p.windSpeed));
    await this.send(encodeWahooGrade(p.grade));
    this.sim = { weight, crr: p.crr, cw: p.cw, windSpeed: p.windSpeed, grade: p.grade };
  }

  private send(bytes: Uint8Array<ArrayBuffer>) {
    return this.queue.run(() => write(this.control, bytes));
  }
}
