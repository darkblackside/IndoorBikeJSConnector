# Impressum and Datenschutz

`impressum/index.html` and `datenschutz/index.html` (German, static HTML, styled by `src/legal/`) are linked from
the hub's footer; every game links back to the hub. Modelled on the Darkspace portal's pages. They cover both
`https://sweat-games.lightwhiteside.de` (the container, deployed by `darkblackside/infrastructure`,
`light-server/sweat-games`) and the GitHub Pages build.

**The privacy policy makes promises about the code and the server. Change it in the same PR as anything below**, and
update its date ("Stand").

| Promise | Where it is kept |
| --- | --- |
| No external requests (fonts, scripts, CDNs) | Fonts self-hosted in `src/common/fonts/` (`@fontsource`, OFL). No Google Fonts links, no analytics, no embeds |
| No cookies; `localStorage` holds only FTP and display name | `src/common/profile.ts` (`indoor-bike.ftp`, `indoor-bike.name`). A new key → list it |
| Bluetooth data stays in the browser; offline games send nothing | Only the online game talks to the server |
| **Heart rate never leaves the device** | Not part of the protocol: `RiderSample` (`game-core/net/messages.ts`) has no heart rate, `checkSample` drops anything else a client sends, the room states have no such field (protocol 2). Health data (Art. 9 GDPR): adding it needs explicit consent and a new policy first |
| Online game: name, workout, FTP, power, cadence; visible to everyone; in memory only, gone on leave (30 s reconnect window) | `apps/server/src/rooms/HordeRoom.ts`. Only the anonymous total sweat is persisted (`horde/store.ts`) |
| Server logs contain no personal data | `apps/server/src` logs only startup and store errors. Don't log names or IPs |
| Server logs (Traefik access log, with IPs) ≤ 7 days, not backed up | infrastructure: `setup-log-rotation.sh` (`ACCESS_LOG_ROTATE=7`) |
| Monitoring copy without IP/User-Agent/query, 14 days | infrastructure: Alloy, Loki/Tempo retention (same promise as Kleingarten's policy) |
| CrowdSec reports IPs of detected attacks to CrowdSec SAS | infrastructure: `light-server/crowdsec` (Central API enabled by default) |
| Hosting netcup (Germany); GitHub Pages build via GitHub (USA, DPF) | |
| Operator, address, phone, e-mail, supervisory authority (LDI NRW) | Same as the Darkspace portal's Impressum: change both together |

Adding something that collects more (accounts, chat, leaderboards with names, analytics, a new third party): add a
section to the policy before it ships.
