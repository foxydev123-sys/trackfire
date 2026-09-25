/* Builds the 3D scene for a shared map: terrain, water, lights, fog,
   batched scenery and a minimap image. */
import * as THREE from '../three.js';
import { ChunkBatch } from './batch.js';
import { addObject } from './prefabs.js';
import { rng, fbm, polyDist } from '../../shared/math.js';

const groundColor = {
  desert(M) {
    return (x, y, z) => {
      const dr = polyDist(x, z, M.road);
      if (dr < 3.4) return Math.abs(dr - 1.25) < 0.36 ? 0xb98853 : 0xcf9e66;
      const n = fbm(x * 0.07, z * 0.07);
      if (y > 2.2) return n > 0.5 ? 0xf2c98f : 0xeabd80;
      return n < 0.38 ? 0xdfad6e : n < 0.6 ? 0xe8b978 : 0xeec48a;
    };
  },
  forest(M) {
    return (x, y, z) => {
      const dv = polyDist(x, z, M.river); if (dv < M.riverW - 0.6) return 0x5d6f55; if (dv < M.riverW + 1.4) return 0xcbb98a;
      const dr = polyDist(x, z, M.road); if (dr < 2.9) return Math.abs(dr - 1.2) < 0.32 ? 0x8e6840 : 0xa77d4c;
      const n = fbm(x * 0.08, z * 0.08); if (y > 3) return n > 0.5 ? 0x8cbc5c : 0x7fb255;
      return n < 0.36 ? 0x5a9a42 : n < 0.58 ? 0x68a84b : 0x79b655;
    };
  },
};

export const SUNS = {
  morning: { dir: [-1, 0.62, -0.35], col: 0xffe2c4, int: 0.85, hemi: 0.5, tint: 0xd8e6f2, tk: 0.18 },
  midday: { dir: [-0.45, 1, 0.55], col: 0xfff0d6, int: 0.88, hemi: 0.52, tint: 0xffffff, tk: 0 },
  golden: { dir: [1, 0.48, 0.55], col: 0xffb877, int: 0.95, hemi: 0.44, tint: 0xf3b27a, tk: 0.3 },
};

export function buildWorld(M, opts = {}) {
  const W = { map: M, scene: new THREE.Scene() };
  const seg = opts.lowDetail ? 70 : 110;
  // --- terrain (flat-shaded, per-face colours)
  const g = new THREE.PlaneGeometry(200, 200, seg, seg); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, M.height(p.getX(i), p.getZ(i)));
  const ng = g.toNonIndexed(); g.dispose();
  const pos = ng.attributes.position; const col = new Float32Array(pos.count * 3); const r = rng(M.seed); const cf = groundColor[M.kind](M); const c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3, cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3, cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
    c.set(cf(cx, cy, cz)).multiplyScalar(1 + (r() - 0.5) * 0.07);
    for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; }
  }
  ng.deleteAttribute('uv'); ng.setAttribute('color', new THREE.BufferAttribute(col, 3)); ng.computeVertexNormals();
  W.ground = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));
  W.ground.receiveShadow = true; W.scene.add(W.ground);
  if (M.river) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4ba3c6, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.86 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.55; water.receiveShadow = true; W.scene.add(water); W.water = water;
  }
  // --- scenery: casting + flat (decals, grass) batches, both tiled
  const CB = new ChunkBatch(M.seed + 7), CBf = new ChunkBatch(M.seed + 8);
  for (const o of M.objects) {
    if (opts.lowDetail && (o.k === 'grass' || o.k === 'tuft' || o.k === 'flower')) continue;
    addObject(CB, CBf, o, M);
  }
  W.scene.add(CB.build(true), CBf.build(false));
  // --- lights + fog
  const env = M.env;
  W.hemi = new THREE.HemisphereLight(env.sky, env.ground, 0.52); W.scene.add(W.hemi);
  W.sun = new THREE.DirectionalLight(0xfff0d6, 0.88); W.sun.castShadow = true;
  const sc = W.sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 170;
  W.sun.shadow.bias = -0.0006; W.sun.shadow.normalBias = 0.03;
  W.scene.add(W.sun, W.sun.target);
  W.fogBase = new THREE.Color(env.fog);
  W.scene.fog = new THREE.Fog(env.fog, 85, 190); W.scene.background = new THREE.Color(env.fog);
  W.setSun = (key) => {
    const s = SUNS[key] || SUNS.midday;
    W.sunDir = new THREE.Vector3(...s.dir).normalize(); W.sun.color.setHex(s.col); W.sun.intensity = s.int; W.hemi.intensity = s.hemi;
    const f = W.fogBase.clone().lerp(new THREE.Color(s.tint), s.tk); W.scene.fog.color.copy(f); W.scene.background.copy(f);
  };
  W.setSun(opts.sun || 'midday');
  W.follow = (target) => { W.sun.position.copy(target).addScaledVector(W.sunDir, 80); W.sun.target.position.copy(target); };
  W.minimap = minimapImage(M);
  return W;
}

function minimapImage(M) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 300;
  const x = cv.getContext('2d'); const S = 2, O = 75; const tx = (v) => (v + O) * S;
  x.fillStyle = M.kind === 'desert' ? '#dcae72' : '#5f9b45'; x.fillRect(0, 0, 300, 300);
  const line = (pts, wd, c) => { x.strokeStyle = c; x.lineWidth = wd * S; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(tx(p[0]), tx(p[1])) : x.moveTo(tx(p[0]), tx(p[1]))); x.stroke(); };
  if (M.river) line(M.river, M.riverW * 2, '#4ba3c6');
  if (M.road) line(M.road, 4, M.kind === 'desert' ? '#bd8d5a' : '#a57b4b');
  for (const o of M.objects) {
    let c = null, r = 0;
    if (o.k === 'pine' || o.k === 'leafy') { c = '#2f6436'; r = 1.6 * o.s; }
    else if (o.k === 'mesa') { c = '#b8683a'; r = o.R; }
    else if (o.k === 'rock' && o.big) { c = o.grey ? '#8f928d' : '#b37b50'; r = o.s; }
    if (c) { x.fillStyle = c; x.beginPath(); x.arc(tx(o.x), tx(o.z), r * S * 0.8, 0, Math.PI * 2); x.fill(); }
    const rect = o.k === 'ruin' ? [o.w, o.d, '#f3dfbd'] : o.k === 'cabin' ? [o.w, o.d, '#c9683f'] : o.k === 'tower' ? [3.6, 3.6, '#c9683f'] : o.k === 'swall' ? [5, 0.8, '#9a9d97'] : o.k === 'log' ? [o.L, 0.7, '#7a5234'] : o.k === 'bridge' ? [15, 5.2, '#b0875a'] : null;
    if (rect) { x.save(); x.translate(tx(o.x), tx(o.z)); x.rotate(-(o.ry || 0)); x.fillStyle = rect[2]; x.fillRect(-rect[0] * S / 2, -rect[1] * S / 2, rect[0] * S, rect[1] * S); x.restore(); }
  }
  return cv;
}
