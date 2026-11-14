import { getCharacteristicOrUndefined, getServiceOrUndefined, SerialQueue, subscribe, write } from "../gatt.ts";
import {
  encodeFecTargetPower,
  encodeFecTrackResistance,
  encodeFecUserConfiguration,
  encodeFecWindResistance,
  FecPage,
  parseFecPage,
  unwrapFecMessage,
} from "../parsers/fec.ts";
import type { ResolvedSimulationParams } from "../types.ts";
import { Characteristic, Service } from "../uuids.ts";
import type { ProtocolContext, ProtocolDriver, TrainerProtocol } from "./protocol.ts";

/** ANT+ FE-C tunnelled over BLE: Tacx Neo/Flux/Vortex/Bushido/Genius, some Elite models. */
export const tacxFecDriver: ProtocolDriver = {
  name: "tacx-fec",
  services: [Service.tacxFec],
  async connect(server, ctx) {
    const service = await getServiceOrUndefined(server, Service.tacxFec);
    if (!service) return undefined;
    const read = await getCharacteristicOrUndefined(service, Characteristic.tacxFecRead);
    const writeChar = await getCharacteristicOrUndefined(service, Characteristic.tacxFecWrite);
    if (!read || !writeChar) return undefined;
    const protocol = new TacxFecProtocol(writeChar, ctx);
    await subscribe(read, protocol.onMessage);
    return protocol;
  },
};

class TacxFecProtocol implements TrainerProtocol {
  readonly name = "tacx-fec" as const;
  readonly capabilities = { erg: true, simulation: true };
  private queue = new SerialQueue();
  private userConfigSent = false;
  private wind?: { cw: number; windSpeed: number };
  private distance = { total: 0, last: undefined as number | undefined };

  constructor(
    private readonly writeChar: BluetoothRemoteGATTCharacteristic,
    private readonly ctx: ProtocolContext,
  ) {}

  onMessage = (value: DataView) => {
    const pageView = unwrapFecMessage(value);
    const page = pageView && parseFecPage(pageView);
    if (!page) return;
    if (page.page === FecPage.SpecificTrainerData) {
      this.ctx.emit({ power: page.power, cadence: page.cadence });
    } else {
      let distance: number | undefined;
      if (page.distance !== undefined) {
        const d = this.distance;
        if (d.last !== undefined) d.total += (page.distance - d.last + 256) % 256;
        d.last = page.distance;
        distance = d.total;
      }
      this.ctx.emit({ speed: page.speed, heartRate: page.heartRate, distance });
    }
  };

  async setTargetPower(watts: number) {
    await this.ensureUserConfig();
    await this.send(encodeFecTargetPower(watts));
  }

  async setSimulation(p: ResolvedSimulationParams) {
    await this.ensureUserConfig();
    if (!this.wind || this.wind.cw !== p.cw || this.wind.windSpeed !== p.windSpeed) {
      await this.send(encodeFecWindResistance(p.cw, p.windSpeed));
      this.wind = { cw: p.cw, windSpeed: p.windSpeed };
    }
    await this.send(encodeFecTrackResistance(p.grade, p.crr));
  }

  private async ensureUserConfig() {
    if (this.userConfigSent) return;
    const { riderWeight, bikeWeight, wheelCircumference } = this.ctx.rider;
    await this.send(encodeFecUserConfiguration(riderWeight, bikeWeight, wheelCircumference));
    this.userConfigSent = true;
  }

  private send(bytes: Uint8Array<ArrayBuffer>) {
    return this.queue.run(() => write(this.writeChar, bytes));
  }
}
