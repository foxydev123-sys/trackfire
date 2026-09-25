/* One tank's 3D model (2 draw calls: hull + turret) + small visual state. */
import * as THREE from '../three.js';
import { Batch } from './batch.js';
import { addHull, addTurret } from './prefabs.js';
import { lerp, lerpAngle } from '../../shared/math.js';

export const TEAM_COLORS = { blue: 0x4a78b8, red: 0xc24b3c };
export const TEAM_ACCENT = { blue: 0x9cc4ff, red: 0xffc26b };
export const FFA_COLORS = [0x4a78b8, 0xc24b3c, 0x5d8f45, 0xd09a2f, 0x8a5bb8, 0x2f9c9a, 0xb85b86, 0x6b6f76];
const TMAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.08 });
const modelCache = new Map();

function models(color, accent) {
  const k = color + '_' + accent;
  if (!modelCache.has(k)) {
    const hb = new Batch(3); addHull(hb, color, null); const tb = new Batch(4); addTurret(tb, color, accent, null);
    modelCache.set(k, { hull: hb.build(TMAT).geometry, tur: tb.build(TMAT).geometry });
  }
  return modelCache.get(k);
}

export class TankView {
  constructor(scene, color, accent, isMe) {
    const g = models(color, accent);
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);       // tilts with terrain
    this.hull = new THREE.Mesh(g.hull, TMAT); this.hull.castShadow = true; this.hull.receiveShadow = true; this.body.add(this.hull);
    this.pivot = new THREE.Group(); this.pivot.position.y = 1.16; this.body.add(this.pivot);
    this.tur = new THREE.Mesh(g.tur, TMAT); this.tur.castShadow = true; this.tur.receiveShadow = true; this.pivot.add(this.tur);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.34, 3.5); this.tur.add(this.muzzle);
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(2.9, 1), new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.22, wireframe: true, depthWrite: false }));
    this.shield.position.y = 1.1; this.shield.visible = false; this.root.add(this.shield);
    if (isMe) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffc466, transparent: true, opacity: 0.75, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.85, 40), mat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; this.root.add(ring);
      const chev = new THREE.Mesh(new THREE.CircleGeometry(0.5, 3), mat); chev.rotation.set(-Math.PI / 2, 0, Math.PI / 2); chev.position.set(0, 0.1, 3.3); this.root.add(chev);
    }
    scene.add(this.root);
    this.scene = scene; this.recoil = 0; this.pitch = 0; this.roll = 0; this.dustT = 0; this.t = 0; this.visible = true;
  }
  setPose(x, z, yaw, turret, H, dt, speed) {
    this.t += dt;
    // Tilt to follow the terrain (sample ground under front/back/left/right).
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const hf = H(x + s * 1.7, z + c * 1.7), hb = H(x - s * 1.7, z - c * 1.7), hl = H(x + c * 1.1, z - s * 1.1), hr = H(x - c * 1.1, z + s * 1.1);
    const k = 1 - Math.exp(-10 * dt);
    this.pitch = lerp(this.pitch, Math.atan2(hb - hf, 3.4), k); this.roll = lerp(this.roll, Math.atan2(hl - hr, 2.2), k);
    this.root.position.set(x, (hf + hb + hl + hr) / 4, z);
    this.root.rotation.y = yaw;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.pivot.rotation.y = turret - yaw;
    this.hull.position.y = Math.sin(this.t * 15) * 0.02 * Math.min(1, Math.abs(speed) / 4);
    this.recoil = Math.max(0, this.recoil - dt * 3.2); this.tur.position.z = -this.recoil * 0.35;
  }
  setShield(on, t) { this.shield.visible = on && (Math.floor(t * 10) % 3 !== 0); }
  setVisible(v) { this.visible = v; this.root.visible = v; }
  muzzleWorld(v) { this.root.updateMatrixWorld(true); return this.muzzle.getWorldPosition(v); }
  dispose() { this.scene.remove(this.root); this.shield.geometry.dispose(); }
}
