/* Visual shells (pooled). The server decides real hits; these only show
   the projectile. Your own shells are spawned the instant you fire
   (prediction) and matched to the server's shot when it arrives. */
import * as THREE from '../three.js';
import { G } from './batch.js';
import { GAME } from '../../shared/config.js';
import { dist } from '../../shared/math.js';

export class Shells {
  constructor(scene) {
    const coreM = new THREE.MeshBasicMaterial({ color: 0xfff3c2, fog: false });
    const trailM = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.pool = []; this.list = [];
    for (let i = 0; i < 40; i++) {
      const g = new THREE.Group();
      const c = new THREE.Mesh(G.box, coreM); c.scale.set(0.2, 0.2, 0.7); g.add(c);
      const tr = new THREE.Mesh(G.box, trailM); tr.scale.set(0.14, 0.14, 2.4); tr.position.z = -1.4; g.add(tr);
      g.visible = false; scene.add(g); this.pool.push(g);
    }
  }
  spawn({ x, z, a, y = 1.5, id = 0, own = false, seq = 0, owner = 0 }) {
    const g = this.pool.pop(); if (!g) return null;
    const s = { g, x, z, y, dx: Math.sin(a), dz: Math.cos(a), trav: 0, id, own, seq, owner, done: false, boomAt: null };
    g.visible = true; g.position.set(x, y, z); g.rotation.set(0, a, 0);
    this.list.push(s); return s;
  }
  byId(id) { return this.list.find(s => s.id === id); }
  bySeq(seq) { return this.list.find(s => s.own && s.seq === seq && !s.id); }
  remove(s) { if (!s || s.done) return; s.done = true; s.g.visible = false; this.pool.push(s.g); this.list.splice(this.list.indexOf(s), 1); }
  /**
   * Advance visuals. `blocking(x,z)` → true if an obstacle is there; `tanks` = rendered tanks [{id,x,z}].
   * Calls onImpact(shell, x, z) for a cosmetic local impact (own shells only react instantly).
   */
  update(dt, map, tanks, onImpact) {
    const step = GAME.SHELL_SPEED * dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.boomAt) { this.remove(s); continue; }
      s.x += s.dx * step; s.z += s.dz * step; s.trav += step;
      s.g.position.set(s.x, s.y, s.z);
      let hit = false;
      for (const c of map.near(s.x, s.z)) if (dist(s.x, s.z, c.x, c.z) < c.r) { hit = true; break; }
      if (!hit && s.own) for (const t of tanks) if (t.id !== s.owner && dist(s.x, s.z, t.x, t.z) < GAME.TANK_RADIUS + 0.25) { hit = true; break; }
      if (hit || s.trav > GAME.SHELL_RANGE + 2) {
        s.boomAt = [s.x, s.z];
        onImpact(s, s.x, s.z, hit);
      }
      // safety: remote shells whose hit event was lost
      if (s.trav > GAME.SHELL_RANGE + 6) this.remove(s);
    }
  }
  clear() { for (const s of [...this.list]) this.remove(s); }
}
