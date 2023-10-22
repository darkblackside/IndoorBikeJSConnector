import { DeviceManager } from "./deviceManager.js";

export class Store
{
	private currentWatt: number | undefined;
	private targetWatt: number | undefined;
	private heartrate: number | undefined;
	private currentSpeed: number | undefined;
	private functionalPowerThreshold: number | undefined;
	private currentCadence: number | undefined;

	private deviceManagers: Array<DeviceManager> = new Array<DeviceManager>();

	public addDeviceManager(deviceManager: DeviceManager): void
	{
		this.deviceManagers.push(deviceManager);
	}
	public removeDeviceManager(deviceManager: DeviceManager): void
	{
		this.deviceManagers.splice(this.deviceManagers.indexOf(deviceManager), 1);
	}

	//Write getter for all class items
	public getCurrentWatt(): number | undefined
	{
		return this.currentWatt;
	}
	public getTargetWatt(): number | undefined
	{
		return this.targetWatt;
	}
	public getHeartrate(): number | undefined
	{
		return this.heartrate;
	}
	public getCurrentSpeed(): number | undefined
	{
		return this.currentSpeed;
	}
	public getFunctionalPowerThreshold(): number | undefined
	{
		return this.functionalPowerThreshold;
	}
	public getCurrentCadence(): number | undefined
	{
		return this.currentCadence;
	}

	//Write setter for all class items
	public setCurrentWatt(currentWatt: number): void
	{
		this.currentWatt = currentWatt;
	}
	public setTargetWatt(targetWatt: number): void
	{
		this.targetWatt = targetWatt;
		this.deviceManagers.forEach(deviceManager => {
			deviceManager.updateDeviceWattValue(targetWatt);
		});
	}
	public setHeartrate(heartrate: number): void
	{
		this.heartrate = heartrate;
	}
	public setCurrentSpeed(currentSpeed: number): void
	{
		this.currentSpeed = currentSpeed;
	}
	public setFunctionalPowerThreshold(functionalPowerThreshold: number): void
	{
		this.functionalPowerThreshold = functionalPowerThreshold;
	}
    public setCurrentCadence(value: number)
	{
        this.currentCadence = value;
    }
}