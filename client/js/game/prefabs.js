/* Low-poly prefabs: turns shared map objects (pure data) into geometry
   added to batches. Visual-only randomness uses a per-object seed, so it
   never affects gameplay. */
import * as THREE from '../three.js';
import { G, CYL, M4 } from './batch.js';
import { rng, TAU } from '../../shared/math.js';

const WHITE = new THREE.Color(0xffffff);

/* ---------------- tanks ---------------- */
export function addHull(B, col, pre, dark) {
  const c = new THREE.Color(col), dk = c.clone().multiplyScalar(0.7), lt = c.clone().lerp(WHITE, 0.16);
  const TR = dark ? 0x1c1a19 : 0x2d2e30, WH = dark ? 0x272321 : 0x484c50, MET = dark ? 0x2a2624 : 0x5b6064;
  for (const s of [-1, 1]) {
    B.add(G.box, TR, [s * 1.06, 0.38, 0], [0, 0, 0], [0.64, 0.7, 3.6], 0.04, pre);
    B.add(G.box, TR, [s * 1.06, 0.36, 1.86], [0.75, 0, 0], [0.62, 0.42, 0.5], 0.04, pre);
    B.add(G.box, TR, [s * 1.06, 0.36, -1.86], [-0.75, 0, 0], [0.62, 0.42, 0.5], 0.04, pre);
    for (let i = 0; i < 5; i++) B.add(CYL(0.5, 0.5, 8), WH, [s * 1.39, 0.36, -1.36 + i * 0.68], [0, 0, Math.PI / 2], [0.54, 0.08, 0.54], 0.04, pre);
    B.add(G.box, dk, [s * 1.08, 0.8, 0], [0, 0, 0], [0.8, 0.1, 3.92], 0.04, pre);
    B.add(G.box, c, [s * 1.42, 0.6, 0.05], [0, 0, 0], [0.07, 0.3, 3.2], 0.04, pre);
  }
  B.add(G.box, c, [0, 0.62, 0], [0, 0, 0], [1.5, 0.6, 3.4], 0.03, pre);
  B.add(G.box, c, [0, 1.0, -0.15], [0, 0, 0], [2.1, 0.34, 2.9], 0.03, pre);
  B.add(G.box, lt, [0, 0.9, 1.5], [-0.5, 0, 0], [2.1, 0.14, 0.95], 0.03, pre);
  B.add(G.box, dk, [0, 1.19, -1.15], [0, 0, 0], [1.5, 0.05, 0.75], 0.03, pre);
  for (let i = 0; i < 3; i++) B.add(G.box, MET, [0, 1.23, -0.95 - i * 0.2], [0, 0, 0], [1.3, 0.03, 0.07], 0, pre);
  for (const s of [-1, 1]) {
    B.add(CYL(0.5, 0.5, 6), MET, [s * 0.6, 0.95, -1.72], [Math.PI / 2, 0, 0], [0.2, 0.25, 0.2], 0.03, pre);
    B.add(G.box, 0xffe9b0, [s * 0.78, 1.05, 1.58], [0, 0, 0], [0.2, 0.14, 0.08], 0, pre);
  }
  B.add(G.box, dk, [0.72, 1.3, -0.55], [0, 0, 0], [0.4, 0.28, 0.55], 0.05, pre);
}
export function addTurret(B, col, accent, pre, dark) {
  const c = new THREE.Color(col), dk = c.clone().multiplyScalar(0.7), lt = c.clone().lerp(WHITE, 0.16);
  const MET = dark ? 0x2a2624 : 0x5b6064;
  B.add(CYL(0.86, 1, 7), c, [0, 0.3, -0.1], [0, Math.PI / 7, 0], [1, 0.6, 1.12], 0.03, pre);
  B.add(CYL(0.72, 0.86, 7), lt, [0, 0.66, -0.12], [0, Math.PI / 7, 0], [1, 0.14, 1.1], 0.03, pre);
  B.add(G.box, dk, [0, 0.33, 0.98], [0, 0, 0], [0.62, 0.44, 0.4], 0.03, pre);
  B.add(CYL(0.5, 0.5, 8), MET, [0, 0.34, 1.3], [Math.PI / 2, 0, 0], [0.34, 0.6, 0.34], 0.02, pre);
  B.add(CYL(0.5, 0.5, 8), MET, [0, 0.34, 2.15], [Math.PI / 2, 0, 0], [0.24, 2.3, 0.24], 0.02, pre);
  B.add(G.box, MET, [0, 0.34, 3.28], [0, 0, 0], [0.34, 0.26, 0.36], 0.02, pre);
  B.add(CYL(0.5, 0.5, 8), dk, [-0.3, 0.76, -0.3], [0, 0, 0], [0.52, 0.1, 0.52], 0.03, pre);
  B.add(G.box, MET, [-0.3, 0.9, -0.05], [0, 0, 0], [0.08, 0.08, 0.5], 0.02, pre);
  B.add(G.box, dk, [0, 0.36, -1.2], [0, 0, 0], [1.3, 0.4, 0.42], 0.04, pre);
  for (const s of [-1, 1]) B.add(CYL(0.5, 0.5, 6), MET, [s * 0.78, 0.46, 0.55], [0.6, 0, 0], [0.12, 0.3, 0.12], 0.02, pre);
  if (!dark) {
    B.add(CYL(0.5, 0.5, 4), 0x202224, [0.5, 1.35, -0.75], [0, 0, 0], [0.04, 1.4, 0.04], 0, pre);
    B.add(G.box, accent, [0.64, 1.92, -0.75], [0, 0, 0], [0.28, 0.17, 0.02], 0, pre);
  }
}

/* ---------------- map objects ---------------- */
function rockAt(B, M, o, cols) {
  const y = M.height(o.x, o.z);
  B.add(G.rocks[o.v % 6], cols[o.c % cols.length], [o.x, y + o.s * 0.25, o.z], [0.2, o.ry, 0.1], [o.s * o.sx, o.s * o.sy, o.s * o.sz], 0.08);
  if (o.moss) B.add(G.blobs[0], 0x6f8f55, [o.x, y + o.s * 0.62, o.z], [0, o.ry, 0], [o.s * 0.7, o.s * 0.18, o.s * 0.7], 0.08);
}
const DESERT_ROCK = [0xc08a5c, 0xb07d55, 0xcf9a6a, 0xa9744c];
const GREY_ROCK = [0x8f928d, 0xa0a39c, 0x7f837e];

export function addObject(CB, CBflat, o, M) {
  const B = CB.at(o.x, o.z), Bs = CBflat.at(o.x, o.z);
  const R = rng(o.seed || (Math.floor(o.x * 131) ^ Math.floor(o.z * 977)) + 7);
  const h = (x, z) => M.height(x, z);
  switch (o.k) {
    case 'rock': rockAt(B, M, o, o.grey ? GREY_ROCK : DESERT_ROCK); break;
    case 'mesa': {
      const cols = [0xd98b55, 0xc9763f, 0xe6a56c, 0xd08048, 0xbf6d3c]; let y = h(o.x, o.z) - 1.2; let r = o.R;
      const layers = Math.round(o.H / 2.1);
      for (let i = 0; i < layers; i++) {
        const hh = 1.8 + R() * 0.9; const rn = r * (0.84 + R() * 0.1);
        B.add(CYL(0.88, 1, 7), cols[i % cols.length], [o.x, y + hh / 2, o.z], [0, R() * TAU, 0], [r, hh, r * (0.85 + R() * 0.3)], 0.05);
        y += hh; r = rn;
      }
      B.add(CYL(0.95, 1, 7), 0xe9ad72, [o.x, y + 0.2, o.z], [0, R() * TAU, 0], [r * 0.95, 0.4, r * 0.9], 0.05);
      for (let i = 0; i < 5; i++) {
        const a = R() * TAU, x = o.x + Math.cos(a) * (o.R + 1), z = o.z + Math.sin(a) * (o.R + 1), s = 1 + R() * 1.4;
        B.add(G.rocks[i % 6], i % 2 ? 0xc9804c : 0xb8703e, [x, h(x, z) + s * 0.25, z], [0.2, R() * TAU, 0.1], [s * 1.1, s * 0.7, s * 1.1], 0.08);
      }
      break;
    }
    case 'ruin': {
      const pre = M4(o.x, h(o.x, o.z), o.z, o.ry); const wall = 0xe2c69c, wall2 = 0xd2b184, wood = 0x8b5e3a, t = 0.5, { w, d, H } = o;
      B.add(G.box, 0xcdb38a, [0, 0.07, 0], [0, 0, 0], [w, 0.15, d], 0.03, pre);
      const sides = [{ len: w, z: -d / 2, rot: 0 }, { len: w, z: d / 2, rot: 0, door: true }, { len: d, x: -w / 2, rot: 1 }, { len: d, x: w / 2, rot: 1, win: true }];
      for (const s of sides) {
        const n = Math.max(3, Math.round(s.len / 1.15)); const seg = s.len / n;
        for (let i = 0; i < n; i++) {
          if (s.door && i === Math.floor(n / 2)) continue;
          const u = -s.len / 2 + seg * (i + 0.5);
          let hh = H * (0.45 + R() * 0.55); if (i === 0 || i === n - 1) hh = H * (0.85 + R() * 0.15); if (R() < 0.12) hh = H * 0.18;
          const px = s.rot ? s.x : u, pz = s.rot ? u : s.z, sz = s.rot ? [t, 0, seg + 0.02] : [seg + 0.02, 0, t];
          if (s.win && i % 2 === 1 && hh > 2.4) {
            B.add(G.box, wall, [px, 0.5, pz], [0, 0, 0], [sz[0], 1, sz[2]], 0.04, pre);
            B.add(G.box, wall, [px, (2 + hh) / 2, pz], [0, 0, 0], [sz[0], hh - 2, sz[2]], 0.04, pre);
          } else B.add(G.box, i % 3 ? wall : wall2, [px, hh / 2, pz], [0, 0, 0], [sz[0], hh, sz[2]], 0.04, pre);
        }
      }
      B.add(G.box, wood, [0, H - 0.3, -0.6], [0, 0.08, 0.12], [w + 0.6, 0.22, 0.26], 0.05, pre);
      B.add(G.box, wood, [0.4, H - 0.6, 0.8], [0, -0.1, -0.25], [w * 0.8, 0.22, 0.26], 0.05, pre);
      for (let i = 0; i < 9; i++) { const a = R() * TAU, rr = R() * Math.min(w, d) * 0.45; B.add(G.box, R() < 0.5 ? wall2 : 0xbfa071, [Math.cos(a) * rr, 0.2, Math.sin(a) * rr], [R(), R() * 3, R()], [0.4 + R() * 0.6, 0.3 + R() * 0.3, 0.4 + R() * 0.5], 0.05, pre); }
      for (let i = 0; i < 5; i++) { const a = R() * TAU; B.add(G.box, wall2, [Math.cos(a) * (w / 2 + 0.9), 0.18, Math.sin(a) * (d / 2 + 0.9)], [R(), R() * 3, R()], [0.5, 0.35, 0.5], 0.05, pre); }
      break;
    }
    case 'jersey': B.add(G.jersey, o.alt ? 0xd8cfbf : 0xc5bdae, [o.x, h(o.x, o.z), o.z], [0, o.ry, 0], [1, 1, 2.4], 0.04); break;
    case 'hedgehog': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) B.add(G.box, 0x5a534c, [o.x, y + 0.7, o.z], [k === 0 ? 0.9 : 0, k * 1.05, k === 2 ? 0.9 : 0], [0.18, 1.9, 0.18], 0.03); break; }
    case 'bags': {
      const y = h(o.x, o.z);
      for (let l = 0; l < 3; l++) { const n = Math.round((o.a1 - o.a0) * o.R / 1.05);
        for (let i = 0; i <= n; i++) { const a = o.a0 + (o.a1 - o.a0) * (i + (l % 2) * 0.5) / n; if (a > o.a1) continue;
          B.add(G.sph, l % 2 ? 0xb99c69 : 0xc4a674, [o.x + Math.cos(a) * o.R, y + 0.22 + l * 0.36, o.z + Math.sin(a) * o.R], [0, -a, 0], [0.3, 0.2, 0.55], 0.06); } }
      break;
    }
    case 'nest': {
      const y = h(o.x, o.z);
      for (let l = 0; l < 3; l++) for (let i = 0; i < 7; i++) { const a = Math.PI * 0.9 + i * 0.22 + (l % 2) * 0.11; B.add(G.sph, l % 2 ? 0xb09a6c : 0xbba577, [o.x + Math.cos(a) * 2.4, y + 0.22 + l * 0.36, o.z + Math.sin(a) * 2.4], [0, -a, 0], [0.3, 0.2, 0.55], 0.06); }
      break;
    }
    case 'tent': B.add(G.prism, 0x8b8a5c, [o.x, h(o.x, o.z), o.z], [0, o.ry, 0], [3.2, 2.2, 4.2], 0.04); break;
    case 'wreck': {
      const pre = M4(o.x, h(o.x, o.z) - 0.15, o.z, 0.9); pre.multiply(new THREE.Matrix4().makeRotationZ(0.08)); addHull(B, 0x3b3431, pre, true);
      const pt = M4(o.x + 2.4, h(o.x, o.z) + 0.2, o.z + 1.6, 2.2).multiply(new THREE.Matrix4().makeRotationX(0.35)); addTurret(B, 0x3b3431, 0, pt, true);
      break;
    }
    case 'barrel': { const y = h(o.x, o.z); const c = [0xa84f32, 0x6b7042, 0x8a3a2a][o.c];
      if (o.tip) B.add(CYL(0.5, 0.5, 8), c, [o.x, y + 0.4, o.z], [0, R() * TAU, Math.PI / 2], [0.8, 1.1, 0.8], 0.04);
      else B.add(CYL(0.5, 0.5, 8), c, [o.x, y + 0.55, o.z], [0, 0, 0], [0.8, 1.1, 0.8], 0.04); break; }
    case 'crate': B.add(G.box, 0xa87646, [o.x, h(o.x, o.z) + o.y0 + o.s / 2, o.z], [0, o.ry, 0], [o.s, o.s, o.s], 0.06); break;
    case 'pole': { const y = h(o.x, o.z); B.add(CYL(0.5, 0.6, 5), 0x6e5238, [o.x, y + 3, o.z], [0, 0, 0.03], [0.26, 6, 0.26], 0.04); B.add(G.box, 0x5f4630, [o.x, y + 5.6, o.z], [0, o.ry, 0], [1.8, 0.14, 0.14], 0.04); break; }
    case 'crater': { const y = h(o.x, o.z);
      Bs.add(CYL(1, 1.18, 10), 0xd5a66e, [o.x, y + 0.02, o.z], [0, R(), 0], [o.R, 0.3, o.R], 0.05);
      Bs.add(CYL(1, 1, 10), 0x9b7550, [o.x, y + 0.1, o.z], [0, R(), 0], [o.R * 0.7, 0.16, o.R * 0.7], 0.05);
      Bs.add(CYL(1, 1, 8), 0x7d5f44, [o.x, y + 0.12, o.z], [0, R(), 0], [o.R * 0.38, 0.16, o.R * 0.38], 0.05); break; }
    case 'dryTree': {
      const y = h(o.x, o.z); const s = 0.8 + R() * 0.6;
      B.add(CYL(0.7, 1, 5), 0x7a6451, [o.x, y + 1.5 * s, o.z], [0, 0, (R() - 0.5) * 0.2], [0.3 * s, 3 * s, 0.3 * s], 0.05);
      for (let k = 0; k < 3; k++) {
        const rx = (R() - 0.5) * 1.6, rz = (R() < 0.5 ? -1 : 1) * (0.6 + R() * 0.5), ry = R() * TAU;
        const ax = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rx, ry, rz)); const L = (1.2 + R() * 0.8) * s;
        B.add(CYL(0.6, 1, 4), 0x6b5645, [o.x + ax.x * L / 2, y + (2.2 + k * 0.35) * s + ax.y * L / 2, o.z + ax.z * L / 2], [rx, ry, rz], [0.14 * s, L, 0.14 * s], 0.05);
      }
      break;
    }
    case 'dbush': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) B.add(G.blobs[k], [0x9a9a55, 0x8f8f4f, 0xa99f5a][k], [o.x + (R() - 0.5) * 1.1, y + 0.3, o.z + (R() - 0.5) * 1.1], [0, R() * TAU, 0], [0.35 + R() * 0.3, 0.3 + R() * 0.2, 0.35 + R() * 0.3], 0.08); break; }
    case 'tuft': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) Bs.add(CYL(0, 0.5, 4), R() < 0.5 ? 0xcbb06a : 0xb9a45e, [o.x + (R() - 0.5) * 0.5, y + 0.28, o.z + (R() - 0.5) * 0.5], [(R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5], [0.14, 0.6, 0.14], 0.06); break; }
    case 'bridge': {
      const zc = o.z, y = 0.35;
      for (let x = o.x0; x <= o.x1; x += 0.55) B.add(G.box, R() < 0.5 ? 0x9a6a3e : 0x8a5c34, [x, y, zc], [0, 0, (R() - 0.5) * 0.03], [0.5, 0.18, 5.2], 0.05);
      for (const s of [-1, 1]) {
        for (let x = o.x0; x <= o.x1 + 0.01; x += 2.5) B.add(G.box, 0x6e4a2c, [x, y + 0.7, zc + s * 2.55], [0, 0, 0], [0.22, 1.2, 0.22], 0.04);
        B.add(G.box, 0x7b5534, [(o.x0 + o.x1) / 2, y + 1.15, zc + s * 2.55], [0, 0, 0], [o.x1 - o.x0, 0.16, 0.16], 0.04);
        for (const px of [22.5, 29.5]) B.add(G.box, 0x5b3d25, [px, -1, zc + s * 2.2], [0, 0, 0], [0.4, 2.6, 0.4], 0.04);
      }
      for (const x of [o.x0 - 1, o.x1 + 1]) B.add(G.box, 0x8f918c, [x, 0.1, zc], [0, 0, 0], [1.6, 0.9, 6], 0.06);
      break;
    }
    case 'cabin': {
      const pre = M4(o.x, h(o.x, o.z), o.z, o.ry); const { w, d } = o;
      B.add(G.box, 0x7b5535, [0, 0.2, 0], [0, 0, 0], [w + 1.4, 0.4, d + 1.4], 0.04, pre);
      B.add(G.box, 0x9a6a3e, [0, 1.6, 0], [0, 0, 0], [w, 2.6, d], 0.03, pre);
      for (let k = 0; k < 4; k++) B.add(G.box, 0x7d5231, [0, 0.7 + k * 0.62, 0], [0, 0, 0], [w + 0.08, 0.1, d + 0.08], 0.02, pre);
      B.add(G.box, 0x4a3322, [0, 1.3, d / 2 + 0.03], [0, 0, 0], [1, 2, 0.1], 0.02, pre);
      for (const s of [-1, 1]) B.add(G.box, 0xf2d88a, [s * 2.2, 1.8, d / 2 + 0.04], [0, 0, 0], [1, 0.8, 0.08], 0.02, pre);
      B.add(G.prism, 0xb8573a, [0, 2.9, 0], [0, Math.PI / 2, 0], [d + 1.2, 2.1, w + 1.2], 0.04, pre);
      B.add(G.box, 0x8d8a85, [w / 2 - 1.2, 3.9, -1], [0, 0, 0], [0.8, 2.2, 0.8], 0.06, pre);
      for (let k = 0; k < 7; k++) B.add(CYL(0.5, 0.5, 6), k % 2 ? 0x7a5234 : 0x8a6040, [-w / 2 - 1.1, 0.35 + Math.floor(k / 3) * 0.5, -1 + (k % 3) * 0.55], [Math.PI / 2, 0, 0], [0.45, 1.6, 0.45], 0.04, pre);
      break;
    }
    case 'tower': {
      const y = h(o.x, o.z);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(CYL(0.5, 0.6, 5), 0x6e4a2c, [o.x + sx * 1.3, y + 3, o.z + sz * 1.3], [sz * 0.05, 0, -sx * 0.05], [0.3, 6.2, 0.3], 0.04);
      B.add(G.box, 0x8a5c34, [o.x, y + 6.1, o.z], [0, 0, 0], [3.6, 0.25, 3.6], 0.04);
      for (const s of [-1, 1]) { B.add(G.box, 0x7b5534, [o.x, y + 6.7, o.z + s * 1.7], [0, 0, 0], [3.6, 0.9, 0.14], 0.04); B.add(G.box, 0x7b5534, [o.x + s * 1.7, y + 6.7, o.z], [0, 0, 0], [0.14, 0.9, 3.6], 0.04); }
      B.add(CYL(0, 1, 4), 0xa54c34, [o.x, y + 8.3, o.z], [0, Math.PI / 4, 0], [3.2, 1.6, 3.2], 0.04);
      break;
    }
    case 'swall': {
      const pre = M4(o.x, h(o.x, o.z), o.z, o.ry);
      for (let i = 0; i < 5; i++) { const hh = 0.8 + R() * 1.2; B.add(G.box, R() < 0.5 ? 0x9a9d97 : 0x8a8d86, [-2 + i, hh / 2, 0], [0, 0, 0], [1.02, hh, 0.8], 0.07, pre); }
      B.add(G.box, 0x6f8f55, [-1, 0.1, 0.9], [0, 0, 0], [2, 0.2, 0.6], 0.1, pre);
      break;
    }
    case 'fence': {
      let prev = null;
      for (const [x, z] of o.posts) { const y = h(x, z); const b = CB.at(x, z);
        b.add(G.box, 0x7a5334, [x, y + 0.6, z], [0, 0, 0], [0.2, 1.2, 0.2], 0.04);
        if (prev) { const mx = (x + prev[0]) / 2, mz = (z + prev[1]) / 2, ll = Math.hypot(x - prev[0], z - prev[1]), ang = Math.atan2(x - prev[0], z - prev[1]);
          for (const hy of [0.45, 0.95]) b.add(G.box, 0x8a6040, [mx, (y + prev[2]) / 2 + hy, mz], [0, ang, 0], [0.1, 0.12, ll], 0.04); }
        prev = [x, z, y]; }
      break;
    }
    case 'log': B.add(CYL(0.5, 0.5, 7), 0x7a5234, [o.x, h(o.x, o.z) + 0.36, o.z], [0, o.ry, Math.PI / 2], [0.72, o.L, 0.72], 0.05); break;
    case 'stump': { const y = h(o.x, o.z); B.add(CYL(0.9, 1, 7), 0x7a5536, [o.x, y + 0.3, o.z], [0, o.ry, 0], [0.9, 0.6, 0.9], 0.05); B.add(CYL(1, 1, 7), 0xc49a6a, [o.x, y + 0.61, o.z], [0, 0, 0], [0.75, 0.04, 0.75], 0.03); break; }
    case 'pine': {
      const y = h(o.x, o.z), s = o.s; const c = [0x2f6d3c, 0x357a41, 0x2b6236, 0x3f8446][o.c];
      B.add(CYL(0.8, 1, 5), 0x6b4a2f, [o.x, y + 0.9 * s, o.z], [0, o.ry, 0], [0.36 * s, 1.8 * s, 0.36 * s], 0.05);
      B.add(CYL(0, 0.5, 7), c, [o.x, y + 2.9 * s, o.z], [0, o.ry, 0], [3.5 * s, 3.2 * s, 3.5 * s], 0.06);
      B.add(CYL(0, 0.5, 7), c, [o.x, y + 4.5 * s, o.z], [0, o.ry + 0.3, 0], [2.7 * s, 2.8 * s, 2.7 * s], 0.06);
      B.add(CYL(0, 0.5, 7), c, [o.x, y + 5.9 * s, o.z], [0, o.ry + 0.6, 0], [1.7 * s, 2.4 * s, 1.7 * s], 0.06);
      break;
    }
    case 'leafy': {
      const y = h(o.x, o.z), s = o.s;
      const c = o.autumn ? [0xd8923a, 0xc9702e, 0xe0b041][o.autumn - 1] : [0x6aa84f, 0x7db552, 0x5e9a45, 0x88bb4f][o.c];
      B.add(CYL(0.75, 1, 5), 0x6b4a2f, [o.x, y + 1.2 * s, o.z], [0, 0, 0], [0.4 * s, 2.4 * s, 0.4 * s], 0.05);
      B.add(G.blobs[Math.floor(R() * 3)], c, [o.x, y + 3.3 * s, o.z], [0, R() * TAU, 0], [2.2 * s, 1.9 * s, 2.2 * s], 0.07);
      B.add(G.blobs[Math.floor(R() * 3)], c, [o.x + 0.9 * s, y + 4 * s, o.z + 0.3 * s], [0, R() * TAU, 0], [1.4 * s, 1.3 * s, 1.4 * s], 0.07);
      break;
    }
    case 'fbush': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) B.add(G.blobs[k], [0x4f8f3e, 0x5c9d45, 0x467f37][k], [o.x + (R() - 0.5) * 1.4, y + 0.45, o.z + (R() - 0.5) * 1.4], [0, R() * TAU, 0], [0.55 + R() * 0.35, 0.45 + R() * 0.25, 0.55 + R() * 0.35], 0.08); break; }
    case 'reeds': { for (let j = 0; j < 4; j++) Bs.add(CYL(0, 0.5, 4), R() < 0.5 ? 0x9fb35a : 0x7d9a48, [o.x + (R() - 0.5) * 0.6, h(o.x, o.z) + 0.5, o.z + (R() - 0.5) * 0.6], [(R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3], [0.12, 1.1 + R() * 0.5, 0.12], 0.06); break; }
    case 'flower': Bs.add(G.box, [0xf5f0e0, 0xf2d24a, 0xe98fb3][o.c], [o.x, h(o.x, o.z) + 0.22, o.z], [0, o.ry, 0], [0.18, 0.18, 0.18], 0.04); break;
    case 'grass': { const y = h(o.x, o.z); for (let k = 0; k < 3; k++) Bs.add(CYL(0, 0.5, 4), R() < 0.5 ? 0x7cc05a : 0x8ccf62, [o.x + (R() - 0.5) * 0.5, y + 0.25, o.z + (R() - 0.5) * 0.5], [(R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5], [0.13, 0.55, 0.13], 0.06); break; }
  }
}
