# @indoor-bike/web

The browser frontend (Vite + TypeScript). `npm run dev` from the root, then:

| URL | What | Source |
| --- | --- | --- |
| `/` | Trainer test bench | `src/bench/` |
| `/zombie-ramp/` | [Zombie Ramp](ZOMBIE_RAMP.md), ramp FTP test game | `src/zombie-ramp/` |
| `/sandbox/` | three.js sandbox: a game-core `CityWorld` rendered with the engine in 2D. Dev only, not in the build | `src/sandbox/` |

| Folder | What |
| --- | --- |
| `src/engine/` | three.js set up for 2D (`createStage`: orthographic camera in metres, +y down, render loop). Renders game-core state, never owns it |
| `src/net/` | Multiplayer client (`joinRide()`, Colyseus SDK) for `apps/server`. Not used by the games yet |
| `src/common/` | Shared UI helpers |

The server URL is `VITE_SERVER_URL` at build time, otherwise `ws://<this host>:8787` (the dev server).
