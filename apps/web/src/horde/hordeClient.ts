/** Connection to the Feed the Horde room on the multiplayer server (apps/server). */
import { Client, type Room } from "@colyseus/sdk";
import {
  HORDE_ROOM,
  HordeState,
  PROTOCOL_VERSION,
  type HordeClientMessages,
  type HordeJoinOptions,
  type RiderSample,
  type StartOptions,
} from "@indoor-bike/game-core/net";
import { defaultServerUrl } from "../net/rideClient.ts";

/** Samples are sent at most this often. */
const SAMPLE_INTERVAL_MS = 250;

export interface HordeConnection {
  room: Room<any, HordeState>;
  start(options: StartOptions): void;
  sample(sample: RiderSample): void;
  stop(): void;
  leave(): Promise<void>;
}

export async function joinHorde(name: string, url = defaultServerUrl()): Promise<HordeConnection> {
  const client = new Client(url);
  const options: HordeJoinOptions = { protocol: PROTOCOL_VERSION, name };
  const room = await client.joinOrCreate<HordeState>(HORDE_ROOM, options, HordeState);
  const send = <K extends keyof HordeClientMessages>(type: K, message: HordeClientMessages[K]) => room.send(type, message);
  let last = 0;
  return {
    room,
    start: (o) => send("start", o),
    sample(sample) {
      const now = performance.now();
      if (now - last < SAMPLE_INTERVAL_MS) return;
      last = now;
      send("sample", sample);
    },
    stop: () => send("stop", {}),
    leave: async () => {
      await room.leave();
    },
  };
}
