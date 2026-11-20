# @indoor-bike/web

The browser frontend (Vite + TypeScript). `npm run dev` from the root, then:

| URL | What | Source |
| --- | --- | --- |
| `/` | Game hub: **Offline** tab (single-player games) and **Online** tab (multiplayer). `#offline`/`#online` select the tab | `src/home/` |
| `/zombie-ramp/` | [Zombie Ramp](ZOMBIE_RAMP.md), ramp FTP test game (Offline) | `src/zombie-ramp/` |
| `/ftp20/` | [20-min FTP test](FTP20.md), coached 20-minute FTP test as a three.js runner (Offline) | `src/ftp20/` |
| `/horde/` | [Feed the Horde](HORDE.md), online co-op: everyone feeds one persistent undead horde with sweat (Online) | `src/horde/` |
| `/impressum/`, `/datenschutz/` | Legal notice and privacy policy (German), linked from the hub's footer. What they promise: [LEGAL.md](LEGAL.md) | `impressum/`, `datenschutz/`, `src/legal/` |
| `/debug/` | Debug bench for the connector (devices, ERG/SIM, spin-down, simulators). Hidden: built, but not linked from the app | `src/debug/` |
| `/sandbox/` | three.js sandbox: a game-core `CityWorld` rendered with the engine in 2D. Dev only, not in the build | `src/sandbox/` |

| Folder | What |
| --- | --- |
| `src/engine/` | three.js set up for 2D (`createStage`: orthographic camera in metres, +y down, render loop). Renders game-core state, never owns it |
| `src/net/` | Multiplayer client (`joinRide()`, Colyseus SDK) for `apps/server`, and `defaultServerUrl()` |
| `src/common/` | Shared UI helpers; `fonts/`: the theme's fonts, self-hosted (no Google requests); `profile.ts`: FTP and name in localStorage (the FTP tests write it, online games read it) |

To add a game to the hub, add a page (and its entry in `vite.config.ts` `input`) and list it in `src/home/games.ts`
(`offlineGames` or `onlineGames`).

The server URL is `VITE_SERVER_URL` at build time; otherwise `ws://<this host>:8787` in dev, and the page's own origin in a
production build (the container serves the web app and the game server together).
