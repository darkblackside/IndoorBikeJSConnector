# Indoor Bike JS Connector

A TypeScript library (no UI, no runtime dependencies) that connects smart trainers and
heart rate straps over **Web Bluetooth**, so you can build games and training apps on top of them.
It auto-detects the trainer's protocol and gives you one API for live data and resistance control,
in either **ERG** (hold a target wattage) or **SIM** (road grade/wind) mode.

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
bike.disconnect();
```

- `bike.data` always holds the latest merged snapshot, so you can poll it in a game loop instead of using events.
- `bike.trainer.protocolName`, `.capabilities` (`{ erg, simulation }`), `.powerRange` and `.mode` describe the connected trainer.
- Links that drop unexpectedly are reconnected automatically (`autoReconnect`, `reconnectDelays`), and the last ERG/SIM mode is re-applied.
- `connectTrainer({ device })` takes an already-known `BluetoothDevice` (e.g. from `navigator.bluetooth.getDevices()`) to reconnect without the chooser.
- `Trainer` and `HeartRateMonitor` can be used on their own. The `IndoorBike` facade just combines them.
- Pass `bluetooth` to use something other than `navigator.bluetooth` (for example the `webbluetooth` npm package in Node/Electron, or a mock).
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

## Development

Requires Node.js ≥ 22.12.

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

> Real-hardware status: the parsers are checked against the published specs (FTMS, Cycling Power,
> ANT+ FE-C) and the Wahoo encoding follows the open-source implementations (GoldenCheetah and others).
> So far everything has been verified only against the simulators. Please report results from real trainers.
