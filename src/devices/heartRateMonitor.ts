import { parseHeartRate } from "../ftms/heartRate.ts";
import { Characteristics, Services } from "../ftms/uuids.ts";
import { Sensor } from "./sensor.ts";

/** Any standard BLE heart rate strap (Heart Rate Service 0x180D). */
export class HeartRateMonitor extends Sensor {
  protected readonly key = "heartRateMonitor" as const;
  protected readonly requestOptions: RequestDeviceOptions = {
    filters: [{ services: [Services.heartRate] }],
  };

  protected override async setup(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(Services.heartRate);
    const measurement = await service.getCharacteristic(Characteristics.heartRateMeasurement);
    measurement.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.store.update({ heartRate: parseHeartRate(value) });
    });
    await measurement.startNotifications();
  }

  protected override reset(): void {
    this.store.update({ heartRate: undefined });
  }
}
