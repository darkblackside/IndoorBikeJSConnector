# @indoor-bike/game-core

Game rules and simulation shared by the web client (`apps/web`) and the multiplayer server (`apps/server`).

| Entry | What |
| --- | --- |
| `@indoor-bike/game-core/zombie-ramp` | Ramp test (`rampStateAt`, `RampRecorder`, `StopDetector`, `speedFromPower`, …), the city simulation (`CityWorld`, `Route`, `mulberry32`) and the ride export (`buildActivity`, `encodeFit`, `encodeTcx`) |
| `@indoor-bike/game-core/ftp20` | 20-minute FTP test: block plan with coaching texts (`planBlocks`, `blockAt`, `ergTargetAt`), max HR and HR guide (`maxHeartRate`, `heartRateGuide`), the session clock with skip/pause/stop decisions (`Ftp20Session`), the pacing coach (`PacingCoach`), recording and result (`Ftp20Recorder`, `ftp20Result`, `pacingSummary`, `resultNote`). `buildActivity` also takes a list of lap start times for its laps |
| `@indoor-bike/game-core/horde` | Feed the Horde: sweat relative to FTP (`sweatPerSecond`, `intensityOf`, `MULTIPLIER_STEPS`, `FRENZY`), the workouts (`getWorkout`, `listWorkouts`, full and short), one rider's session with block judging and multiplier (`RiderSession`), horde levels (`hordeLevel`, `hordeRoster`) and the bots (`BOT_PERSONAS`, `BotPilot`) |
| `@indoor-bike/game-core/net` | Multiplayer protocol for the Colyseus server and client: room state (`RideState`, `RiderState`, `HordeState`, `HordeRider`, Colyseus schema), `RIDE_ROOM`, `HORDE_ROOM`, `JoinOptions`, `ClientMessages`, `HordeClientMessages`, `HordeServerMessages`, `PROTOCOL_VERSION` and validators (`checkJoinOptions`, `checkSample`, `checkHordeJoin`, `checkStart`) |

Rules for code in here:

- No DOM, no canvas, no Web Bluetooth, no game engine (the tsconfig has no DOM lib). It must run in Node.
  Its only dependency is `@colyseus/schema` (isomorphic) for the room state.
- No hidden randomness: take a `rand: () => number` (seeded with `mulberry32` in multiplayer).
- Simulation exposes plain state; renderers and engines read it, they never own it.

```sh
npm test -w @indoor-bike/game-core
npm run build -w @indoor-bike/game-core   # -> dist/ (what the Node server loads)
```
