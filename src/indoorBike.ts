import { Emitter } from "./emitter.ts";
import { HeartRateMonitor } from "./heartRateMonitor.ts";
import type { ConnectOptions } from "./sensor.ts";
import { Trainer, type TrainerOptions } from "./trainer.ts";
import type { BikeData, ConnectionStatus, SimulationParams } from "./types.ts";

export type DeviceRole = "trainer" | "heartRateMonitor";

export interface IndoorBikeEvents extends Record<string, unknown> {
  /** Merged snapshot from all devices, emitted on every change. */
  data: Readonly<BikeData>;
  status: { device: DeviceRole; status: ConnectionStatus };
  error: { device: DeviceRole; error: Error };
}

/**
 * Convenience facade for games: one trainer + one optional heart rate monitor,
 * merged data, one set of events.
 *
 * ```ts
 * const bike = new IndoorBike({ rider: { riderWeight: 80 } });
 * bike.on("data", (d) => player.setPower(d.power ?? 0));
 * button.onclick = () => bike.connectTrainer();
 * bike.setSimulation({ grade: track.gradeAt(player.x) });
 * ```
 */
export class IndoorBike extends Emitter<IndoorBikeEvents> {
  readonly trainer: Trainer;
  readonly heartRateMonitor: HeartRateMonitor;
  private _data: BikeData = {};

  constructor(options: TrainerOptions = {}) {
    super();
    this.trainer = new Trainer(options);
    this.heartRateMonitor = new HeartRateMonitor(options);
    for (const [role, sensor] of [
      ["trainer", this.trainer],
      ["heartRateMonitor", this.heartRateMonitor],
    ] as const) {
      sensor.on("data", () => this.merge());
      sensor.on("status", (status) => this.emit("status", { device: role, status }));
      sensor.on("error", (error) => this.emit("error", { device: role, error }));
    }
  }

  get data(): Readonly<BikeData> {
    return this._data;
  }

  connectTrainer(options?: ConnectOptions): Promise<void> {
    return this.trainer.connect(options);
  }
  connectHeartRateMonitor(options?: ConnectOptions): Promise<void> {
    return this.heartRateMonitor.connect(options);
  }

  setTargetPower(watts: number): void {
    this.trainer.setTargetPower(watts);
  }
  setSimulation(params: SimulationParams): void {
    this.trainer.setSimulation(params);
  }
  freeRide(): void {
    this.trainer.freeRide();
  }

  disconnect(): void {
    this.trainer.disconnect();
    this.heartRateMonitor.disconnect();
  }

  private merge(): void {
    const t = this.trainer.data;
    const h = this.heartRateMonitor.data;
    // A dedicated strap wins over heart rate forwarded by the trainer.
    this._data = { ...t, heartRate: h.heartRate ?? t.heartRate };
    if (this._data.heartRate === undefined) delete this._data.heartRate;
    this.emit("data", this._data);
  }
}
