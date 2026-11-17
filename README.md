# Indoor Bike JS Connector

Games and training apps for smart trainers in the browser. This repository is an npm-workspaces monorepo:

| Workspace | Package | What | Runs in |
| --- | --- | --- | --- |
| `packages/connector` | `indoor-bike-js-connector` (published) | The Web Bluetooth trainer/HR library: FTMS, Wahoo, Tacx FE-C, Cycling Power, ERG/SIM. No UI, no runtime deps. **[Docs](packages/connector/README.md)** | Browser |
| `packages/game-core` | `@indoor-bike/game-core` (private) | Game rules and simulation (Zombie Ramp: ramp test, city/horde, .fit/.tcx export) and the multiplayer message types. No DOM, no engine | Browser + Node |
| `apps/web` | `@indoor-bike/web` (private) | Frontend (Vite): trainer test bench and the [Zombie Ramp](apps/web/ZOMBIE_RAMP.md) game | Browser |
| `apps/server` | `@indoor-bike/server` (private) | Multiplayer backend (Node, WebSocket). **Placeholder, not implemented yet** ([plan](apps/server/README.md)) | Node |

**Try it:** [test bench](https://darkblackside.github.io/IndoorBikeJSConnector/) and the
[Zombie Ramp](https://darkblackside.github.io/IndoorBikeJSConnector/zombie-ramp/) FTP test game, in Chrome or Edge
(both also run with simulated devices). Deployed from `main` by `.github/workflows/pages.yml`.

## Architecture

```
            Web Bluetooth                              WebSocket (later)
 trainer ──────────────▶ connector ──▶ apps/web ◀─────────────────────▶ apps/server
 HR strap                (browser)     │  renders, reads input            │  authoritative game loop
                                       ▼                                  ▼
                                  game-core  ◀──── same code ────▶  game-core
                          (rules, simulation, net message types)
```

- **connector stays separate.** It knows nothing about games, the web app or the server, and is published on its own.
  Only the web app depends on it (the server never talks to Bluetooth).
- **game-core holds the game, not the screen.** Simulation code (`CityWorld`, `rampStateAt`, `RampRecorder`, …) has no
  DOM access, so the Node server can run exactly the same rules. Its tsconfig has no DOM lib to keep it that way.
  All randomness is injectable: `new CityWorld(mulberry32(seed))` builds the same city on every client.
- **Rendering is a replaceable layer.** `apps/web/src/zombie-ramp/cityRenderer.ts` draws a `CityWorld` on a 2D canvas
  and only owns the camera. A game engine (`apps/web/src/engine/`) plugs in the same way: it reads game-core state
  each frame and renders it, it does not own game state.
- **Multiplayer contract first.** `@indoor-bike/game-core/net` has the draft client/server messages
  (`ClientMessage`, `ServerMessage`, `PROTOCOL_VERSION`), shared by both sides from day one.

### Next steps (not done yet)

1. Pick the frontend engine and add it to `apps/web` (e.g. Phaser for 2D; Babylon.js or three.js for 3D).
2. Implement `apps/server`: WebSocket server (e.g. `ws`, or Colyseus for rooms/state sync), rooms, a fixed-tick loop
   running game-core, snapshots to clients. See [apps/server/README.md](apps/server/README.md).
3. Add a net client in `apps/web` that sends `sample` messages from the connector's `data` events and applies snapshots.

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
npm run build        # connector + game-core -> dist/, server -> dist/
npm run build:web    # web app -> apps/web/dist (what GitHub Pages serves)
npm run dev          # web app at http://localhost:5173 (test bench; Zombie Ramp at /zombie-ramp/)
npm run dev:https    # same over HTTPS on your LAN, for testing from a phone/tablet
npm run <script> -w <workspace>   # e.g. npm test -w @indoor-bike/game-core
```

The web app uses the workspace packages straight from their TypeScript sources (the `indoor-bike-source` export
condition, set in `apps/web/vite.config.ts` and `tsconfig.base.json`), so editing the connector or game-core
shows up in `npm run dev` without a build. Node (the server) loads their built `dist/` instead.

The test bench can switch between real Bluetooth and the simulated devices, so ERG/SIM can be tried
without a trainer.

> Real-hardware status: the parsers are checked against the published specs (FTMS, Cycling Power,
> ANT+ FE-C) and the Wahoo encoding follows the open-source implementations (GoldenCheetah and others).
> So far everything has been verified only against the simulators. Please report results from real trainers.
