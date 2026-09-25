// Simple bot brain used for "Add bot" in rooms, practice mode and load tests.
// It produces the same input objects a human client sends.
import { MODE_DIR } from './sim.js';
import { wrapAngle, dist } from './math.js';
import { GAME } from './config.js';

export class BotBrain {
  constructor(map, seed = 1) {
    this.map = map; this.wp = null; this.stuck = 0; this.lastX = 0; this.lastZ = 0;
    this.r = seed; this.fireHold = 0; this.skill = 0.6 + (seed % 5) * 0.08;
    this.strafe = 0;
  }
  rand() { this.r = (Math.imul(this.r ^ (this.r >>> 15), 2246822507) + 0x9e3779b9) | 0; return ((this.r >>> 0) % 10000) / 10000; }
  pickWaypoint(s) {
    const pts = this.map.spawns.any;
    for (let i = 0; i < 6; i++) { const p = pts[Math.floor(this.rand() * pts.length)]; if (dist(p[0], p[1], s.x, s.z) > 14) { this.wp = p; return; } }
    this.wp = pts[Math.floor(this.rand() * pts.length)];
  }
  /** s = own state, foes = [{x,z,v,yaw}] visible enemies. Returns an input. */
  think(s, foes, dt) {
    if (!this.wp || dist(this.wp[0], this.wp[1], s.x, s.z) < 5) this.pickWaypoint(s);
    // stuck detection → new waypoint
    const moved = dist(s.x, s.z, this.lastX, this.lastZ); this.lastX = s.x; this.lastZ = s.z;
    this.stuck = moved < 0.05 ? this.stuck + dt : 0;
    if (this.stuck > 1.2) { this.pickWaypoint(s); this.stuck = 0; this.strafe = 1.2; }
    let target = null, td = 38;
    for (const f of foes) { const d = dist(f.x, f.z, s.x, s.z); if (d < td) { td = d; target = f; } }
    let dir = Math.atan2(this.wp[0] - s.x, this.wp[1] - s.z), mag = 1;
    if (this.strafe > 0) { this.strafe -= dt; dir = wrapAngle(s.yaw + Math.PI + 0.6); mag = 0.8; }
    else if (target && td < 16) { dir = wrapAngle(Math.atan2(target.x - s.x, target.z - s.z) + Math.PI / 2); mag = 0.7; } // circle-strafe
    let aim = s.t, fire = false;
    if (target) {
      const lead = (td / GAME.SHELL_SPEED) * this.skill;
      const tx = target.x + Math.sin(target.yaw) * target.v * lead, tz = target.z + Math.cos(target.yaw) * target.v * lead;
      aim = Math.atan2(tx - s.x, tz - s.z) + (this.rand() - 0.5) * (1 - this.skill) * 0.25;
      fire = Math.abs(wrapAngle(aim - s.t)) < 0.08 && s.reload <= 0 && this.rand() < 0.35;
    } else aim = s.yaw;
    return { mode: MODE_DIR, dir, mag, throttle: 0, steer: 0, aim, fire };
  }
}
