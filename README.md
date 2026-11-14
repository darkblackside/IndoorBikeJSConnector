# Indoor Bike JS Connector

Browser app that connects to a smart trainer and a heart rate strap over **Web Bluetooth**,
shows live power, cadence, speed and heart rate, and controls the trainer in **ERG mode**
(hold a target wattage).

- Trainer: any trainer with the Bluetooth **Fitness Machine Service (FTMS)**, e.g. Wahoo KICKR / KICKR CORE
  (FTMS enabled in firmware), Tacx Neo/Flux, Elite, Saris, Zwift Hub.
- Heart rate: any standard BLE heart rate strap (Heart Rate Service).
- No runtime dependencies; TypeScript 7 + Vite 8 for development.

## Requirements

- Node.js ≥ 22.12
- A browser with Web Bluetooth: Chrome or Edge on desktop/Android (Linux may need
  `chrome://flags/#enable-experimental-web-platform-features`). Firefox and Safari don't support it;
  on iOS use the Bluefy browser.
- Web Bluetooth needs a secure context: `http://localhost` or HTTPS.

## Usage

```sh
npm install
npm run dev          # http://localhost:5173
npm run dev:https    # HTTPS on your LAN (self-signed cert) – for a phone/tablet
npm test             # parser/encoder unit tests
npm run build        # type-check + production build into dist/
```

Click **Connect trainer**, pick the trainer in the browser's chooser, optionally **Connect heart rate**.
Enter a target and press **Set** (or use ±10) to start ERG; **Free ride** releases ERG
(switches the trainer to simulation mode on a flat road).

If the trainer is also paired with Zwift, Wahoo app etc., close those first – FTMS allows one controller at a time.

## Layout

| Path | What |
| --- | --- |
| `src/ftms/` | Pure byte parsers/encoders: Indoor Bike Data, Control Point, Heart Rate (unit-tested) |
| `src/devices/sensor.ts` | Base class: chooser, connect, disconnect handling |
| `src/devices/ftmsTrainer.ts` | FTMS trainer: data notifications, control point (request control, ERG, SIM) |
| `src/devices/heartRateMonitor.ts` | Heart rate strap |
| `src/deviceManager.ts` | Owns devices, forwards target power from the store |
| `src/store.ts` | Observable app state |
| `src/main.ts` | UI wiring |
