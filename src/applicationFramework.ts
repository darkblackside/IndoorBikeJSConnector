import { Application } from "./application.js";
import { Device } from "./device.js";
import { DeviceManager } from "./deviceManager.js";
import { WahooDevice } from "./devices/wahooDevice.js";
import { Store } from "./store.js";

export class ApplicationFramework
{
	private applications: Array<Application> = new Array<Application>();
	private deviceManager: DeviceManager;
	private store: Store;
    private availableDevices: {[key: string]: Device} = {
    };

	public constructor()
	{
		this.store = new Store();
        this.deviceManager = new DeviceManager(this.store);
        this.store.addDeviceManager(this.deviceManager);

        const wahooDevice = new WahooDevice();
        this.availableDevices[wahooDevice.serviceUuid] = wahooDevice;
	}

	public startListening()
	{
		const bluetoothNavigator = navigator.bluetooth;

        const filters = Object.keys(this.availableDevices).map(key => {
            return {services: [key]};
        });
	
		bluetoothNavigator.requestDevice({ filters })
		  .then(this.connectToDevice.bind(this))
		  .catch(error =>
			{
			  console.error('Bluetooth device selection failed: ', error);
			});
	}

    private connectToDevice(device: BluetoothDevice)
    {
        if(device != null && device.gatt != null)
        {
            device.gatt.connect()
                .then(this.connectToServer.bind(this))
        }
        else
        {
            throw new Error("device or gatt is null");
        }
    }

    private connectToServer(server: BluetoothRemoteGATTServer) {
        server.getPrimaryServices().then((services: BluetoothRemoteGATTService[]) => {
            if(services != null && services.length > 0)
            {
                services.forEach((service: BluetoothRemoteGATTService) => {
                    if(service.uuid in this.availableDevices)
                    {
                        this.availableDevices[service.uuid].registerCharacteristic(service);
                    }
                });
            }
        });
    }
}