# Indoor Bike JS Connector

Games and training apps for smart trainers in the browser. This repository is an npm-workspaces monorepo:

| Workspace | Package | What | Runs in |
| --- | --- | --- | --- |
| `packages/connector` | `indoor-bike-js-connector` (published) | The Web Bluetooth trainer/HR library: FTMS, Wahoo, Tacx FE-C, Cycling Power, ERG/SIM. No UI, no runtime deps. **[Docs](packages/connector/README.md)** | Browser |
| `packages/game-core` | `@indoor-bike/game-core` (private) | Game rules and simulation (Zombie Ramp: ramp test, city/horde, .fit/.tcx export; 20-min FTP test: block plan, coaching, pacing, result; Feed the Horde: sweat, workouts, block judging, bots) and the multiplayer protocol: Colyseus room state schema and client messages. No DOM, no engine | Browser + Node |
| `apps/web` | `@indoor-bike/web` (private) | Frontend (Vite, TypeScript, **three.js**): game hub with Offline/Online tabs, the [Zombie Ramp](apps/web/ZOMBIE_RAMP.md) and [20-min FTP test](apps/web/FTP20.md) games, the online co-op game [Feed the Horde](apps/web/HORDE.md), a hidden debug bench, the multiplayer client. [Details](apps/web/README.md) | Browser |
| `apps/server` | `@indoor-bike/server` (private) | Multiplayer backend (Node, TypeScript, **Colyseus** over WebSocket), no accounts: the persistent Feed the Horde world with simulated riders, and a group-ride skeleton. One container image with the web app included, published to ghcr.io. [Details](apps/server/README.md) | Node |

**Try it:** [the game hub](https://darkblackside.github.io/IndoorBikeJSConnector/) in Chrome or Edge: the **Offline**
tab has the single-player games (the Zombie Ramp ramp test and the 20-min FTP test), the **Online** tab has the co-op game Feed the Horde
(it needs the game server; see [apps/server](apps/server/README.md) for hosting). Everything also runs with simulated devices. Developers: the debug bench for the connector is not linked from
the app, it is at [/debug/](https://darkblackside.github.io/IndoorBikeJSConnector/debug/). Deployed from `main` by `.github/workflows/pages.yml`.

## Architecture

```
            Web Bluetooth                         Colyseus (WebSocket)
 trainer ──────────────▶ connector ──▶ apps/web ◀────────────────────▶ apps/server
 HR strap                (browser)     │  three.js: renders           │  rooms, authoritative
                                       │  sends samples               │  game loop (to come)
                                       ▼                              ▼
                                  game-core  ◀──── same code ────▶  game-core
                    (rules, simulation, room state schema, messages)
```

- **connector stays separate.** It knows nothing about games, the web app or the server, and is published on its own.
  Only the web app depends on it (the server never talks to Bluetooth).
- **game-core holds the game, not the screen.** Simulation code (`CityWorld`, `rampStateAt`, `RampRecorder`, …) has no
  DOM access, so the Node server can run exactly the same rules. Its tsconfig has no DOM lib to keep it that way.
  All randomness is injectable: `new CityWorld(mulberry32(seed))` builds the same city on every client.
- **Rendering is a replaceable layer.** The engine is **three.js**, set up for 2D for now (orthographic camera, world
  units = metres, `apps/web/src/engine/stage.ts`); the 20-min FTP test uses it in 3D (perspective runner view,
  `apps/web/src/ftp20/runnerScene.ts`). Renderers read game-core state each frame, they never own it. The Zombie Ramp still draws with its plain canvas renderer
  (`apps/web/src/zombie-ramp/cityRenderer.ts`); the dev-only sandbox page (`/sandbox/`) shows the same `CityWorld` in three.js.
- **Multiplayer via Colyseus.** The room state (`RideState`, Colyseus schema) and the client messages live in
  `@indoor-bike/game-core/net`, so server and client share one definition. The server owns the state; Colyseus syncs
  it to every client as binary delta patches. Clients only send their device samples (power, cadence, heart rate).
- **TypeScript everywhere**, strict, one shared `tsconfig.base.json`.

### Next steps (not done yet)

1. Run the container from `ghcr.io/darkblackside/indoorbikejsconnector` somewhere with HTTPS (it serves the web app and
   the game server together; see [apps/server](apps/server/README.md#deployment-one-container)).
2. Server: the game loop in `RideRoom` (start when everyone is ready, shared `seed`, fixed tick with game-core rules).
3. Move the Zombie Ramp from the canvas renderer to three.js (start from the sandbox).

## Development

Requires Node.js ≥ 22.12.

The web app uses the private UI library `@darkblackside/ui` (repository `darkblackside/bm-ui-kit`) with its
`gamification` theme. It comes from GitHub Packages, so `npm install` needs a GitHub token with `read:packages` once
per machine. The connector, game-core and server do not depend on it.

```sh
npm run login:npm               # uses the GitHub CLI (gh) token, otherwise opens the page for a classic token
npm run login:npm -- --check    # checks the stored token and that the package is reachable
```

The token is stored in your user `~/.npmrc`, not in this repository (`.npmrc` here only maps the `@darkblackside`
scope to `npm.pkg.github.com`). CI installs with the workflow's `GITHUB_TOKEN`; that needs read access for this
repository in the package settings (*Manage Actions access*).

```sh
npm install          # installs and links all workspaces
npm test             # tests of every workspace (Node, no hardware needed)
npm run typecheck    # every workspace with its own tsconfig
npm run build        # connector, game-core and server -> their dist/
npm run build:web    # web app -> apps/web/dist (what GitHub Pages serves)
npm run dev          # web app at http://localhost:5173 (hub; /zombie-ramp/, /ftp20/, /horde/, /debug/, /sandbox/)
npm run dev:https    # same over HTTPS on your LAN, for testing from a phone/tablet
npm run dev:server   # multiplayer server at ws://localhost:8787 (restarts on changes)
npm run <script> -w <workspace>   # e.g. npm test -w @indoor-bike/game-core
```

The web app uses the workspace packages straight from their TypeScript sources (the `indoor-bike-source` export
condition, set in `apps/web/vite.config.ts` and `tsconfig.base.json`), so editing the connector or game-core
shows up in `npm run dev` and `npm run dev:server` (tsx with the same condition) without a build. The built server
(`npm start -w @indoor-bike/server`) loads their built `dist/` instead.

The debug bench (`/debug/`) can switch between real Bluetooth and the simulated devices, so ERG/SIM can be tried
without a trainer.

> Real-hardware status: the parsers are checked against the published specs (FTMS, Cycling Power,
> ANT+ FE-C) and the Wahoo encoding follows the open-source implementations (GoldenCheetah and others).
> So far everything has been verified only against the simulators. Please report results from real trainers.
