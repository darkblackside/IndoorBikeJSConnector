# Zombie Ramp (example game)

`npm run dev`, then open http://localhost:5173/zombie-ramp/. A ramp FTP test as a game:
you are the turquoise dot riding through a top-down city grid, turning at the street corners, with a
horde of red zombie dots behind you.

- Optional warm-up (3/5/10 min at a set wattage), then the target rises by 25 W (or 20 W) every minute.
- **Use ERG mode** (on by default): if the device supports it, the trainer holds each target. Turn it off, or use a
  device without ERG (e.g. a power meter), and the power is only read from the device: the HUD shows how far you
  are from the target and you match it with gears and cadence.
- The zombies run at the target wattage, you run at your measured power (3 s average). Hold the target and
  they stay behind (and creep a bit closer each step); fall short and they close in. If they catch you, the test ends.
- **Calibrate (spin-down)** in the setup, when the trainer supports it, guides you through the spin-down.
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
  (`packages/game-core/src/zombie-ramp/activity.ts`). No GPX: GPX points need GPS coordinates, which an indoor ride doesn't have.
- Works with a simulated smart trainer or power meter too (cadence and power sliders, "Stop pedalling" and
  "Watch takes control" buttons).
