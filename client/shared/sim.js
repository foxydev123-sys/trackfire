/* =====================================================================
   SHARED SIMULATION — the one movement/collision function that both the
   server (authoritative) and the client (prediction) run. Same inputs +
   same dt + same map ⇒ same result, which is what makes client-side
   prediction line up with the server almost exactly.
   ===================================================================== */
import { GAME } from './config.js';
import { clamp, wrapAngle, stepAngle, polyNearest, dist } from './math.js';

export const MODE_DIR = 0;     // stick / WASD direction: tank turns toward it and drives
export const MODE_CLASSIC = 1; // W/S throttle, A/D rotate hull

export function newTankState(x = 0, z = 0, yaw = 0) {
  return { x, z, yaw, v: 0, w: 0, t: yaw, reload: 0, shield: 0 };
}
export function copyState(o, s) {
  o.x = s.x; o.z = s.z; o.yaw = s.yaw; o.v = s.v; o.w = s.w; o.t = s.t; o.reload = s.reload; o.shield = s.shield; return o;
}

// Converts an input into throttle (-1..1) and steer (-1..1) for this hull.
function control(s, inp) {
  if (inp.mode === MODE_CLASSIC) return [inp.throttle, inp.steer];
  const mag = inp.mag;
  if (mag < 0.08) return [0, 0];
  const diff = wrapAngle(inp.dir - s.yaw);
  if (Math.abs(diff) > GAME.REVERSE_ANGLE) {
    // Stick points behind us → back up while turning the rear toward it.
    const d2 = wrapAngle(inp.dir + Math.PI - s.yaw);
    return [-mag * (Math.abs(d2) < 0.9 ? 1 : 0.35), clamp(d2 * 2.4, -1, 1)];
  }
  const a = Math.abs(diff);
  return [mag * (a < 0.55 ? 1 : Math.max(0.15, 1 - (a - 0.55) / 1.1)), clamp(diff * 2.4, -1, 1)];
}

/**
 * Advance one tank by one fixed step.
 * @param s      tank state (mutated)
 * @param inp    decoded input {mode, dir, mag, throttle, steer, aim, fire}
 * @param dt     step length (1 / NET.TICK_RATE)
 * @param map    shared map (colliders, river, bounds)
 * @param others array of {x, z} for other live tanks (may be empty)
 */
export function stepTank(s, inp, dt, map, others) {
  const [thr, steer] = control(s, inp);
  // --- throttle → forward speed, with acceleration and braking
  const target = thr >= 0 ? thr * GAME.MAX_SPEED : thr * GAME.MAX_REVERSE;
  let rate;
  if (Math.abs(thr) < 0.01) rate = GAME.COAST;
  else if (Math.sign(target) !== Math.sign(s.v) && Math.abs(s.v) > 0.05) rate = GAME.BRAKE;
  else rate = Math.abs(target) > Math.abs(s.v) ? GAME.ACCEL : GAME.BRAKE;
  const dv = target - s.v;
  s.v += clamp(dv, -rate * dt, rate * dt);
  // --- steering → hull yaw rate (slightly slower at top speed = weight)
  const speedK = 1 - 0.25 * Math.min(1, Math.abs(s.v) / GAME.MAX_SPEED);
  const wT = steer * GAME.TURN_RATE * speedK;
  s.w += clamp(wT - s.w, -GAME.TURN_ACCEL * dt, GAME.TURN_ACCEL * dt);
  s.yaw = wrapAngle(s.yaw + s.w * dt);
  // --- move
  s.x += Math.sin(s.yaw) * s.v * dt;
  s.z += Math.cos(s.yaw) * s.v * dt;
  collide(s, map, others);
  // --- turret turns toward the aim angle at a limited speed
  s.t = wrapAngle(stepAngle(s.t, inp.aim, GAME.TURRET_SPEED * dt));
  if (s.reload > 0) s.reload = Math.max(0, s.reload - dt);
  if (s.shield > 0) s.shield = Math.max(0, s.shield - dt);
}

function pushOut(s, cx, cz, minD) {
  const dx = s.x - cx, dz = s.z - cz; const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= minD) return false;
  const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
  s.x = cx + nx * minD; s.z = cz + nz * minD;
  // Remove the part of our velocity that drives into the obstacle (slide along it).
  const into = -(Math.sin(s.yaw) * nx + Math.cos(s.yaw) * nz) * Math.sign(s.v);
  if (into > 0) s.v *= 1 - 0.85 * into;
  return true;
}

export function collide(s, map, others) {
  const TR = GAME.TANK_RADIUS;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of map.near(s.x, s.z)) pushOut(s, c.x, c.z, c.r + TR);
    if (others) for (const o of others) pushOut(s, o.x, o.z, TR * 2);
    if (map.river) {
      const n = polyNearest(s.x, s.z, map.river);
      const limit = map.riverW - 0.4;
      if (n.d < limit) {
        const b = map.bridge;
        if (b && s.x > b.x0 - 1 && s.x < b.x1 + 1 && Math.abs(s.z - b.zc) < b.halfW + 1.4) {
          s.z = clamp(s.z, b.zc - b.halfW, b.zc + b.halfW); // bridge rails
        } else pushOut(s, n.x, n.z, limit);
      }
    }
  }
  const B = map.bound;
  if (s.x < -B) { s.x = -B; s.v *= 0.5; } else if (s.x > B) { s.x = B; s.v *= 0.5; }
  if (s.z < -B) { s.z = -B; s.v *= 0.5; } else if (s.z > B) { s.z = B; s.v *= 0.5; }
}

// Where a shell leaves the barrel (2D) for a given tank state.
export const MUZZLE_DIST = 3.4;
export function muzzleOf(s) {
  return { x: s.x + Math.sin(s.t) * MUZZLE_DIST, z: s.z + Math.cos(s.t) * MUZZLE_DIST };
}

/**
 * Move a shell by dt. Returns null (still flying) or
 * {hit:'tank', id, x, z} | {hit:'wall', x, z} | {hit:'range', x, z}.
 * `tanks` = [{id, x, z, alive}] (server: live positions).
 */
export function stepShell(sh, dt, map, tanks) {
  const SUB = 3, step = (GAME.SHELL_SPEED * dt) / SUB, R = GAME.TANK_RADIUS + GAME.SHELL_RADIUS;
  for (let i = 0; i < SUB; i++) {
    sh.x += sh.dx * step; sh.z += sh.dz * step; sh.trav += step;
    for (const t of tanks) {
      if (!t.alive || t.id === sh.owner) continue;
      if (dist(sh.x, sh.z, t.x, t.z) < R) return { hit: 'tank', id: t.id, x: sh.x, z: sh.z };
    }
    for (const c of map.near(sh.x, sh.z)) if (dist(sh.x, sh.z, c.x, c.z) < c.r + GAME.SHELL_RADIUS) return { hit: 'wall', x: sh.x, z: sh.z };
    if (sh.trav >= sh.max || Math.abs(sh.x) > 90 || Math.abs(sh.z) > 90) return { hit: 'range', x: sh.x, z: sh.z };
  }
  return null;
}

/**
 * One full player tick: movement + firing. Returns true if a shell was fired.
 * Server and client prediction both call exactly this.
 */
export function simulateInput(s, inp, dt, map, others) {
  stepTank(s, inp, dt, map, others);
  if (inp.fire && s.reload <= 0) { s.reload = GAME.RELOAD_S; s.shield = 0; return true; }
  return false;
}
