import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HORDE_ROOM, RIDE_ROOM } from "@indoor-bike/game-core/net";
import type { ServerConfig } from "./config.ts";
import { MemoryHordeStore, type HordeStore } from "./horde/store.ts";
import { HordeRoom, type HordeDeps } from "./rooms/HordeRoom.ts";
import { RideRoom } from "./rooms/RideRoom.ts";

export interface ServerParts {
  /** The horde's persistent total. Default: in memory. */
  hordeStore?: HordeStore;
  rand?: () => number;
}

/** The Colyseus server with its rooms. `listen()` is up to the caller (index.ts, tests). */
export function createServer(config: ServerConfig, parts: ServerParts = {}) {
  const hordeDeps: HordeDeps = {
    store: parts.hordeStore ?? new MemoryHordeStore(),
    bots: config.hordeBots,
    rand: parts.rand ?? Math.random,
  };
  // The deps go in through a subclass, not room options: options come from the joining client.
  const Horde = class extends HordeRoom {
    override deps = hordeDeps;
  };
  return defineServer({
    rooms: { [RIDE_ROOM]: defineRoom(RideRoom), [HORDE_ROOM]: defineRoom(Horde) },
    transport: new WebSocketTransport({
      // Only the web app may connect from a browser (non-browser clients send no Origin).
      beforeUpgrade: (request) => {
        const origin = request.headers.get("origin");
        if (origin && !config.allowedOrigins.includes(origin)) return new Response(null, { status: 403 });
      },
    }),
  });
}

/** Opens the persistent horde world right away, so the bots ride even before anyone connects. */
export async function openHordeWorld() {
  await matchMaker.createRoom(HORDE_ROOM, {});
}
