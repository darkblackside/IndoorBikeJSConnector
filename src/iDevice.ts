import { DeviceManager } from "./deviceManager.js";

export interface IDevice
{
	registerWatcher(deviceManager: DeviceManager): void;
	unregisterWatcher(deviceManager: DeviceManager): void;
    setTargetWatt(value: number): void;
}