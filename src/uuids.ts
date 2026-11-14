/** Expand a 16-bit Bluetooth SIG assigned number into the canonical 128-bit UUID string. */
export const uuid16 = (n: number): string =>
  `0000${n.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;

export const Service = {
  fitnessMachine: uuid16(0x1826),
  cyclingPower: uuid16(0x1818),
  heartRate: uuid16(0x180d),
  /** Tacx "FE-C over BLE": ANT+ FE-C messages tunnelled through a Nordic UART-style service. */
  tacxFec: "6e40fec1-b5a3-f393-e0a9-e50e24dcca9e",
} as const;

export const Characteristic = {
  // Fitness Machine Service
  fitnessMachineFeature: uuid16(0x2acc),
  indoorBikeData: uuid16(0x2ad2),
  supportedPowerRange: uuid16(0x2ad8),
  fitnessMachineControlPoint: uuid16(0x2ad9),
  // Cycling Power Service
  cyclingPowerMeasurement: uuid16(0x2a63),
  /** Wahoo's proprietary trainer control point, inside the Cycling Power Service (KICKR before FTMS). */
  wahooTrainer: "a026e005-0a7d-4ab3-97fa-f1500f9feb8b",
  // Heart Rate Service
  heartRateMeasurement: uuid16(0x2a37),
  // Tacx FE-C
  tacxFecRead: "6e40fec2-b5a3-f393-e0a9-e50e24dcca9e",
  tacxFecWrite: "6e40fec3-b5a3-f393-e0a9-e50e24dcca9e",
} as const;
