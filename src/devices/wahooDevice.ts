import { Device } from "../device.js";

export class WahooDevice extends Device
{
	_name = "Wahoo Kickr Core";
	serviceUuid = "00001826-0000-1000-8000-00805f9b34fb";
	characteristicUuid = "00002ad2-0000-1000-8000-00805f9b34fb";

	public setTargetWatt(value: number): void {
		throw new Error("Method not implemented.");
	}

	public characteristicRegistered(characteristic: BluetoothRemoteGATTCharacteristic): void {
		console.log(characteristic);
		characteristic.oncharacteristicvaluechanged = this.indoorBikeDataChanged;
		characteristic.startNotifications();
	}

	private indoorBikeDataChanged(event: Event) 
	{
		// Process the data, which may include watt values
		console.log(event);
		let data = (<any>(event.currentTarget)).value;
		let flags = data.getUint8(0, true);
		if (flags & 0b0000100) {
			console.log("power flag set");
		}
		console.log('Watt Value: ', data.getUint16(6, true));
	};
	
	//for future use?
	private readCharacteristic(characteristic: BluetoothRemoteGATTCharacteristic)
	{
		characteristic.readValue()
			.then(data => {
				// Process the data, which may include watt values
				let flags = data.getUint16(0, true);
				if (flags & 0b0000001000000000) {
					console.log("power flag set");
				}
				console.log('Watt Value: ', data.getUint16(6, true)); // Interpret data as needed
			})
			.catch(error => {
				console.error('Reading characteristic failed: ', error);
			});
	}
}