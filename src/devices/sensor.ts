import type { Connection, State, Store } from "../store.ts";

export type ConnectionKey = "trainer" | "heartRateMonitor";

/** Base class for one Web Bluetooth peripheral: handles chooser, connect and disconnect. */
export abstract class Sensor {
  protected abstract readonly key: ConnectionKey;
  protected abstract readonly requestOptions: RequestDeviceOptions;
  protected device?: BluetoothDevice;

  constructor(protected readonly store: Store) {}

  get connected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  /** Opens the browser's device chooser. Must be called from a user gesture (click). */
  async connect(): Promise<void> {
    const device = await navigator.bluetooth.requestDevice(this.requestOptions);
    if (!device.gatt) throw new Error(`${device.name ?? "Device"} has no GATT server`);

    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    this.device = device;
    device.addEventListener("gattserverdisconnected", this.handleDisconnect);

    this.setConnection({ status: "connecting", name: device.name });
    try {
      const server = await device.gatt.connect();
      await this.setup(server);
      this.setConnection({ status: "connected", name: device.name });
      this.store.log(`Connected to ${device.name ?? "device"}`);
    } catch (error) {
      device.gatt.disconnect();
      this.setConnection({ status: "disconnected" });
      throw error;
    }
  }

  disconnect(): void {
    this.device?.gatt?.disconnect();
  }

  /** Discover services/characteristics and start notifications. */
  protected abstract setup(server: BluetoothRemoteGATTServer): Promise<void>;

  /** Clear live values owned by this sensor. */
  protected abstract reset(): void;

  private handleDisconnect = (): void => {
    this.reset();
    this.setConnection({ status: "disconnected" });
    this.store.log(`${this.device?.name ?? "Device"} disconnected`);
  };

  private setConnection(connection: Connection): void {
    this.store.update({ [this.key]: connection } as Partial<State>);
  }
}
