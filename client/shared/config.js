/* =====================================================================
   TRACKFIRE — shared configuration.
   Used by BOTH the server and the browser client, so gameplay rules and
   network timing can never drift apart. Edit values here, restart the
   server, and reload the page.
   ===================================================================== */

/* ---------------------------------------------------------------------
   NETWORK TIMING — three separate clocks:

   1. CLIENT RENDER RATE — every browser renders as fast as it can
      (requestAnimationFrame, normally 60 fps). Nothing below limits it.

   2. SERVER SIMULATION RATE (TICK_RATE) — the server advances the game
      in fixed steps of 1/TICK_RATE seconds. Each client input message
      covers exactly one of these steps, so the client and server run
      the same movement code with the same dt (needed for prediction).

   3. NETWORK SNAPSHOT RATE (TICK_RATE / SNAPSHOT_EVERY) — how often the
      server sends positions to clients. Remote tanks are drawn between
      two snapshots (interpolation), so they move smoothly at the render
      rate even though snapshots arrive only 30 times a second.
   --------------------------------------------------------------------- */
export const NET = {
  TICK_RATE: 30,            // server simulation steps per second
  SNAPSHOT_EVERY: 1,        // send a snapshot every N ticks (1 → 30/s, 2 → 15/s)

  // Remote tanks are drawn this far in the past, so there are always two
  // snapshots to blend between. 100 ms = ~3 snapshots of safety margin at
  // 30/s. The client raises it automatically when the connection is jittery.
  INTERP_DELAY_MS: 100,
  INTERP_DELAY_MAX_MS: 260,

  // If snapshots stop arriving (lag spike), keep remote tanks moving along
  // their last velocity for at most this long, then hold them still.
  EXTRAPOLATE_MAX_MS: 220,

  // Server-side input jitter buffer: each player's inputs are queued and
  // consumed one per tick. If the queue runs dry the server waits for up to
  // this many buffered inputs before resuming, which smooths out bursty
  // connections for everyone watching that tank.
  INPUT_BUFFER_MIN: 1,
  INPUT_BUFFER_MAX: 4,
  MAX_INPUTS_PER_TICK: 3,   // catch-up limit (also blocks speed hacks)
  MAX_INPUT_QUEUE: 20,

  // Local prediction: if the server disagrees with our predicted position
  // by more than this, snap instead of smoothing.
  SNAP_DISTANCE: 4,
  CORRECTION_HALF_LIFE_MS: 60, // how fast small corrections are blended out

  RECONNECT_GRACE_MS: 45000, // a dropped player's slot is kept this long
  PING_INTERVAL_MS: 1000,
};

/* --------------------------------------------------------------------
   GAMEPLAY — tweak freely.
   -------------------------------------------------------------------- */
export const GAME = {
  MAX_PLAYERS: 8,
  TANK_RADIUS: 1.75,          // collision circle for a tank (m)

  HP: 100,
  DAMAGE_MIN: 25,
  DAMAGE_MAX: 40,
  RELOAD_S: 2.2,
  SHELL_SPEED: 48,            // m/s
  SHELL_RANGE: 40,            // m
  SHELL_RADIUS: 0.25,

  RESPAWN_S: 4,
  SPAWN_SHIELD_S: 2.5,        // spawn protection (ends early if you fire)

  // Movement
  MAX_SPEED: 9.5,             // forward m/s
  MAX_REVERSE: 5.5,           // reverse m/s
  ACCEL: 13,                  // m/s² when speeding up
  BRAKE: 22,                  // m/s² when slowing / changing direction
  COAST: 9,                   // m/s² drag with no throttle
  TURN_RATE: 2.3,             // hull rad/s at full steer
  TURN_ACCEL: 11,             // rad/s²
  TURRET_SPEED: 3.4,          // turret rad/s
  REVERSE_ANGLE: 1.95,        // stick pointing more than ~112° behind → reverse

  MODES: {
    tdm: { name: 'Team deathmatch', scoreLimit: 30, timeLimitS: 600 },
    ffa: { name: 'Free for all',    scoreLimit: 15, timeLimitS: 600 },
  },
  END_SCREEN_S: 12,
};

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const ROOM_CODE_LENGTH = 5;
