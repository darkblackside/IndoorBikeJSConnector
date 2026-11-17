/**
 * In-memory stand-ins for the Web Bluetooth GATT objects. Enough of the API for the
 * library to run against simulated devices in Node (unit tests) or the browser (demo
 * without hardware). Not part of the published library.
 */

type Props = Partial<Record<"read" | "write" | "writeWithoutResponse" | "notify" | "indicate", boolean>>;

const notFound = (what: string) => new DOMException(`${what} not found`, "NotFoundError");

export class FakeCharacteristic extends EventTarget {
  value: DataView | null = null;
  notifying = false;
  readonly properties: BluetoothCharacteristicProperties;
  /** Every value written by the client, oldest first. */
  readonly written: Uint8Array[] = [];
  /** Called for each write; use `notify()` inside to answer. */
  onWrite?: (bytes: Uint8Array) => void;
  /** Returned by readValue(). */
  readData?: () => Uint8Array;

  constructor(
    readonly service: FakeService,
    readonly uuid: string,
    props: Props,
  ) {
    super();
    this.properties = {
      broadcast: false,
      read: false,
      writeWithoutResponse: false,
      write: false,
      notify: false,
      indicate: false,
      authenticatedSignedWrites: false,
      reliableWrite: false,
      writableAuxiliaries: false,
      ...props,
    };
  }

  async startNotifications() {
    this.assertConnected();
    this.notifying = true;
    return this;
  }
  async stopNotifications() {
    this.notifying = false;
    return this;
  }
  async readValue(): Promise<DataView> {
    this.assertConnected();
    if (!this.readData) throw new DOMException("not readable", "NotSupportedError");
    this.value = toView(this.readData());
    return this.value;
  }
  async writeValueWithResponse(data: BufferSource) {
    this.handleWrite(data);
  }
  async writeValueWithoutResponse(data: BufferSource) {
    this.handleWrite(data);
  }
  async writeValue(data: BufferSource) {
    this.handleWrite(data);
  }

  /** Device → client notification/indication (delivered asynchronously, like real BLE). */
  notify(bytes: Uint8Array | number[]): void {
    if (!this.notifying || !this.service.device.gatt.connected) return;
    const view = toView(Uint8Array.from(bytes));
    queueMicrotask(() => {
      this.value = view;
      this.dispatchEvent(new Event("characteristicvaluechanged"));
    });
  }

  private handleWrite(data: BufferSource) {
    this.assertConnected();
    const bytes = new Uint8Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    this.written.push(bytes);
    this.onWrite?.(bytes);
  }

  private assertConnected() {
    if (!this.service.device.gatt.connected) throw new DOMException("GATT server is disconnected", "NetworkError");
  }
}

export class FakeService {
  readonly characteristics = new Map<string, FakeCharacteristic>();
  readonly isPrimary = true;
  constructor(
    readonly device: FakeDevice,
    readonly uuid: string,
  ) {}

  addCharacteristic(uuid: string, props: Props): FakeCharacteristic {
    const c = new FakeCharacteristic(this, uuid, props);
    this.characteristics.set(uuid, c);
    return c;
  }
  async getCharacteristic(uuid: string): Promise<FakeCharacteristic> {
    const c = this.characteristics.get(uuid);
    if (!c) throw notFound(`characteristic ${uuid}`);
    return c;
  }
  async getCharacteristics(): Promise<FakeCharacteristic[]> {
    return [...this.characteristics.values()];
  }
}

export class FakeGattServer {
  connected = false;
  /** Make the next N connect() calls fail (to test reconnect). */
  failNextConnects = 0;
  constructor(readonly device: FakeDevice) {}

  async connect() {
    if (this.failNextConnects > 0) {
      this.failNextConnects--;
      throw new DOMException("Connection failed", "NetworkError");
    }
    this.connected = true;
    return this;
  }
  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    for (const s of this.device.services.values()) for (const c of s.characteristics.values()) c.notifying = false;
    queueMicrotask(() => this.device.dispatchEvent(new Event("gattserverdisconnected")));
  }
  async getPrimaryService(uuid: string): Promise<FakeService> {
    if (!this.connected) throw new DOMException("GATT server is disconnected", "NetworkError");
    const s = this.device.services.get(uuid);
    if (!s) throw notFound(`service ${uuid}`);
    return s;
  }
  async getPrimaryServices(): Promise<FakeService[]> {
    return [...this.device.services.values()];
  }
}

let nextId = 1;

export class FakeDevice extends EventTarget {
  readonly id = `fake-${nextId++}`;
  readonly services = new Map<string, FakeService>();
  readonly gatt = new FakeGattServer(this);
  constructor(readonly name: string) {
    super();
  }

  addService(uuid: string): FakeService {
    const s = new FakeService(this, uuid);
    this.services.set(uuid, s);
    return s;
  }

  /** Simulate the link dropping (out of range, trainer power cycle). */
  drop(): void {
    this.gatt.disconnect();
  }

  /** Cast for APIs typed against the real Web Bluetooth interfaces. */
  asBluetoothDevice(): BluetoothDevice {
    return this as unknown as BluetoothDevice;
  }
}

/** Replacement for `navigator.bluetooth`: requestDevice picks the first device matching the filters. */
export class FakeBluetooth {
  readonly devices: FakeDevice[] = [];
  /** Optional chooser; return undefined to simulate the user cancelling. */
  chooser?: (candidates: FakeDevice[]) => FakeDevice | undefined;

  add<T extends { device: FakeDevice }>(sim: T): T {
    this.devices.push(sim.device);
    return sim;
  }

  async requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice> {
    const filters = options && "filters" in options ? (options.filters ?? []) : [];
    const candidates = this.devices.filter(
      (d) =>
        filters.length === 0 ||
        filters.some((f) => (f.services ?? []).every((s) => d.services.has(normalize(s)))),
    );
    const picked = this.chooser ? this.chooser(candidates) : candidates[0];
    if (!picked) throw new DOMException("User cancelled the requestDevice() chooser.", "NotFoundError");
    return picked.asBluetoothDevice();
  }

  asBluetooth(): Pick<Bluetooth, "requestDevice"> {
    return this as unknown as Pick<Bluetooth, "requestDevice">;
  }
}

function normalize(uuid: BluetoothServiceUUID): string {
  return typeof uuid === "number"
    ? `0000${uuid.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`
    : uuid.toLowerCase();
}

function toView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
