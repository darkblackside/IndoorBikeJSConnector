# @indoor-bike/server (placeholder)

The multiplayer backend: Node + WebSocket. **Not implemented yet.** The workspace exists so the wiring is in place:
it builds, depends on `@indoor-bike/game-core`, and `src/index.ts` only prints its config.

```sh
npm run build -w @indoor-bike/game-core -w @indoor-bike/server
npm start -w @indoor-bike/server     # PORT (default 8787), ALLOWED_ORIGINS (comma-separated)
```

## Plan

- **Transport:** WebSocket on the same port as a small HTTP health endpoint. Library options: `ws` (minimal, we write
  rooms/sync ourselves) or Colyseus (rooms, matchmaking and state sync built in). Check `Origin` against
  `ALLOWED_ORIGINS`.
- **Protocol:** the messages in `@indoor-bike/game-core/net` (`hello` → `welcome`, `join` → `room`, `ready`,
  `start` with a shared `seed`, `sample` from clients, `snapshot` from the server, `finish`). Validate every
  client message; never trust client-reported positions, only their samples (power, cadence, heart rate).
- **Authority:** the server runs the game loop at a fixed tick (e.g. 10–20 Hz) with game-core code (`rampStateAt`,
  `speedFromPower`, gap/horde rules), and broadcasts snapshots. Clients interpolate between snapshots and render.
  Each client builds the same `CityWorld(mulberry32(seed))`, so the city itself is never sent.
- **Dev:** add a TypeScript runner with watch mode (e.g. `tsx watch`) when there is code to run, and a Dockerfile
  for deployment (GitHub Pages only hosts the static web app).
