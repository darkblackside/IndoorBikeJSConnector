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

/**
 * Server URL: `VITE_SERVER_URL` at build time (empty counts as unset). Otherwise, in dev the game server on this host
 * (port 8787, next to Vite), and in a production build the server the page came from (the container serves both).
 */
export const defaultServerUrl = (): string => {
  const ws = location.protocol === "https:" ? "wss" : "ws";
  return import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? `${ws}://${location.hostname}:8787` : `${ws}://${location.host}`);
};

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
