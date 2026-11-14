import * as cp from "../ftms/controlPoint.ts";
import { parseIndoorBikeData } from "../ftms/indoorBikeData.ts";
import { Characteristics, Services } from "../ftms/uuids.ts";
import { Sensor } from "./sensor.ts";

const RESPONSE_TIMEOUT_MS = 3000;

/**
 * Smart trainer speaking the Bluetooth Fitness Machine Service (FTMS).
 * Covers the Wahoo KICKR / KICKR CORE (firmware with FTMS enabled) as well as
 * most current trainers from Tacx, Elite, Saris, JetBlack, Zwift Hub, etc.
 */
export class FtmsTrainer extends Sensor {
  protected readonly key = "trainer" as const;
  protected readonly requestOptions: RequestDeviceOptions = {
    filters: [{ services: [Services.fitnessMachine] }],
  };

  private controlPoint?: BluetoothRemoteGATTCharacteristic;
  private pendingResponse?: { opCode: number; resolve: (result: number) => void };
  private queue: Promise<unknown> = Promise.resolve();
  /** Latest requested target; writes are coalesced so a fast slider does not flood the trainer. */
  private wantedPower?: number;
  private sentPower?: number;
  private applying = false;

  protected override async setup(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(Services.fitnessMachine);

    const bikeData = await service.getCharacteristic(Characteristics.indoorBikeData);
    bikeData.addEventListener("characteristicvaluechanged", this.onBikeData);
    await bikeData.startNotifications();

    try {
      const range = await service.getCharacteristic(Characteristics.supportedPowerRange);
      this.store.update({ powerRange: cp.parsePowerRange(await range.readValue()) });
    } catch {
      // optional characteristic
    }

    try {
      this.controlPoint = await service.getCharacteristic(Characteristics.fitnessMachineControlPoint);
      this.controlPoint.addEventListener("characteristicvaluechanged", this.onControlPointResponse);
      await this.controlPoint.startNotifications(); // control point uses indications
      await this.command(cp.requestControl());
      await this.command(cp.startOrResume()).catch(() => undefined); // not all trainers need/support it
      this.store.update({ ergAvailable: true });
      this.sentPower = undefined;
      if (this.wantedPower !== undefined) void this.applyPower();
    } catch (error) {
      this.controlPoint = undefined;
      this.store.update({ ergAvailable: false });
      this.store.log(`ERG control unavailable: ${(error as Error).message}`);
    }
  }

  protected override reset(): void {
    this.controlPoint = undefined;
    this.pendingResponse = undefined;
    this.sentPower = undefined;
    this.store.update({
      power: undefined,
      cadence: undefined,
      speed: undefined,
      distance: undefined,
      ergAvailable: false,
      powerRange: undefined,
    });
  }

  /** Set (or with undefined: stop sending) the ERG target. Safe to call at any rate. */
  setTargetPower(watts: number | undefined): void {
    this.wantedPower = watts;
    void this.applyPower();
  }

  private async applyPower(): Promise<void> {
    if (this.applying || !this.controlPoint) return;
    this.applying = true;
    try {
      while (this.controlPoint && this.wantedPower !== this.sentPower) {
        const watts = this.wantedPower;
        if (watts === undefined) {
          // Leave ERG: switch to simulation mode on a flat road so the rider controls the effort.
          await this.command(cp.setIndoorBikeSimulation(0));
          this.store.log("ERG off (free ride, flat road)");
        } else {
          await this.command(cp.setTargetPower(watts));
          this.store.log(`Target power set to ${watts} W`);
        }
        this.sentPower = watts;
      }
    } catch (error) {
      this.store.log(`Setting target power failed: ${(error as Error).message}`);
    } finally {
      this.applying = false;
    }
  }

  /** Write one control point request and wait for its indication. Requests are serialized. */
  private command(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const run = async () => {
      const characteristic = this.controlPoint;
      if (!characteristic) throw new Error("not connected");
      const opCode = bytes[0]!;
      const response = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingResponse = undefined;
          reject(new Error(`no response to op code 0x${opCode.toString(16)}`));
        }, RESPONSE_TIMEOUT_MS);
        this.pendingResponse = {
          opCode,
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
        };
      });
      await characteristic.writeValueWithResponse(bytes);
      const result = await response;
      if (result !== cp.ResultCode.Success) throw new Error(cp.resultName(result));
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private onControlPointResponse = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    const response = value && cp.parseResponse(value);
    if (response && this.pendingResponse?.opCode === response.requestOpCode) {
      const { resolve } = this.pendingResponse;
      this.pendingResponse = undefined;
      resolve(response.resultCode);
    }
  };

  private onBikeData = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const data = parseIndoorBikeData(value);
    const state = this.store.get();
    this.store.update({
      power: data.instantaneousPower ?? state.power,
      cadence: data.instantaneousCadence ?? state.cadence,
      speed: data.instantaneousSpeed ?? state.speed,
      distance: data.totalDistance ?? state.distance,
      // Prefer a dedicated strap; fall back to HR forwarded by the trainer.
      heartRate:
        state.heartRateMonitor.status === "connected" ? state.heartRate : (data.heartRate ?? state.heartRate),
    });
  };
}
