# Trackfire

A private, browser-based multiplayer tank game for you and your friends. It uses
low-poly 3D, runs on PC and phones, and needs no install. You create a room,
send the 5-letter code (or the invite link), and play.

- **Maps:** Dune Crossing (desert) and Pinewood Ford (forest, with a river and a single bridge)
- **Modes:** Team Deathmatch (first to 30 kills) and Free for All (first to 15). Matches have a 10-minute limit.
- **Players:** up to 8 per room. The host can fill empty slots with bots.
- **Practice:** play offline against bots. The full game server runs inside your browser.

## Run it on your computer

You need Node.js 20 or newer (22+ if you also want the test tools). There are no npm packages to install.

```bash
node server/index.js
# → Trackfire server on http://localhost:8080
```

Open http://localhost:8080. Friends on the same Wi-Fi can open `http://<your-computer's-IP>:8080`.
To play over the internet, see **DEPLOY.md**.

## Controls

| | PC | Phone / tablet (landscape) |
|---|---|---|
| Drive | **WASD** / arrows | Left thumb (a stick appears where you touch) |
| Aim turret | Mouse | Right thumb stick |
| Fire | Left click or Space (hold to keep firing) | Hold **FIRE** |
| Scoreboard | Hold **Tab** | ☰ button |
| Menu | **Esc** | ⚙ button |
| Debug panel | **F3** | Settings → Debug panel |

Settings → *PC controls* switches between **Direction** (the default: the tank turns
toward the WASD direction and drives) and **Classic** (W/S for throttle, A/D to rotate).
Try both and keep the one you prefer.

## How the networking works (the important part)

The previous version you tried moved remote tanks only when a packet arrived. This one
separates three clocks:

| Clock | Rate | Where it's set |
|---|---|---|
| Client rendering | As fast as the screen allows (usually 60 fps) | `requestAnimationFrame` |
| Server simulation | 30 fixed ticks per second | `NET.TICK_RATE` in `client/shared/config.js` |
| Network snapshots | 30 per second (set `SNAPSHOT_EVERY: 2` for 15) | `NET.SNAPSHOT_EVERY` |

- **Your own tank uses client-side prediction.** Every tick, your controls are sent
  to the server and the *same* movement code (`client/shared/sim.js`) runs locally
  straight away, so the tank reacts on the next frame. Snapshots report which of
  your inputs the server has applied. The client resets to the server's state,
  replays the rest, and blends any small difference out over about 60 ms
  (reconciliation, in `client/js/net/netclient.js`).
- **Other tanks use a snapshot buffer and interpolation.** They're drawn about 100 ms
  in the past (`INTERP_DELAY_MS`), blended between the two snapshots around that
  moment on every rendered frame. The delay grows automatically on a jittery
  connection. If snapshots stop arriving, tanks keep moving along their last
  velocity for up to 220 ms and then hold still. The game never freezes.
- **The server is authoritative.** Clients only send inputs (move direction, aim
  angle, fire button). The server moves tanks, fires shells, and decides hits,
  damage, kills and respawns. A client can't claim a hit.
- **Server input jitter buffer.** If a player's input arrives late, the server keeps
  their tank moving on its last input and pays that step back later, so nobody else
  sees a stall (`client/shared/room.js`).
- **Compact binary packets.** An input is 12 bytes. A snapshot is 18 bytes plus 18 per
  tank, sent as binary WebSocket frames with TCP_NODELAY on. Names, teams and
  scores are sent only when they change. With 8 tanks that's about 5 KB/s down and
  0.6 KB/s up per player.
- **Reconnect.** If a connection drops, the client reconnects on its own and gets its
  old slot and stats back (kept for 45 s). Reloading the page mid-match also puts
  you back in.

## Tests and tools

```bash
npm test                              # multiplayer acceptance test (headless, all latency profiles)
node tools/net-test.js 100 20         # one profile: 100 ms ping, ±20 ms jitter
node tools/bots.js F7K2Q 5            # 5 network bots join room F7K2Q (to watch from your browser)
node tools/bots.js F7K2Q 5 ws://localhost:8080/ws 150 30   # …with 150 ms ping and ±30 ms jitter
SIM_LATENCY_MS=75 node server/index.js                     # server adds delay to everything it sends
```

In the game, Settings → *Network test tools* adds a simulated ping (20/50/100/150 ms)
and jitter to your own browser. Press F3 to see FPS, ping, tick rate, snapshots per
second, interpolation delay, buffered snapshots, jitter, corrections and bandwidth.

**Measured results** (`npm test`: client A drives in continuous circles while firing;
client B renders A at 60 fps; 2 more clients and 2 bots are in the room):

| Simulated network | Frames rendered at 60 fps | Stalled frames | Teleports | Largest local correction |
|---|---|---|---|---|
| 0 ms | ~490 | 0 | 0 | 0 m |
| 20 ms ±5 | ~490 | 0 | 0 | 0.03 m |
| 50 ms ±10 | ~490 | 2 (0.4%) | 0 | 0.03 m |
| 100 ms ±20 | ~490 | 0 | 0 | 0.03 m |
| 150 ms ±30 | ~490 | 0 | 0 | 0.17 m |
| 100 ms ±60 (heavy jitter) | ~490 | 3 (0.6%) | 0 | 0.37 m |

A "stalled frame" means A moved less than 20% of what its speed implies during
one frame, for example while it was pushed against a rock. Corrections are
blended out over about 60 ms, so you don't see them as jumps.

Server load: 32 simulated players across 4 rooms used about 6% of one CPU core and 77 MB of RAM.

The browser tests (`tools/browser-test.py`, `tools/browser-test2.py`, which need Python
Playwright) cover two desktop browsers plus a phone joining by link, touch driving,
the smoothness check, practice mode with bots, reconnecting after a reload, and the
end-of-match screen. They run the real client with a stand-in for the 3D engine.

## Project layout

```
server/index.js        HTTP static files + WebSocket rooms + 30 Hz tick loop (zero dependencies)
server/ws.js           minimal WebSocket implementation (RFC 6455)
client/index.html      the whole UI (menu, lobby, HUD, touch controls, settings)
client/css/style.css
client/shared/         runs on BOTH server and browser
  config.js            ← gameplay and network numbers you can tweak
  sim.js               tank movement, collision, shells (used for prediction too)
  room.js              server-authoritative match logic (also powers practice mode)
  protocol.js          binary packet format
  maps.js              deterministic map layouts (obstacles and spawns)
  bot.js, math.js
client/js/
  main.js              screens and wiring
  net/                 connection (and latency simulator), prediction, interpolation
  game/                3D world, prefabs, tanks, shells, particles, camera and frame loop
  input/               keyboard/mouse, touch sticks
  ui/hud.js            HUD, scoreboard, minimap, debug panel
  audio/audio.js       procedural Web Audio sound effects and music
  practice-worker.js   offline mode: the server Room inside a Web Worker
tools/                 acceptance tests, bots, load and browser tests
```

## Tweaking

Everything gameplay-related is in `client/shared/config.js`: health (100), damage
(25–40), reload (2.2 s), shell speed and range, respawn time, spawn protection,
tank speed, acceleration, turning, turret speed, score limits and match time.
Camera angle and zoom are in `client/js/settings.js` (`CAMERA`). Restart the server
after changing shared values.
