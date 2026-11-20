import { Room, type Client } from "@colyseus/core";
import {
  checkJoinOptions,
  checkSample,
  MAX_RIDERS,
  RideState,
  RiderState,
  type ClientMessages,
  type JoinOptions,
} from "@indoor-bike/game-core/net";

/**
 * One group ride. Riders join, report their devices' samples and mark themselves ready.
 *
 * Not implemented yet: the game itself. Once everyone is ready the room should pick a `seed`, switch to
 * `riding` and run a fixed-tick loop (`this.setSimulationInterval`) with game-core rules (ramp target,
 * speed from power, horde gap), writing each rider's `s`/`gap`/`out` into the state.
 */
export class RideRoom extends Room<{ state: RideState }> {
  override maxClients = MAX_RIDERS;
  override state = new RideState();

  override messages = {
    sample: (client: Client, message: ClientMessages["sample"]) => {
      const rider = this.state.riders.get(client.sessionId);
      const sample = checkSample(message);
      if (!rider || !sample) return;
      rider.power = Math.round(sample.power ?? 0);
      rider.cadence = Math.round(sample.cadence ?? 0);
    },
    ready: (client: Client, message: ClientMessages["ready"]) => {
      const rider = this.state.riders.get(client.sessionId);
      if (rider && this.state.phase === "lobby") rider.ready = message?.ready === true;
    },
  };

  /** Runs before `onJoin`: turn away clients with another protocol version or invalid options. */
  override onAuth(_client: Client, options: unknown): JoinOptions {
    const checked = checkJoinOptions(options);
    if (!checked.ok) throw new Error(checked.error);
    return checked.value;
  }

  override onJoin(client: Client): void {
    const options = client.auth as JoinOptions;
    const rider = new RiderState();
    rider.name = options.name;
    rider.weightKg = options.weightKg ?? 75;
    this.state.riders.set(client.sessionId, rider);
  }

  override onLeave(client: Client): void {
    this.state.riders.delete(client.sessionId);
  }
}
