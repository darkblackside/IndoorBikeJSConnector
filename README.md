# Indoor Bike JS Connector

A TypeScript library (no UI, no runtime dependencies) that connects smart trainers and
heart rate straps over **Web Bluetooth**, so you can build games and training apps on top of them.
It auto-detects the trainer's protocol and gives you one API for live data and resistance control,
in either **ERG** (hold a target wattage) or **SIM** (road grade/wind) mode.

**Try it:** [test bench](https://darkblackside.github.io/IndoorBikeJSConnector/) and the
[Zombie Ramp](https://darkblackside.github.io/IndoorBikeJSConnector/zombie-ramp/) FTP test game, in Chrome or Edge
(both also run with simulated devices). Deployed from `master` by `.github/workflows/pages.yml`.

| Protocol | Devices | Data | ERG | SIM |
| --- | --- | :-: | :-: | :-: |
| **FTMS** (Fitness Machine Service) | Current Wahoo KICKR/CORE/SNAP, Tacx/Garmin, Elite, Saris, JetBlack, Zwift Hub, Wattbike… | ✓ | ✓ | ✓ |
| **Wahoo legacy** (Cycling Power + Wahoo control point) | Older KICKR / KICKR SNAP / KICKR CORE without FTMS firmware | ✓ | ✓ | ✓ |
| **Tacx FE-C over BLE** | Tacx Neo/Flux/Vortex/Bushido/Genius, some Elite | ✓ | ✓ | ✓ |
| **Cycling Power** | Power meters and other trainers (read-only fallback) | ✓ | – | – |
| **Heart Rate Service** | Any BLE HR strap/watch | ✓ | | |

Protocols are tried in that order. If a device offers FTMS but refuses control (some older
Wahoo firmware), the library falls back to the next protocol on the same device.

## Install

```sh
npm install indoor-bike-js-connector   # or point at this git repo
```

Web Bluetooth works in Chrome and Edge on desktop and Android (Bluefy browser on iOS). It needs a
secure context (`https://` or `http://localhost`), and the device chooser can only be opened
from a user gesture.

## Usage

```ts
import { IndoorBike } from "indoor-bike-js-connector";

const bike = new IndoorBike({ rider: { riderWeight: 78, bikeWeight: 8.5 } });

bike.on("data", (d) => {
  // { power, cadence, speed, heartRate, distance }; a field is undefined until reported
  player.setPower(d.power ?? 0);
});
bike.on("status", ({ device, status }) => hud.show(device, status)); // connecting/connected/reconnecting/disconnected
bike.on("error", ({ device, error }) => console.warn(device, error));

connectButton.onclick = () => bike.connectTrainer();      // opens the browser chooser
hrButton.onclick = () => bike.connectHeartRateMonitor();

// ERG
bike.setTargetPower(220);

// SIM: call it every frame if you like. Updates are coalesced (only the latest
// is sent, one command in flight, unchanged values skipped).
bike.setSimulation({ grade: track.gradeAt(player.x), windSpeed: 2 });

bike.freeRide();   // flat road, rider controls effort

// Read-only: stop controlling the trainer and just read its data.
// Lifts an active ERG target first; nothing is re-applied on reconnect.
bike.releaseControl();

// Pick a mode per device: ERG where supported (and wanted), otherwise read the power.
if (useErg && bike.trainer.capabilities.erg) bike.setTargetPower(target);
else bike.releaseControl();

bike.disconnect();
```

- `bike.data` always holds the latest merged snapshot, so you can poll it in a game loop instead of using events.
- `bike.trainer.protocolName`, `.capabilities` (`{ erg, simulation }`), `.powerRange`, `.mode` and `.ergActive` describe the connected trainer.
  `ergActive` is only true while the trainer really accepted the ERG target. The `control` event
  (`{ capabilities, controlDenied, ergActive }`, on `bike` and `bike.trainer`) fires whenever that changes, so show
  ERG in your UI only while it works.
- The current ERG/SIM mode is sent again every 5 s when nothing else was sent (`refreshInterval`, 0 turns it off).
- Links that drop unexpectedly are reconnected automatically (`autoReconnect`, `reconnectDelays`), and the last ERG/SIM mode is re-applied.
- `connectTrainer({ device })` takes an already-known `BluetoothDevice` (e.g. from `navigator.bluetooth.getDevices()`) to reconnect without the chooser.
- `Trainer` and `HeartRateMonitor` can be used on their own. The `IndoorBike` facade just combines them.
- Pass `bluetooth` to use something other than `navigator.bluetooth` (for example the `webbluetooth` npm package in Node/Electron, or a mock).
- **Sharing the trainer with a watch** (e.g. a Garmin paired to the same trainer): both can be connected at the
  same time and both get the data. FTMS lets only one client control the trainer, though:
  - Watch first, then the app: if the watch holds control, the trainer still connects (data, read-only) and
    `controlDenied` is true. Every ERG/SIM command (at most every 5 s) tries to take control; once the trainer gives
    it, ERG works. Many trainers hand control to whoever asked last, so this usually works at once.
  - App first, then the watch: when the watch takes control, resets the trainer or sets its own target, the trainer
    reports it (Fitness Machine Status) and the app takes control back and sends its target again. Trainers that don't
    report it are caught by the 5 s refresh.
  - If the trainer refuses (strict FTMS), ERG is not available while the watch holds control: pair the watch to the
    trainer as a power/speed sensor only, not as a controllable smart trainer.
- Pass `drivers` to change the protocol order or add your own `ProtocolDriver`. Low-level encoders/decoders are exported as `ftms`, `wahoo`, `fec` and `cyclingPower`.

## Repository layout

| Path | What | Published |
| --- | --- | :-: |
| `src/` | The library | ✓ |
| `src/parsers/` | Pure byte encoders/decoders per protocol | ✓ |
| `src/protocols/` | Protocol drivers: detection, handshake, ERG/SIM commands | ✓ |
| `testing/` | Fake Web Bluetooth stack + simulated trainers (FTMS, Wahoo, Tacx, power meter) and HRM | – |
| `test/` | Vitest unit tests (spec byte vectors) and integration tests against the simulators | – |
| `demo/` | Manual test bench page (real Bluetooth or simulated devices) | – |
| `demo/zombie-ramp/` | Zombie Ramp: example game, a ramp FTP test (see below) | – |

## Development

Requires Node.js ≥ 22.12.

The demo pages use the private UI library `@darkblackside/ui` (repository `darkblackside/bm-ui-kit`) with its
`gamification` theme. It comes from GitHub Packages, so `npm install` needs a GitHub token with `read:packages` once
per machine. The library itself (`src/`, `dist/`) does not depend on it.

```sh
npm run login:npm               # uses the GitHub CLI (gh) token, otherwise opens the page for a classic token
npm run login:npm -- --check    # checks the stored token and that the package is reachable
```

The token is stored in your user `~/.npmrc`, not in this repository (`.npmrc` here only maps the `@darkblackside`
scope to `npm.pkg.github.com`). CI installs with the workflow's `GITHUB_TOKEN`; that needs read access for this
repository in the package settings (*Manage Actions access*).

```sh
npm install
npm test             # unit + integration tests (Node, no hardware needed)
npm run typecheck
npm run build        # library -> dist/ (ESM + .d.ts)
npm run dev          # demo test bench at http://localhost:5173
npm run dev:https    # same over HTTPS on your LAN, for testing from a phone/tablet
```

The demo can switch between real Bluetooth and the simulated devices, so ERG/SIM can be tried
without a trainer.

### Zombie Ramp (example game)

`npm run dev`, then open http://localhost:5173/zombie-ramp/. A ramp FTP test as a game:
you are the turquoise dot riding through a top-down city grid, turning at the street corners, with a
horde of red zombie dots behind you.

- Optional warm-up (3/5/10 min at a set wattage), then the target rises by 25 W (or 20 W) every minute.
- **Use ERG mode** (on by default): if the device supports it, the trainer holds each target. Turn it off, or use a
  device without ERG (e.g. a power meter), and the power is only read from the device: the HUD shows how far you
  are from the target and you match it with gears and cadence.
- The zombies run at the target wattage, you run at your measured power (3 s average). Hold the target and
  they stay behind (and creep a bit closer each step); fall short and they close in. If they catch you, the test ends.
- **Use ERG mode** is only offered while ERG works with the connected trainer. During the test the HUD shows "ERG"
  only while the trainer really holds the target; if it stops (e.g. a watch takes control of the trainer) it switches
  to "match it" until ERG is back.
- Stop pedalling (cadence below 20 rpm, or no data, for 4 s) during the warm-up and the warm-up pauses until you
  pedal again. Once the ramp has started, stopping ends the test with the result screen:
  FTP = target of the last fully completed minute × 0.75, shown with a ±10 % margin (a ramp test can be off by up
  to about 10 % from a 20-/60-minute test; strong sprinters tend to come out too high, endurance riders too low), plus W/kg,
  best 1-min power and a chart with tabs for power (with the target), cadence, heart rate and distance.
- The HUD shows cadence, heart rate and distance while you ride.
- The result screen also shows average power, cadence and heart rate, distance and work, and lets you download the
  ride as **.fit** (best) or **.tcx** for Strava, Garmin Connect, TrainingPeaks, intervals.icu and co: an indoor
  ride with power, cadence, heart rate, speed/distance and one lap per warm-up/ramp step
  (`demo/zombie-ramp/activity.ts`). No GPX: GPX points need GPS coordinates, which an indoor ride doesn't have.
- Works with a simulated smart trainer or power meter too (cadence and power sliders, "Stop pedalling" and
  "Watch takes control" buttons).

> Real-hardware status: the parsers are checked against the published specs (FTMS, Cycling Power,
> ANT+ FE-C) and the Wahoo encoding follows the open-source implementations (GoldenCheetah and others).
> So far everything has been verified only against the simulators. Please report results from real trainers.
