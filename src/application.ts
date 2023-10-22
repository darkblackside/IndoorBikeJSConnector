import { Store } from "./store.js";

export class Application
{
	private store: Store;

	public constructor(store: Store)
	{
		this.store = store;
	}
}