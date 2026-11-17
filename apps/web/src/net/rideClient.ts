/**
 * Connection to the multiplayer server (apps/server, Colyseus). Not used by the games yet.
 *
 * Usage, once a game goes multiplayer:
 *   const ride = await joinRide({ name: "Ann", weightKg: 70 });
 *   bike.on("data", (d) => ride.sendSample({ power: d.power, cadence: d.cadence, heartRate: d.heartRate }));
 *   ride.room.onStateChange((state) => render(state.riders));
 */
import { Client, type Room } from "@colyseus/sdk";
import {
  PROTOCOL_VERSION,
  RIDE_ROOM,
  RideState,
  type ClientMessages,
  type JoinOptions,
  type RiderSample,
} from "@indoor-bike/game-core/net";

/** Server URL: `VITE_SERVER_URL` at build time, otherwise the dev server on this host. */
export const defaultServerUrl = (): string =>
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8787`;

/** Samples are sent at most this often (the trainer reports several times per second). */
const SAMPLE_INTERVAL_MS = 250;

export interface RideConnection {
  room: Room<any, RideState>;
  sendSample(sample: RiderSample): void;
  setReady(ready: boolean): void;
  leave(): Promise<void>;
}

export async function joinRide(player: Omit<JoinOptions, "protocol">, url = defaultServerUrl()): Promise<RideConnection> {
  const client = new Client(url);
  const options: JoinOptions = { ...player, protocol: PROTOCOL_VERSION };
  const room = await client.joinOrCreate<RideState>(RIDE_ROOM, options, RideState);
  const send = <K extends keyof ClientMessages>(type: K, message: ClientMessages[K]) => room.send(type, message);
  let lastSample = 0;
  return {
    room,
    sendSample(sample) {
      const now = performance.now();
      if (now - lastSample < SAMPLE_INTERVAL_MS) return;
      lastSample = now;
      send("sample", sample);
    },
    setReady: (ready) => send("ready", { ready }),
    leave: async () => {
      await room.leave();
    },
  };
}
