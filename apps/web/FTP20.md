# 20-min FTP test

`npm run dev`, then open http://localhost:5173/ftp20/. The classic 20-minute FTP test as a linear runner: a
third-person view behind a stylised cyclist on a road that runs into the distance (three.js, flat-shaded low-poly,
no textures). Your power sets your speed. No jumping, no lane changes: the game is a coach, not an obstacle course.

## Protocol

About 50 minutes, explained on the setup screen. **FTP = average power of the 20-minute test × 0.95.**

| Phase | Time | Block | Power | Cadence | Feels | HR guide (of max) |
| --- | --- | --- | --- | --- | --- | --- |
| Warm-up (ERG) | 0–5 | Easy spin | easy | 85–95 | very easy, you could chat (RPE 2–3) | 60–70 % |
| | 5–10 | Build | moderate (midpoint) | 88–92 | comfortable, breathing a bit deeper (RPE 4) | 70–75 % |
| | 10–13 | Spin-ups | moderate | 90–110 | light, quick legs; 3 × 20 s at 110+ rpm (RPE 4–5) | 70–80 % |
| | 13–15 | Opener | hard | 95–100 | hard, a few words only, HR briefly towards ~90 % (RPE 8) | 85–90 % |
| | 15–20 | Recover | easy | 85–95 | recover fully, breathing calms down (RPE 2) | 55–70 % |
| Test (no ERG) | 0–5 | Controlled start | you | 85–95 | controlled, do NOT start too hot (RPE ~7) | 85–90 % |
| | 5–10 | Settle in | you | 85–95 | heavy but rhythmic breathing (RPE 8) | 88–92 % |
| | 10–15 | Hold it | you | 85–95 | the hardest part mentally, hold the power (RPE 8–9) | 90–95 % |
| | 15–20 | Empty the tank | you | 90–100 | from 17:00 everything you have left (RPE 10) | 93–100 % |
| Cool-down (ERG) | 0–5 | Spin easy | easy | 85–95 | let your heart rate come down (RPE 2) | 50–65 % |
| | 5–10 | Wind down | 85 % of easy | 80–90 | breathing back to normal (RPE 1–2) | 45–60 % |

- **Easy** and **hard (opener)** wattages are entered at the start; moderate is their midpoint.
- The last 10 s of the warm-up are a countdown: the trainer lets go so you can shift into your test gear.
- **Heart rate is a soft guide.** Max HR is the one you enter, otherwise 208 − 0.7 × age (Tanaka); without either,
  the coach shows only feeling and cadence. No caps, no penalties: the feeling matters more.
- **Skip** buttons: skipping the warm-up (after a confirmation) jumps to the 10 s countdown; skipping the cool-down
  goes to the result.

## ERG

Warm-up and cool-down use ERG when the trainer supports it ("Use ERG for warm-up and cool-down"); otherwise the HUD
shows the target and how far you are from it ("match it"), like the Zombie Ramp. The 20-minute test never uses ERG:
the trainer is released (flat road) and you set the power with gears and cadence.

## Pacing coach (no numbers during the test)

During the test the HUD never shows an FTP, a projected FTP or your average in watts; only the current power (3 s
average). A steadiness gauge shows where your last ~20 s sit relative to *your own* test average (steady band
±3 %, full scale ±16 %), with advice adapted to the block: "Too hot – ease off a little", "Steady, hold this",
"You have more – push", and from 17:00 "empty the tank". The first minute has no gauge (no average yet).
Logic: `packages/game-core/src/ftp20/pacing.ts`.

## Stopping

- Warm-up / cool-down: stop pedalling (cadence below 20 rpm, or no data, for 5 s) and the session pauses until you
  pedal again.
- Test: the clock pauses and a dialog asks **Continue** (the test goes on, but is marked interrupted and the FTP is
  shown as *unreliable*: the break lets you recover) or **Abort test** (result screen without an FTP; back to the
  setup if hardly anything was recorded). **Paused time is excluded from the 20 minutes**: the clock waits, and is
  wound back to the moment you stopped pedalling.

## Scenery

City, fields, forest, mountains (snow), desert and beach, changing every 5 minutes of riding and at the start of the
test (so each 5-minute test block gets its own). Sky, fog, road and distant hills blend over a few seconds; new
ground and objects stream in from the horizon. Objects are pooled and recycled; each primitive type is one
`InstancedMesh`; the pixel ratio is capped (1.5 on phones). Code: `src/ftp20/runnerScene.ts`, `src/ftp20/scenery.ts`.

## Result

FTP (20-min average × 0.95; "unreliable" if interrupted, none if incomplete or aborted), W/kg if a weight was
entered, a pacing verdict (even / faded / negative split, from the two halves), the 5-minute block averages,
steadiness (variation of the 30 s power), max power, average cadence and heart rate, a chart (power with the ERG
targets and the test average, cadence, heart rate, distance) and **.fit** / **.tcx** downloads with one lap per
block (`buildActivity` with lap start times).

## Testing without a trainer

Pick **Simulated smart trainer** (or power meter). The sim panel has cadence and power sliders, "Stop pedalling" and
a **time** slider (1–60× speed). Everything timed runs on the game clock: blocks, cues, countdown, scenery changes,
the recorder's 1 Hz samples (the clock advances in ≤ 1 s steps, so no second is skipped) and distance. Stop detection
uses real seconds (a real rider stops in real time) and then winds the game clock back to the moment pedalling stopped.
At 60× the whole session takes under a minute. The simulated heart rate follows the power.
