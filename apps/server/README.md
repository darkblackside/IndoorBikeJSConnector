# @indoor-bike/server

The multiplayer backend: Node + TypeScript + [Colyseus](https://docs.colyseus.io/) (rooms, matchmaking and state
sync over WebSocket). It uses `@colyseus/core` with `@colyseus/ws-transport` rather than the `colyseus` meta
package, which also pulls in Redis, auth and the monitor.

```sh
npm run dev:server                  # from the root: tsx watch, game-core from source, ws://localhost:8787
npm test -w @indoor-bike/server     # boots a test server and connects real clients (@colyseus/testing)
npm run build -w @indoor-bike/game-core -w @indoor-bike/server && npm start -w @indoor-bike/server
```

Environment: `PORT` (default 8787), `ALLOWED_ORIGINS` (comma-separated browser origins allowed to open a WebSocket;
default `http://localhost:5173,https://darkblackside.github.io`; others get 403).

| File | What |
| --- | --- |
| `src/index.ts` | Entry point: config, listen |
| `src/app.ts` | `createServer()`: room definitions and the WebSocket transport with the origin check |
| `src/rooms/RideRoom.ts` | One group ride: riders join (`JoinOptions`, protocol version checked in `onAuth`), send `sample` and `ready` |
| `src/config.ts` | Settings from the environment |

The state and messages are defined in `@indoor-bike/game-core/net` (`RideState`, `RiderState`, `ClientMessages`,
`checkJoinOptions`, `checkSample`), so the web client uses exactly the same definitions.

## Not implemented yet

- **Game loop:** when every rider is ready, pick a `seed`, set `phase = "riding"` and run a fixed tick
  (`this.setSimulationInterval`, e.g. 10–20 Hz) with game-core rules (`rampStateAt`, `speedFromPower`, horde gap),
  writing each rider's `s`, `gap` and `out`. Clients build the same `CityWorld(mulberry32(seed))` and interpolate.
- **Reconnects** (`allowReconnection` in `onLeave`), so a dropped phone connection does not end the ride.
- **Deployment:** a Dockerfile / host for the server. GitHub Pages only serves the static web app.
