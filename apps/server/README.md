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
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins allowed to open a WebSocket besides the server's own pages; others get 403 |
| `HORDE_DATA_FILE` | `data/horde.json` (relative to the working directory) | Where Feed the Horde keeps its total sweat. Written every 10 s and on shutdown (temp file + rename) |
| `HORDE_BOTS` | `1` | `0` turns off the simulated riders |
| `WEB_DIR` | empty (container: `/app/web`) | Built web app (`apps/web/dist`) to serve over HTTP on the same port. Empty: no frontend (in dev, Vite serves it) |

Pages served by the server itself may always open a WebSocket (same host), whatever `ALLOWED_ORIGINS` says.

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
| `src/app.ts` | `createServer()`: room definitions (dependencies injected via a subclass, never via client options), the WebSocket transport with the origin check, and the web app (`WEB_DIR`) |
| `src/static.ts` | `serveStatic()`: the built web app over HTTP (cache headers, directory index, no path escapes) |
| `src/rooms/HordeRoom.ts` | Feed the Horde |
| `src/horde/store.ts` | `FileHordeStore` (JSON on disk) and `MemoryHordeStore` (tests) |
| `src/horde/bots.ts` | `BotDirector`: when the simulated riders come and go |
| `src/rooms/RideRoom.ts` | Group ride skeleton |
| `src/config.ts` | Settings from the environment |

## Deployment: one container

The image contains everything: the game server **and** the built web app, on one port (open
`http://<host>:8787/`). The web app finds the server on its own origin, so nothing has to be configured.

**Registry:** `.github/workflows/docker.yml` builds `apps/server/Dockerfile` and pushes it to the GitHub container
registry as `ghcr.io/darkblackside/indoorbikejsconnector`: `latest` and `main` from `main`, `sha-<commit>` for every
build, `1.2.3` and `1.2` from `v1.2.3` tags. Pull requests only build. The workflow's `GITHUB_TOKEN` must be allowed
to read `@darkblackside/ui` (package settings, *Manage Actions access*, as for the CI workflow). New GHCR packages
are private: to pull without logging in, make it public in the package settings.

```sh
docker run -d --name indoor-bike -p 8787:8787 -v horde-data:/data ghcr.io/darkblackside/indoorbikejsconnector:latest
```

- Mount a volume at `/data`: the horde's total sweat lives in `/data/horde.json`.
- Put it behind TLS (a reverse proxy such as Caddy/Traefik, or the host's HTTPS): Web Bluetooth needs a secure page
  (`https://`), and the WebSocket then is `wss://` on the same host automatically.
- Health check: `GET /__healthcheck` (also the image's `HEALTHCHECK`).
- Run one instance: the horde total and the bots live in that process.
- This is the real app: `https://sweat-games.lightwhiteside.de` (infrastructure repo, `light-server/sweat-games`).
  GitHub Pages only redirects the old `darkblackside.github.io/IndoorBikeJSConnector/` addresses there
  (`.github/workflows/pages.yml`, `scripts/pages-redirect.mjs`).

Building locally needs a GitHub token with `read:packages` (for `@darkblackside/ui`) as a build secret; it never ends
up in the image:

```sh
docker build -f apps/server/Dockerfile --secret id=npm_token,src=$HOME/.gh-packages-token -t indoor-bike .
```

## Not implemented yet

- **RideRoom game loop** (start when everyone is ready, shared `seed`, fixed tick with the Zombie Ramp rules).
- **Per-IP connection limits**: not needed for the horde so far (co-op, nothing to win), easy to add in `beforeUpgrade`.
