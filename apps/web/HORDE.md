# Feed the Horde (online, co-op)

`npm run dev:server` and `npm run dev`, then open http://localhost:5173/horde/ (or the **Online** tab of the hub).

The undead are restless; only sweat keeps them behind the barrier. Everyone online feeds **one shared, persistent
horde**: a cookie-clicker counter that never resets, driven by how hard people ride. The page connects as soon as it
opens, so you watch the arena (and the other riders) while you set up.

## Setup

- **Name**: free text, no account (kept in this browser).
- **FTP**: needed to judge effort fairly. The FTP tests save their result in this browser (`localStorage`
  `indoor-bike.ftp`, written by the [20-min FTP test](FTP20.md) when the test was clean and by the
  [Zombie Ramp](ZOMBIE_RAMP.md)); this page fills it in. Without one, the page links both tests. Typing an FTP saves it
  too (`source: "manual"`). Helper: `src/common/profile.ts`.
- **Workout**: free play or one of the workouts below, each as **Short (~20 min)** or **Full**.
- **ERG** (optional): the trainer holds the middle of each block's band. Sprints and free play always ride free.
- **Trainer**: Bluetooth trainer/power meter, or the simulated trainer (with a "follow the target" rider for testing).

## Sweat

Sweat is counted **on the server** from the power samples, relative to the rider's FTP (like TSS):
`sweat/s = (power / FTP)² × 10 000 / 3600 × multiplier × frenzy`. An hour at FTP is 10 000 drops for a 150 W rider and a
350 W rider alike. Intensity is capped at 250 % FTP. Code: `packages/game-core/src/horde/sweat.ts`.

## Workouts

Targets are fractions of FTP (`packages/game-core/src/horde/workouts.ts`). Long steady parts are split into
several judged blocks, so there are more chances to climb the multiplier.

| Workout | Full | Short (~20 min) | Main work |
| --- | --- | --- | --- |
| Free play | open end | open end | judged in 3-minute stretches |
| Recovery ride | 40 min | 20 min | 45–60 % |
| Endurance | 60 min | 20 min | Zone 2, 62–75 % |
| Tempo | 64 min | 20 min | 3×12 / 2×5 min at 76–87 % |
| Sweet Spot | 55 min | 20 min | 3×10 / 2×5 min at 88–94 % |
| Threshold | 70 min (2×20) | 20 min (2×5) | 95–105 % |
| Over-Unders | 66 min | 20 min | 2 min at 90–97 % / 1 min at 103–110 % |
| VO2max | 54 min (5×3) | 20 min (3×2) | 110–120 % |
| Speed & Sprints | 42 min | 19 min | high-cadence spin-ups and 15 s sprints (≥150 %) |

## Effects for good effort

- **Block multiplier**: a block counts as *on target* when its average is inside the band (±3 % FTP tolerance) and
  at least 70 % of it was inside. Sprints (< 30 s) only need the average above the floor. Free play: a 3-minute
  stretch counts when its average is ≥ 55 % FTP and steady (variation ≤ 15 %). On target: multiplier one step up
  (×1 → ×1.25 → ×1.5 → ×2 → ×2.5 → ×3) and the streak grows; a miss drops one step and resets the streak. The workout
  clock waits while you're not pedalling.
- **Group frenzy**: three or more riders on target at the same time for 5 s start a feeding frenzy: ×1.5 for everyone
  riding, as long as it holds (+20 s).
- **Horde levels**: level *n* needs 5 000 × (n − 1)² sweat. The horde grows (walkers, brutes from level 3, wraiths from
  level 6, a giant from level 9) and gets a new name: Stirring Graveyard, Shambling Pack, Moaning Mob, Hungry Horde, …
- **Hunger**: the horde's mood follows everyone's sweat rate right now. Fed, it stays calm in the middle and the barrier
  glows green; starving, it pushes out against a flickering red barrier and stares at the riders.
- **Personal records** (this browser): best session, longest streak, top multiplier, all-time sweat.

## Arena

Only riders who are riding are on the ring; people who are just watching are listed under the rider list. Laps
get faster with intensity, sweat drops arc from each rider into the horde (more and bigger with a multiplier, red in a
frenzy). Two drafts, switchable at the top right (remembered per browser):

- **3D**: a tilted, slowly orbiting camera over a moonlit graveyard arena, low-poly undead, glowing bikes.
- **2D**: a flat top view like a tactical map.

Both draw the same model (`src/horde/arenaSim.ts`) with one renderer (`src/horde/arenaRenderer.ts`, style `"3d"` or
`"2d"`); the arena is centred in the part of the screen the panels leave free.

## Bots

Three simulated riders (Grim Gertrud, Bonecrusher Bo, Night Nurse Nia) live in the server's persistent room: each
shows up every few minutes, rides a workout it likes (mostly the short version) or some free play, and leaves again.
When a person joins and no bot is riding, the next one arrives within ~30 s. They feed the horde like everyone else
and count for the frenzy. `HORDE_BOTS=0` turns them off. Code: `packages/game-core/src/horde/bots.ts` (how they
pedal), `apps/server/src/horde/bots.ts` (when they come and go).

## Cheating

Co-op with no prizes, so only light protection: the server computes all sweat from samples (clients never report
sweat), checks every message's ranges, fixes the FTP per session (50–600 W), caps intensity, disconnects message
floods, and caps a rider whose 5-minute average stays above 135 % of their FTP to 100 % (the HUD then asks whether
their FTP is right).
