import { getCharacteristicOrUndefined, getServiceOrUndefined, SerialQueue, subscribe, write } from "../gatt.ts";
import {
  encodeFecSpinDownRequest,
  encodeFecTargetPower,
  encodeFecTrackResistance,
  encodeFecUserConfiguration,
  encodeFecWindResistance,
  FecPage,
  parseFecPage,
  type FecCalibrationProgress,
  type FecCalibrationResponse,
  unwrapFecMessage,
} from "../parsers/fec.ts";
import type { ResolvedSimulationParams, SpinDownProgress, SpinDownResult } from "../types.ts";
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
  readonly spinDownSupported = true;
  private calibration?: (page: FecCalibrationProgress | FecCalibrationResponse) => void;
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
    if (page.page === FecPage.CalibrationInProgress || page.page === FecPage.CalibrationRequestResponse) {
      this.calibration?.(page);
    } else if (page.page === FecPage.SpecificTrainerData) {
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

  /** Spin-down via the FE-C calibration pages: request (page 1), progress (page 2), result (page 1). */
  async spinDown(onProgress: (p: SpinDownProgress) => void, signal: AbortSignal): Promise<SpinDownResult> {
    await this.ensureUserConfig();
    return new Promise<SpinDownResult>((resolve, reject) => {
      let phase: SpinDownProgress["phase"] | undefined;
      const finish = (result: SpinDownResult) => {
        this.calibration = undefined;
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => finish({ ok: false, message: String(signal.reason ?? "cancelled") });
      signal.addEventListener("abort", onAbort);
      this.calibration = (page) => {
        if (page.page === FecPage.CalibrationRequestResponse) {
          finish(
            page.spinDownSuccess
              ? { ok: true, spinDownTime: page.spinDownTime }
              : { ok: false, message: "the trainer reported a failed spin-down" },
          );
          return;
        }
        const next = page.speedCondition === "ok" ? "coast" : "speed-up";
        if (next === phase) return;
        phase = next;
        const s = page.targetSpeed;
        onProgress({ phase: next, targetSpeed: s === undefined ? undefined : { low: s, high: s } });
      };
      this.send(encodeFecSpinDownRequest()).catch((error) => {
        this.calibration = undefined;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
    });
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
