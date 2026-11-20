# @indoor-bike/server

The multiplayer backend: Node + TypeScript + [Colyseus](https://docs.colyseus.io/) (rooms, matchmaking and state
sync over WebSocket). It uses `@colyseus/core` with `@colyseus/ws-transport` rather than the `colyseus` meta
package, which also pulls in Redis, auth and the monitor.

```sh
npm run dev:server                  # from the root: tsx watch, game-core from source, ws://localhost:8787
npm test -w @indoor-bike/server     # boots a test server and connects real clients (@colyseus/testing)
npm run build -w @indoor-bike/game-core -w @indoor-bike/server && npm start -w @indoor-bike/server
```

No accounts: anyone can connect with a display name (unauthenticated traffic). The only gate is the WebSocket
origin check for browsers; every message is validated and the server computes all scores itself.

## Environment

| Variable | Default | What |
| --- | --- | --- |
| `PORT` | `8787` | HTTP/WebSocket port |
| `ALLOWED_ORIGINS` | `http://localhost:5173,https://darkblackside.github.io` | Comma-separated browser origins allowed to open a WebSocket; others get 403 |
| `HORDE_DATA_FILE` | `data/horde.json` (relative to the working directory) | Where Feed the Horde keeps its total sweat. Written every 10 s and on shutdown (temp file + rename) |
| `HORDE_BOTS` | `1` | `0` turns off the simulated riders |

## Rooms

| Room | Game | State / messages |
| --- | --- | --- |
| `horde` (`src/rooms/HordeRoom.ts`) | [Feed the Horde](../web/HORDE.md): one persistent co-op world. Created at boot and never disposed, so the bots ride even when nobody is connected. If it is full (64 clients), `joinOrCreate` opens a second room; all rooms feed the same total | `HordeState`, `HordeClientMessages` (`start`, `sample`, `stop`), `HordeServerMessages` (`effect`, `summary`) in `@indoor-bike/game-core/net` |
| `ride` (`src/rooms/RideRoom.ts`) | Group ride skeleton (no game loop yet) | `RideState`, `ClientMessages` |

The horde room ticks at 4 Hz: each riding client's latest sample (stale after 3 s = not pedalling) goes through a
game-core `RiderSession` (workout clock, block judging, multiplier, sweat), plus the bots'. Then the group frenzy, the
total and the level are updated; Colyseus syncs the state as delta patches. Dropped connections may reconnect for
30 s (the session pauses meanwhile).

| File | What |
| --- | --- |
| `src/index.ts` | Entry point: config, store, listen, open the persistent horde room |
| `src/app.ts` | `createServer()`: room definitions (dependencies injected via a subclass, never via client options) and the WebSocket transport with the origin check |
| `src/rooms/HordeRoom.ts` | Feed the Horde |
| `src/horde/store.ts` | `FileHordeStore` (JSON on disk) and `MemoryHordeStore` (tests) |
| `src/horde/bots.ts` | `BotDirector`: when the simulated riders come and go |
| `src/rooms/RideRoom.ts` | Group ride skeleton |
| `src/config.ts` | Settings from the environment |

## Deployment

`Dockerfile` (build from the repository root). It installs only game-core and the server, so no GitHub Packages
token is needed:

```sh
docker build -f apps/server/Dockerfile -t indoor-bike-server .
docker run -p 8787:8787 -v horde-data:/data -e ALLOWED_ORIGINS=https://darkblackside.github.io indoor-bike-server
```

Mount a volume at `/data` (the total sweat lives in `/data/horde.json`). Any container host works (Fly.io, Render, a
VPS, …); put it behind TLS (`wss://`), since the web app is served over HTTPS. Then build the web app with
`VITE_SERVER_URL=wss://your-host` (for GitHub Pages: set the repository variable `SERVER_URL`, which `.github/workflows/pages.yml` passes to the build).
Run one instance: the horde total and the bots live in that process.

## Not implemented yet

- **RideRoom game loop** (start when everyone is ready, shared `seed`, fixed tick with the Zombie Ramp rules).
- **Per-IP connection limits**: not needed for the horde so far (co-op, nothing to win), easy to add in `beforeUpgrade`.
