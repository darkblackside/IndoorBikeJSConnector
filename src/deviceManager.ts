import { Device } from "./device.js";
import { IDevice } from "./iDevice.js";
import { Store } from "./store.js";

export class DeviceManager
{
	private devices: Array<IDevice> = new Array<IDevice>();
	private store: Store;

	public constructor(store: Store)
	{
		this.store = store;
	}

	public addDevice(device: Device): void
	{
		this.devices.push(device);
        device.registerWatcher(this);
	}

    public updateStoreWattValue(value: number)
    {
        this.store.setCurrentWatt(value);
    }
    public updateStoreCadenceValue(value: number)
    {
        this.store.setCurrentCadence(value);
    }
    public updateStoreHeartRateValue(value: number)
    {
        this.store.setHeartrate(value);
    }
    public updateStoreSpeedValue(value: number)
    {
        this.store.setCurrentSpeed(value);
    }

    public updateDeviceWattValue(value: number)
    {
        this.devices.forEach(device => {
            device.setTargetWatt(value);
        });
    }
}