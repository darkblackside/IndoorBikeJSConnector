import { subscribe } from "./gatt.ts";
import { parseHeartRate } from "./parsers/heartRate.ts";
import { BleSensor } from "./sensor.ts";
import { Characteristic, Service } from "./uuids.ts";

/** Any standard BLE heart rate strap/watch broadcasting the Heart Rate Service. */
export class HeartRateMonitor extends BleSensor {
  protected requestOptions(): RequestDeviceOptions {
    return { filters: [{ services: [Service.heartRate] }] };
  }

  protected async setup(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(Service.heartRate);
    const measurement = await service.getCharacteristic(Characteristic.heartRateMeasurement);
    await subscribe(measurement, (value) => this.updateData({ heartRate: parseHeartRate(value) }));
  }

  protected teardown(): void {}
}
