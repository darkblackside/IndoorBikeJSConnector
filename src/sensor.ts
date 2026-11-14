import { Emitter } from "./emitter.ts";
import { delay } from "./gatt.ts";
import type { BikeData, BluetoothLike, ConnectionStatus } from "./types.ts";

export interface SensorEvents extends Record<string, unknown> {
  status: ConnectionStatus;
  /** Full snapshot of this device's values after every update. */
  data: Readonly<BikeData>;
  /** Non-fatal problems (failed command, reconnect attempt failed, …). */
  error: Error;
}

export interface SensorOptions {
  /** Defaults to `navigator.bluetooth`. Inject a polyfill/mock for Node, Electron or tests. */
  bluetooth?: BluetoothLike;
  /** Reconnect automatically when the link drops unexpectedly. Default true. */
  autoReconnect?: boolean;
  /** Delays between reconnect attempts in ms. Default [1000, 2000, 5000, 10000, 20000]. */
  reconnectDelays?: readonly number[];
}

export interface ConnectOptions {
  /** Use an already selected device (e.g. from `navigator.bluetooth.getDevices()`) instead of opening the chooser. */
  device?: BluetoothDevice;
}

/** Shared connect / disconnect / auto-reconnect handling for one BLE peripheral. */
export abstract class BleSensor extends Emitter<SensorEvents> {
  private _status: ConnectionStatus = "disconnected";
  private _data: BikeData = {};
  private _device?: BluetoothDevice;
  private userDisconnected = false;
  private readonly options: Required<Omit<SensorOptions, "bluetooth">> & Pick<SensorOptions, "bluetooth">;

  constructor(options: SensorOptions = {}) {
    super();
    this.options = {
      bluetooth: options.bluetooth,
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelays: options.reconnectDelays ?? [1000, 2000, 5000, 10000, 20000],
    };
  }

  get status(): ConnectionStatus {
    return this._status;
  }
  get data(): Readonly<BikeData> {
    return this._data;
  }
  get device(): BluetoothDevice | undefined {
    return this._device;
  }
  get deviceName(): string | undefined {
    return this._device?.name;
  }

  /**
   * Connect. Without `options.device` this opens the browser's device chooser,
   * which must be triggered by a user gesture (click/keypress).
   */
  async connect(options: ConnectOptions = {}): Promise<void> {
    const device = options.device ?? (await this.bluetooth().requestDevice(this.requestOptions()));
    if (!device.gatt) throw new Error(`${device.name ?? "Device"} has no GATT server`);
    if (this._device && this._device !== device) this.disconnect();

    this._device?.removeEventListener("gattserverdisconnected", this.onGattDisconnected);
    this._device = device;
    device.addEventListener("gattserverdisconnected", this.onGattDisconnected);
    this.userDisconnected = false;

    this.setStatus("connecting");
    try {
      await this.open(device);
      this.setStatus("connected");
    } catch (error) {
      this.userDisconnected = true; // no auto-reconnect for a failed initial connect
      device.gatt.disconnect();
      this.teardown();
      this.setStatus("disconnected");
      throw error;
    }
  }

  disconnect(): void {
    this.userDisconnected = true;
    if (this._device?.gatt?.connected) {
      this._device.gatt.disconnect(); // fires gattserverdisconnected
    } else if (this._status !== "disconnected") {
      this.teardown();
      this.setStatus("disconnected");
    }
  }

  protected abstract requestOptions(): RequestDeviceOptions;
  /** Discover services, start notifications. Called on connect and every reconnect. */
  protected abstract setup(server: BluetoothRemoteGATTServer): Promise<void>;
  /** Forget per-connection state. */
  protected abstract teardown(): void;

  protected updateData(patch: BikeData): void {
    let changed = false;
    const next = { ...this._data };
    for (const [key, value] of Object.entries(patch) as [keyof BikeData, number | undefined][]) {
      if (value !== undefined && next[key] !== value) {
        next[key] = value;
        changed = true;
      }
    }
    if (changed) {
      this._data = next;
      this.emit("data", next);
    }
  }

  protected clearData(): void {
    this._data = {};
    this.emit("data", this._data);
  }

  protected reportError(error: unknown): void {
    this.emit("error", error instanceof Error ? error : new Error(String(error)));
  }

  private bluetooth(): BluetoothLike {
    const bt = this.options.bluetooth ?? (globalThis.navigator as Navigator | undefined)?.bluetooth;
    if (!bt) throw new Error("Web Bluetooth is not available (use Chrome/Edge over https or localhost)");
    return bt;
  }

  private async open(device: BluetoothDevice): Promise<void> {
    const server = await device.gatt!.connect();
    await this.setup(server);
  }

  private onGattDisconnected = (): void => {
    this.teardown();
    if (this.userDisconnected || !this.options.autoReconnect) {
      this.setStatus("disconnected");
      return;
    }
    void this.reconnect();
  };

  private async reconnect(): Promise<void> {
    const device = this._device;
    if (!device) return;
    this.setStatus("reconnecting");
    for (const wait of this.options.reconnectDelays) {
      await delay(wait);
      if (this.userDisconnected || this._device !== device) return;
      try {
        await this.open(device);
        this.setStatus("connected");
        return;
      } catch (error) {
        this.reportError(error);
        this.teardown();
      }
    }
    this.setStatus("disconnected");
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this._status) return;
    this._status = status;
    if (status !== "connected") this.clearData();
    this.emit("status", status);
  }
}
