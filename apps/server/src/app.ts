import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RIDE_ROOM } from "@indoor-bike/game-core/net";
import type { ServerConfig } from "./config.ts";
import { RideRoom } from "./rooms/RideRoom.ts";

/** The Colyseus server with its rooms. `listen()` is up to the caller (index.ts, tests). */
export function createServer(config: ServerConfig) {
  return defineServer({
    rooms: { [RIDE_ROOM]: defineRoom(RideRoom) },
    transport: new WebSocketTransport({
      // Only the web app may connect from a browser (non-browser clients send no Origin).
      beforeUpgrade: (request) => {
        const origin = request.headers.get("origin");
        if (origin && !config.allowedOrigins.includes(origin)) return new Response(null, { status: 403 });
      },
    }),
  });
}
