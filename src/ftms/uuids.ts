/** Bluetooth SIG assigned numbers used by this app (16-bit UUIDs). */
export const Services = {
  fitnessMachine: 0x1826,
  heartRate: 0x180d,
} as const;

export const Characteristics = {
  fitnessMachineFeature: 0x2acc,
  indoorBikeData: 0x2ad2,
  supportedPowerRange: 0x2ad8,
  fitnessMachineControlPoint: 0x2ad9,
  fitnessMachineStatus: 0x2ada,
  heartRateMeasurement: 0x2a37,
} as const;
