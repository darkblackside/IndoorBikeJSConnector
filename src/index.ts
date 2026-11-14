/// <reference types="web-bluetooth" />
export { IndoorBike, type DeviceRole, type IndoorBikeEvents } from "./indoorBike.ts";
export { Trainer, type TrainerOptions } from "./trainer.ts";
export { HeartRateMonitor } from "./heartRateMonitor.ts";
export { BleSensor, type ConnectOptions, type SensorEvents, type SensorOptions } from "./sensor.ts";
export { Emitter } from "./emitter.ts";
export * from "./types.ts";
export * from "./protocols/index.ts";
export { Service, Characteristic, uuid16 } from "./uuids.ts";

/** Low-level encoders/decoders, for custom drivers and tests. */
export * as ftms from "./parsers/ftms.ts";
export * as cyclingPower from "./parsers/cyclingPower.ts";
export * as wahoo from "./parsers/wahoo.ts";
export * as fec from "./parsers/fec.ts";
export { parseHeartRate } from "./parsers/heartRate.ts";
