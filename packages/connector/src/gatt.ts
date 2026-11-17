/** Thin helpers over Web Bluetooth GATT objects. */

export async function getServiceOrUndefined(
  server: BluetoothRemoteGATTServer,
  uuid: string,
): Promise<BluetoothRemoteGATTService | undefined> {
  try {
    return await server.getPrimaryService(uuid);
  } catch {
    return undefined;
  }
}

export async function getCharacteristicOrUndefined(
  service: BluetoothRemoteGATTService,
  uuid: string,
): Promise<BluetoothRemoteGATTCharacteristic | undefined> {
  try {
    return await service.getCharacteristic(uuid);
  } catch {
    return undefined;
  }
}

/** Subscribe to notifications/indications. Returns the characteristic for chaining. */
export async function subscribe(
  characteristic: BluetoothRemoteGATTCharacteristic,
  handler: (value: DataView) => void,
): Promise<BluetoothRemoteGATTCharacteristic> {
  characteristic.addEventListener("characteristicvaluechanged", (event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (value) handler(value);
  });
  await characteristic.startNotifications();
  return characteristic;
}

/** Write, preferring "without response" when the characteristic only supports that. */
export async function write(
  characteristic: BluetoothRemoteGATTCharacteristic,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const props = characteristic.properties;
  if (props && !props.write && props.writeWithoutResponse) {
    await characteristic.writeValueWithoutResponse(bytes);
  } else {
    await characteristic.writeValueWithResponse(bytes);
  }
}

/** Runs async tasks strictly one after another (GATT allows one operation at a time). */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
