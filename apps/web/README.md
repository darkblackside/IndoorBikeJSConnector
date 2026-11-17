# @indoor-bike/web

The browser frontend (Vite + TypeScript). `npm run dev` from the root, then:

| URL | What | Source |
| --- | --- | --- |
| `/` | Game hub: **Offline** tab (single-player games) and **Online** tab (multiplayer, empty for now). `#offline`/`#online` select the tab | `src/home/` |
| `/zombie-ramp/` | [Zombie Ramp](ZOMBIE_RAMP.md), ramp FTP test game (Offline) | `src/zombie-ramp/` |
| `/debug/` | Debug bench for the connector (devices, ERG/SIM, spin-down, simulators). Hidden: built, but not linked from the app | `src/debug/` |
| `/sandbox/` | three.js sandbox: a game-core `CityWorld` rendered with the engine in 2D. Dev only, not in the build | `src/sandbox/` |

| Folder | What |
| --- | --- |
| `src/engine/` | three.js set up for 2D (`createStage`: orthographic camera in metres, +y down, render loop). Renders game-core state, never owns it |
| `src/net/` | Multiplayer client (`joinRide()`, Colyseus SDK) for `apps/server`. Not used by the games yet |
| `src/common/` | Shared UI helpers |

To add a game to the hub, add a page (and its entry in `vite.config.ts` `input`) and list it in `src/home/games.ts`
(`offlineGames` or `onlineGames`).

The server URL is `VITE_SERVER_URL` at build time, otherwise `ws://<this host>:8787` (the dev server).
