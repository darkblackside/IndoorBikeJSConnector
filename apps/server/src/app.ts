import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HORDE_ROOM, RIDE_ROOM } from "@indoor-bike/game-core/net";
import type { ServerConfig } from "./config.ts";
import { MemoryHordeStore, type HordeStore } from "./horde/store.ts";
import { HordeRoom, type HordeDeps } from "./rooms/HordeRoom.ts";
import { RideRoom } from "./rooms/RideRoom.ts";
import { serveStatic } from "./static.ts";

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
      // Only the web app may connect from a browser (non-browser clients send no Origin): the allowed origins, or
      // the page this server serves itself (same host).
      beforeUpgrade: (request) => {
        const origin = request.headers.get("origin");
        if (origin && !config.allowedOrigins.includes(origin) && !sameHost(origin, request.headers.get("host"))) {
          return new Response(null, { status: 403 });
        }
      },
    }),
    // The built web app, so one server (and one container) has everything.
    ...(config.webDir ? { express: (app: { use(handler: ReturnType<typeof serveStatic>): unknown }) => void app.use(serveStatic(config.webDir)) } : {}),
  });
}

/** Opens the persistent horde world right away, so the bots ride even before anyone connects. */
export async function openHordeWorld() {
  await matchMaker.createRoom(HORDE_ROOM, {});
}

function sameHost(origin: string, host: string | null): boolean {
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
