import { FtmsTrainer } from "./devices/ftmsTrainer.ts";
import { HeartRateMonitor } from "./devices/heartRateMonitor.ts";
import type { Store } from "./store.ts";

/** Owns the connected devices and forwards store changes (target power) to them. */
export class DeviceManager {
  readonly trainer: FtmsTrainer;
  readonly heartRateMonitor: HeartRateMonitor;

  constructor(store: Store) {
    this.trainer = new FtmsTrainer(store);
    this.heartRateMonitor = new HeartRateMonitor(store);

    store.subscribe((state, previous) => {
      if (state.targetPower !== previous.targetPower) {
        this.trainer.setTargetPower(state.targetPower);
      }
    });
  }
}
