# @indoor-bike/game-core

Game rules and simulation shared by the web client (`apps/web`) and the multiplayer server (`apps/server`).

| Entry | What |
| --- | --- |
| `@indoor-bike/game-core/zombie-ramp` | Ramp test (`rampStateAt`, `RampRecorder`, `StopDetector`, `speedFromPower`, …), the city simulation (`CityWorld`, `Route`, `mulberry32`) and the ride export (`buildActivity`, `encodeFit`, `encodeTcx`) |
| `@indoor-bike/game-core/net` | Draft multiplayer wire protocol: `ClientMessage`, `ServerMessage`, `PROTOCOL_VERSION`, `parseMessage`, `encodeMessage` |

Rules for code in here:

- No DOM, no canvas, no Web Bluetooth, no game engine (the tsconfig has no DOM lib). It must run in Node.
- No hidden randomness: take a `rand: () => number` (seeded with `mulberry32` in multiplayer).
- Simulation exposes plain state; renderers and engines read it, they never own it.

```sh
npm test -w @indoor-bike/game-core
npm run build -w @indoor-bike/game-core   # -> dist/ (what the Node server loads)
```
