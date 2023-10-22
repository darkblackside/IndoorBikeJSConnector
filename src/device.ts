import { DeviceManager } from "./deviceManager.js";
import { IDevice } from "./iDevice.js";

export abstract class Device implements IDevice
{
	protected static _name: string = "";
	public abstract serviceUuid: string;
	protected abstract characteristicUuid: string;

	public static get deviceName(): string
	{
		return this._name;
	};

	private deviceManagers: Array<DeviceManager> = new Array<DeviceManager>();

	public constructor()
	{
	}

	public registerWatcher(deviceManager: DeviceManager): void
	{
		if(this.deviceManagers.indexOf(deviceManager) == -1)
		{
			this.deviceManagers.push(deviceManager);
		}
		else
		{
			console.warn("DeviceManager already registered");
		}
	}

	public unregisterWatcher(deviceManager: DeviceManager): void
	{
		let index = this.deviceManagers.indexOf(deviceManager);
		if(index != -1)
		{
			this.deviceManagers.splice(index, 1);
		}
		else
		{
			console.warn("DeviceManager not registered");
		}
	}
	
	public abstract setTargetWatt(value: number): void;
	public abstract characteristicRegistered(characteristic: BluetoothRemoteGATTCharacteristic): void;

	public registerCharacteristic(service: BluetoothRemoteGATTService): void
	{
		service.getCharacteristic(this.characteristicUuid)
				.then(this.characteristicRegistered.bind(this));
	}
}