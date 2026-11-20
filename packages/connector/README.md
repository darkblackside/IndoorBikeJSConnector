# Indoor Bike JS Connector

A TypeScript library (no UI, no runtime dependencies) that connects smart trainers and
heart rate straps over **Web Bluetooth**, so you can build games and training apps on top of them.
It auto-detects the trainer's protocol and gives you one API for live data and resistance control,
in either **ERG** (hold a target wattage) or **SIM** (road grade/wind) mode.

This package lives in the `packages/connector` workspace of the
[IndoorBikeJSConnector](https://github.com/darkblackside/IndoorBikeJSConnector) monorepo.

**Try it:** [debug bench](https://sweat-games.lightwhiteside.de/debug/) and the
[Zombie Ramp](https://sweat-games.lightwhiteside.de/zombie-ramp/) FTP test game, in Chrome or Edge
(both also run with simulated devices).

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
- **Spin-down calibration:** `await bike.trainer.spinDown()` when `bike.trainer.spinDownSupported` (FTMS trainers that
  offer it, Tacx FE-C). The `spinDown` event tells the rider what to do: `speed-up` (above `targetSpeed.high` km/h),
  `coast` (stop pedalling), then `done` or `failed`. ERG/SIM is held back meanwhile and re-applied afterwards.
  `cancelSpinDown()` stops it; it also ends on a timeout (90 s) or a dropped connection. Not available for older
  Wahoo KICKRs without FTMS (use the Wahoo app) or power meters.
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
## Package layout

| Path | What | Published |
| --- | --- | :-: |
| `src/` | The library | ✓ |
| `src/parsers/` | Pure byte encoders/decoders per protocol | ✓ |
| `src/protocols/` | Protocol drivers: detection, handshake, ERG/SIM commands | ✓ |
| `testing/` | Fake Web Bluetooth stack + simulated trainers (FTMS, Wahoo, Tacx, power meter) and HRM. Used in the monorepo as `indoor-bike-js-connector/testing` | – |
| `test/` | Vitest unit tests (spec byte vectors) and integration tests against the simulators | – |

```sh
npm test -w indoor-bike-js-connector        # or `npm test` in this folder
npm run build -w indoor-bike-js-connector   # -> dist/ (ESM + .d.ts)
```

> Real-hardware status: the parsers are checked against the published specs (FTMS, Cycling Power,
> ANT+ FE-C) and the Wahoo encoding follows the open-source implementations (GoldenCheetah and others).
> So far everything has been verified only against the simulators. Please report results from real trainers.

