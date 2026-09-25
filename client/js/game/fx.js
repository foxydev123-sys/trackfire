/* Pooled low-poly particles: explosions, muzzle flashes, dust, smoke.
   Everything is pre-allocated (object pooling) so combat never triggers
   garbage-collection hitches. `budget` scales particle counts by quality. */
import * as THREE from '../three.js';
import { G } from './batch.js';
import { lerp, smooth, TAU } from '../../shared/math.js';

const R = Math.random;
export class FX {
  constructor(scene, dustCol, poolSize = 320) {
    this.pool = []; this.act = []; this.rings = []; this.budget = 1; this.ri = 0;
    const B = (c) => new THREE.MeshBasicMaterial({ color: c, fog: false });
    const S = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 1 });
    this.mats = { f1: B(0xfff1a8), f2: B(0xffa53a), f3: B(0xff5a2a), smoke: S(0x5f5854), smokeL: S(0x958c84), dust: S(dustCol), debris: S(0x3a3430), spark: B(0xffe28a), blue: B(0x8fe8ff) };
    for (let i = 0; i < poolSize; i++) { const m = new THREE.Mesh(G.ico, this.mats.smoke); m.visible = false; m.frustumCulled = false; scene.add(m); this.pool.push(m); }
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 24), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); this.rings.push({ m, t: 1, life: 1, R: 1 });
    }
    this._v = new THREE.Vector3(); this._o = new THREE.Vector3();
  }
  spawn(type, pos, vel, life, s0, s1, grav = 0, drag = 1) {
    const m = this.pool.pop(); if (!m) return;
    m.material = this.mats[type]; m.visible = true; m.position.copy(pos);
    m.rotation.set(R() * TAU, R() * TAU, 0); m.scale.setScalar(s0);
    this.act.push({ m, vel: vel.clone(), life, t: 0, s0, s1, grav, drag, spin: (R() - 0.5) * 6 });
  }
  ring(pos, Rr, col = 0xffd9a0) {
    const r = this.rings[this.ri++ % this.rings.length];
    r.m.position.set(pos.x, pos.y + 0.15, pos.z); r.m.material.color.setHex(col); r.t = 0; r.life = 0.45; r.R = Rr; r.m.visible = true;
  }
  explode(p, big) {
    const q = this.budget, v = this._v, o = this._o;
    const nF = Math.round((big ? 16 : 7) * q), nS = Math.round((big ? 12 : 5) * q), nD = Math.round((big ? 12 : 4) * q);
    for (let i = 0; i < nF; i++) { v.set(R() - 0.5, R() * 0.8 + 0.2, R() - 0.5).normalize(); o.copy(p).addScaledVector(v, 0.3);
      this.spawn(['f1', 'f2', 'f3'][i % 3], o, v.multiplyScalar((big ? 7 : 4.5) * (0.5 + R())), 0.35 + R() * 0.3, 0.35, big ? 1.7 : 1.0, 0, 0.02); }
    for (let i = 0; i < nS; i++) { o.set(p.x + (R() - 0.5) * 1.5, p.y + R(), p.z + (R() - 0.5) * 1.5);
      this.spawn(R() < 0.5 ? 'smoke' : 'smokeL', o, v.set((R() - 0.5) * 1.4, 1.4 + R() * 1.8, (R() - 0.5) * 1.4), 1.3 + R() * 0.9, 0.5, big ? 2.4 : 1.3, 0, 0.35); }
    for (let i = 0; i < nD; i++) { o.set(p.x, p.y + 0.4, p.z); this.spawn('debris', o, v.set((R() - 0.5) * 9, 5 + R() * 6, (R() - 0.5) * 9), 1.5, 0.22, 0.22, 18, 0.9); }
    this.ring(p, big ? 8 : 4);
  }
  deflect(p) { const v = this._v; for (let i = 0; i < 6; i++) { v.set(R() - 0.5, R() * 0.6, R() - 0.5).normalize().multiplyScalar(6); this.spawn('blue', p, v, 0.25, 0.25, 0.1, 0, 0.05); } this.ring(p, 2.5, 0x8fe8ff); }
  muzzle(p, dir) {
    const v = this._v, o = this._o;
    for (let i = 0; i < 4; i++) { o.copy(p).addScaledVector(dir, i * 0.25); this.spawn(i < 2 ? 'f1' : 'f2', o, v.copy(dir).multiplyScalar(6 + i * 2), 0.12, 0.45 - i * 0.06, 0.7, 0, 0.01); }
    for (let i = 0; i < Math.round(4 * this.budget); i++) { o.copy(p).addScaledVector(dir, 0.3); this.spawn('smokeL', o, v.set(dir.x * 2.5 + (R() - 0.5), 0.8 + R(), dir.z * 2.5 + (R() - 0.5)), 0.9, 0.3, 1.0, 0, 0.2); }
  }
  dust(p) { if (R() > this.budget) return; this.spawn('dust', p, this._v.set((R() - 0.5) * 0.6, 0.6 + R() * 0.6, (R() - 0.5) * 0.6), 0.8 + R() * 0.4, 0.2, 0.75, 0, 0.4); }
  smoke(p) { this.spawn(R() < 0.6 ? 'smoke' : 'smokeL', p, this._v.set((R() - 0.5) * 0.5, 2 + R(), (R() - 0.5) * 0.5), 1.8, 0.5, 1.8, 0, 0.6); }
  update(dt) {
    for (let i = this.act.length - 1; i >= 0; i--) {
      const a = this.act[i]; a.t += dt; const k = a.t / a.life;
      if (k >= 1) { a.m.visible = false; this.pool.push(a.m); this.act[i] = this.act[this.act.length - 1]; this.act.pop(); continue; }
      a.vel.y -= a.grav * dt; a.vel.multiplyScalar(Math.pow(a.drag, dt)); a.m.position.addScaledVector(a.vel, dt);
      if (a.grav && a.m.position.y < 0.15) { a.m.position.y = 0.15; a.vel.y *= -0.3; a.vel.x *= 0.6; a.vel.z *= 0.6; }
      const e = 1 - Math.pow(1 - k, 3); a.m.scale.setScalar(lerp(a.s0, a.s1, e) * (1 - smooth(0.62, 1, k)));
      a.m.rotation.x += a.spin * dt; a.m.rotation.y += a.spin * 0.7 * dt;
    }
    for (const r of this.rings) {
      if (!r.m.visible) continue; r.t += dt; const k = r.t / r.life;
      if (k >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(0.5 + r.R * (1 - Math.pow(1 - k, 2))); r.m.material.opacity = 0.7 * (1 - k);
    }
  }
}
