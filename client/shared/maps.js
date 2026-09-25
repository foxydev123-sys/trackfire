/* =====================================================================
   MAPS — deterministic layout shared by server and client.

   The server only needs `colliders`, `spawns`, `river`/`bridge` and
   `bound` (for movement + projectile collision). The client also uses
   `objects` + `height()` to build the 3D scene. Because both sides run
   this exact generator (integer PRNG, no Math.sin in decisions), the
   obstacles you see are exactly the obstacles the server collides with.
   ===================================================================== */
import { rng, fbm, smooth, polyDist, catmull, dist, TAU } from './math.js';

// Arithmetic-only sine/cosine (Taylor series) so lane points are bit-identical
// on every JS engine — lanes decide where cover may be placed.
function dsin(a) { a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; let t = a, s = a; const a2 = a * a;
  for (let n = 1; n < 12; n++) { t *= -a2 / ((2 * n) * (2 * n + 1)); s += t; } return s; }
const dcos = (a) => dsin(a + Math.PI / 2);
function ellipse(cx, cz, rx, rz, n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([cx + dcos(a) * rx, cz + dsin(a) * rz]); }
  return out;
}
function line(a, b, n = 16) {
  const out = [];
  for (let i = 0; i < n; i++) { const k = i / (n - 1); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  return out;
}

function base(id, name, kind, seed) {
  const M = { id, name, kind, seed, size: 200, bound: 72, objects: [], colliders: [], lanes: [], road: null, river: null, riverW: 0, bridge: null };
  M.R = rng(seed);
  M.isFree = (x, z, r, avoidRoad = true) => {
    if (Math.abs(x) > 76 || Math.abs(z) > 76) return false;
    for (const s of M.lanes) if (dist(x, z, s[0], s[1]) < r + 4.2) return false;
    for (const c of M.colliders) if (dist(x, z, c.x, c.z) < r + c.r + 0.6) return false;
    if (avoidRoad && M.road && polyDist(x, z, M.road) < r + 3.6) return false;
    return true;
  };
  M.add = (o, colR) => { M.objects.push(o); if (colR) M.colliders.push({ x: o.x, z: o.z, r: colR }); return o; };
  M.col = (x, z, r) => M.colliders.push({ x, z, r });
  M.pick = (arr) => arr[Math.floor(M.R() * arr.length)];
  return M;
}

function finish(M, blueTest) {
  // Spawn candidates: points along the open lanes (never inside cover).
  const all = [];
  for (let i = 0; i < M.lanes.length; i += 3) {
    const [x, z] = M.lanes[i];
    let ok = true;
    for (const c of M.colliders) if (dist(x, z, c.x, c.z) < c.r + 3) { ok = false; break; }
    if (ok && Math.abs(x) < 60 && Math.abs(z) < 60) all.push([x, z]);
  }
  M.spawns = { any: all, blue: all.filter(p => blueTest(p[0], p[1])), red: all.filter(p => !blueTest(p[0], p[1])) };
  // Spatial grid for fast collision queries (cell = 8 m).
  M.grid = new Map();
  const CS = 8;
  for (const c of M.colliders) {
    const x0 = Math.floor((c.x - c.r - 2) / CS), x1 = Math.floor((c.x + c.r + 2) / CS);
    const z0 = Math.floor((c.z - c.r - 2) / CS), z1 = Math.floor((c.z + c.r + 2) / CS);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx * 1000 + gz; let a = M.grid.get(k); if (!a) M.grid.set(k, (a = [])); a.push(c);
    }
  }
  M.near = (x, z) => M.grid.get(Math.floor(x / CS) * 1000 + Math.floor(z / CS)) || EMPTY;
  // Checksum so the client can verify it generated the same obstacles.
  let s = 0; for (const c of M.colliders) s = (s + Math.round(c.x * 10) * 31 + Math.round(c.z * 10) * 17 + Math.round(c.r * 10)) | 0;
  M.checksum = s >>> 0;
  delete M.R; delete M.isFree; delete M.add; delete M.col; delete M.pick;
  return M;
}
const EMPTY = [];

/* ============================ DESERT ============================ */
function desert() {
  const M = base('desert', 'Dune Crossing', 'desert', 1101);
  const R = M.R;
  M.road = catmull([[-90, 24], [-52, 15], [-24, 6], [0, -1], [22, -6], [48, -17], [90, -25]], 60);
  M.lanes = [
    ...ellipse(0, 2, 9, 6), ...ellipse(-6, 17, 5, 3.6), ...ellipse(6, -22, 5, 3), ...ellipse(18, -8, 5, 3.8),
    ...line([-25, -12], [-10, -8]), ...ellipse(22, 16, 4, 3.4)];
  const road = M.road;
  M.height = (x, z) => {
    const r = Math.sqrt(x * x + z * z * 1.1664), edge = smooth(36, 66, r);
    const dunes = (Math.sin(x * 0.09 + Math.cos(z * 0.05) * 2) * 0.5 + 0.5) * 4.5 + fbm(x * 0.05, z * 0.05) * 6.5;
    const inner = (fbm(x * 0.12 + 3, z * 0.12) - 0.5) * 0.45;
    const dr = polyDist(x, z, road);
    return inner * (1 - edge) + edge * dunes * 1.35 * (0.25 + 0.75 * smooth(4, 13, dr));
  };
  // Mesas / cliffs
  for (const [x, z, Rr, H] of [[-52, -36, 9, 13], [-30, -46, 7, 11], [38, -42, 10, 14], [60, -10, 8, 12], [54, 30, 9, 12], [-58, 32, 10, 13], [-62, 2, 7, 10], [10, -54, 8, 12], [-12, 50, 8, 9], [24, 48, 7, 8], [-40, -58, 9, 12], [64, -40, 8, 12]])
    M.add({ k: 'mesa', x, z, R: Rr, H, seed: Math.floor(R() * 1e9) }, Rr + 0.5);
  // Ruined buildings
  for (const [x, z, ry, w, d, H] of [[10, 11, 0.2, 7, 6, 3.4], [-25, 1, -0.4, 6.5, 6, 3.1], [29, 4, 0.55, 6, 5.5, 3.6], [-6, -33, 0.05, 9, 7, 4], [-40, -22, 0.3, 5.5, 5, 2.8]])
    M.add({ k: 'ruin', x, z, ry, w, d, H, seed: Math.floor(R() * 1e9) }, Math.max(w, d) * 0.62);
  // Jersey barriers
  const jersey = (x, z, ry) => M.add({ k: 'jersey', x, z, ry, alt: R() < 0.2 }, 1.1);
  for (let i = 0; i < 6; i++) if (i !== 3) jersey(-6 + i * 2.6, -14 + (i % 2) * 0.4, Math.PI / 2 + (R() - 0.5) * 0.25);
  jersey(34, -1, 0.3); jersey(36.5, 0.4, 0.5); jersey(-38, 10, 1.2); jersey(40, 12, -0.3);
  for (const [x, z] of [[-46, 4], [-43, 8], [-49, 9], [46, -4], [43, -9], [14, -30]]) M.add({ k: 'hedgehog', x, z }, 0.9);
  for (const [x, z, Rr, a0, a1] of [[4, 24, 2.6, Math.PI * 1.1, Math.PI * 1.9], [-36, -15, 2.4, -0.4, Math.PI * 0.7], [38, -20, 2.3, 0.6, Math.PI * 1.4]])
    M.add({ k: 'bags', x, z, R: Rr, a0, a1 }, Rr * 0.8);
  M.add({ k: 'tent', x: -33, z: -19, ry: 0.4 }, 2.4);
  M.add({ k: 'wreck', x: -34, z: -5 }, 2);
  for (const [x, z, tip] of [[14.5, 15], [15.3, 16.1], [14, 16.6, 1], [-21, 5.5], [-20, 6.4], [33, 8], [33.8, 7.2, 1], [-3, -28], [-2, -27.2], [37.5, -18.5]])
    M.add({ k: 'barrel', x, z, tip: !!tip, c: Math.floor(R() * 3) }, 0.5);
  for (const [x, z, y0, s] of [[-28.5, -2.5, 0, 1.1], [-27.4, -2.6, 0, 1.1], [-28, -2.5, 1.1, 1], [6, 15.5, 0, 1.1], [-10.5, -29, 0, 1.1], [-9.4, -29.5, 0, 0.9], [40, -2, 0, 1.1]])
    M.add({ k: 'crate', x, z, y0, s, ry: R() * 0.6 }, y0 ? 0 : 0.75);
  // Telegraph poles along the road
  { let acc = 0; for (let i = 1; i < road.length; i++) {
      const a = road[i - 1], b = road[i]; const L = dist(a[0], a[1], b[0], b[1]); acc += L;
      if (acc > 15) { acc = 0; const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; const x = b[0] + nx * 5, z = b[1] + nz * 5;
        if (!M.isFree(x, z, 0.4, false)) continue; M.add({ k: 'pole', x, z, ry: Math.atan2(nx, nz) }, 0.4); } } }
  for (const [x, z, Rr] of [[-2, -19, 3], [16, -1, 2.4], [-14, 5, 2], [30, -28, 3.4], [-22, 24, 2.6], [46, 6, 2.8]]) M.add({ k: 'crater', x, z, R: Rr });
  // Scatter rocks
  for (let i = 0; i < 260; i++) {
    const x = (R() - 0.5) * 150, z = (R() - 0.5) * 150; const big = R() < 0.28; const s = big ? 1.4 + R() * 1.4 : 0.4 + R() * 0.6;
    if (!M.isFree(x, z, s)) continue;
    M.add({ k: 'rock', x, z, s, v: Math.floor(R() * 6), c: Math.floor(R() * 4), ry: R() * TAU, sx: 0.9 + R() * 0.5, sy: 0.55 + R() * 0.35, sz: 0.9 + R() * 0.5, big }, big ? s * 1.05 : 0);
  }
  // Rock clusters as mid-field cover
  for (const [cx, cz] of [[-18, -2], [12, -14], [-2, -8.2], [26, -16], [-14, 12]]) for (let k = 0; k < 3; k++) {
    const x = cx + (R() - 0.5) * 2.6, z = cz + (R() - 0.5) * 2.6, s = 1.5 + R() * 0.9;
    M.add({ k: 'rock', x, z, s, v: Math.floor(R() * 6), c: Math.floor(R() * 4), ry: R() * TAU, sx: 0.9 + R() * 0.5, sy: 0.55 + R() * 0.35, sz: 0.9 + R() * 0.5, big: true }, s * 1.05);
  }
  for (let i = 0; i < 60; i++) { const x = (R() - 0.5) * 140, z = (R() - 0.5) * 140; if (M.isFree(x, z, 1)) M.add({ k: 'dryTree', x, z, seed: Math.floor(R() * 1e9) }, 0.5); }
  for (let i = 0; i < 200; i++) { const x = (R() - 0.5) * 150, z = (R() - 0.5) * 150; if (M.isFree(x, z, 0.6)) M.add({ k: 'dbush', x, z, seed: Math.floor(R() * 1e9) }); }
  for (let i = 0; i < 420; i++) { const x = (R() - 0.5) * 150, z = (R() - 0.5) * 150; if (M.isFree(x, z, 0.2, false)) M.add({ k: 'tuft', x, z, seed: Math.floor(R() * 1e9) }); }
  M.env = { sky: 0xcfe4ff, ground: 0xc79a64, fog: 0xf0d2a2, dust: 0xe0bb86 };
  return finish(M, (x, z) => z > 0);
}

/* ============================ FOREST ============================ */
function forest() {
  const M = base('forest', 'Pinewood Ford', 'forest', 2202);
  const R = M.R;
  M.road = catmull([[-90, -6], [-45, 3], [-14, -2], [10, -6], [26, -5.6], [46, -7], [90, -13]], 60);
  M.river = catmull([[30, -90], [22, -42], [26, -5], [19, 24], [27, 90]], 60);
  M.riverW = 5;
  M.bridge = { x0: 18.5, x1: 33.5, zc: -5.6, halfW: 2.2 };
  M.lanes = [
    ...ellipse(-4, 4, 9, 6), ...ellipse(-12, 22, 5, 3.5), ...ellipse(-33, -3, 4, 3), ...line([15, -5.7], [39, -6.3]),
    ...ellipse(-22, -16, 5, 3.6), ...ellipse(8, -21, 4.5, 3.5)];
  const road = M.road, river = M.river, rw = M.riverW;
  M.height = (x, z) => {
    const r = Math.sqrt(x * x + z * z), edge = smooth(40, 70, r);
    let y = (fbm(x * 0.1, z * 0.1) - 0.5) * 0.6 * (1 - edge) + edge * fbm(x * 0.04, z * 0.04) * 11;
    y += 3.2 * Math.exp(-((x + 36) * (x + 36) + (z - 12) * (z - 12)) / 90);
    const dr = polyDist(x, z, road); y *= 0.3 + 0.7 * smooth(3, 9, dr);
    const dv = polyDist(x, z, river); y -= 2.2 * (1 - smooth(rw - 1.5, rw + 2.5, dv));
    return y;
  };
  M.add({ k: 'bridge', x: 26, z: -5.6, x0: 18.5, x1: 33.5 });
  M.add({ k: 'cabin', x: 10, z: 18, ry: 0.3, w: 7, d: 5.2 }, 4.4);
  M.add({ k: 'tower', x: -36, z: 12 }, 2);
  for (const [x, z, ry] of [[-18, -31, 0.2], [-12, -33, 0.25], [-24, -29, 0.1], [40, 14, 1.4], [42, 20, 1.5]])
    M.add({ k: 'swall', x, z, ry, seed: Math.floor(R() * 1e9) }, 2.6);
  M.add({ k: 'nest', x: 14, z: -12 }, 2);
  for (const [x, z] of [[37, -1], [38.1, -1.3], [37.5, -0.2]]) M.add({ k: 'crate', x, z, y0: 0, s: 1.1, ry: R() });
  M.col(37.5, -0.8, 1.4);
  // Fence posts (visual) along the west road
  { let acc = 0; const posts = [];
    for (let i = 1; i < road.length; i++) { const a = road[i - 1], b = road[i]; if (b[0] < -66 || b[0] > -16) { if (posts.length) { M.add({ k: 'fence', posts: posts.splice(0) }); } continue; }
      const L = dist(a[0], a[1], b[0], b[1]); acc += L; if (acc < 2.6) continue; acc = 0;
      const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; posts.push([b[0] - nx * 4, b[1] - nz * 4]); }
    if (posts.length) M.add({ k: 'fence', posts }); }
  // Central boulders (cover inside the open clearing)
  for (const [x, z, s] of [[-4, 4, 2.1], [-2.4, 5.4, 1.4], [-5.2, 2.6, 1.1]])
    M.objects.push({ k: 'rock', x, z, s, v: Math.floor(R() * 6), c: 0, ry: R() * TAU, sx: 1.1, sy: 0.75, sz: 1.1, big: true, grey: true });
  M.col(-4, 4, 2.9);
  for (const [x, z, ry, L] of [[-14, -4, 0.5, 3.2], [4, 12, -0.3, 2.6], [-26, 6, 1.2, 3.2], [2, -11, 0.1, 3.6], [-16, -24, 0.9, 3.2]])
    M.add({ k: 'log', x, z, ry, L }, L * 0.45);
  // Trees
  for (let i = 0; i < 900; i++) {
    const x = (R() - 0.5) * 150, z = (R() - 0.5) * 150; const rc = dist(x, z, -2, 2);
    const dens = 0.12 + 0.88 * smooth(14, 34, rc) * (0.55 + 0.45 * fbm(x * 0.05 + 7, z * 0.05));
    if (R() > dens) continue;
    if (polyDist(x, z, river) < rw + 2.4) continue;
    const s = 0.8 + R() * 0.55; if (!M.isFree(x, z, 1.4 * s)) continue;
    if (R() < 0.62) M.add({ k: 'pine', x, z, s, c: Math.floor(R() * 4), ry: R() * TAU }, 0.7 * s);
    else M.add({ k: 'leafy', x, z, s, c: Math.floor(R() * 4), autumn: R() < 0.12 ? 1 + Math.floor(R() * 3) : 0, seed: Math.floor(R() * 1e9) }, 0.8 * s);
  }
  for (let i = 0; i < 180; i++) { const x = (R() - 0.5) * 140, z = (R() - 0.5) * 140; if (!M.isFree(x, z, 0.8)) continue; if (polyDist(x, z, river) < rw + 1.5) continue; M.add({ k: 'fbush', x, z, seed: Math.floor(R() * 1e9) }); }
  for (let i = 0; i < 24; i++) { const x = (R() - 0.5) * 120, z = (R() - 0.5) * 120; if (!M.isFree(x, z, 0.6)) continue; M.add({ k: 'stump', x, z, ry: R() }, 0.5); }
  for (let i = 0; i < 150; i++) {
    const x = (R() - 0.5) * 150, z = (R() - 0.5) * 150; const big = R() < 0.3; const s = big ? 1.2 + R() * 1.3 : 0.35 + R() * 0.5;
    if (!M.isFree(x, z, s)) continue; if (polyDist(x, z, river) < rw - 0.5 && !big) continue;
    M.add({ k: 'rock', x, z, s, v: Math.floor(R() * 6), c: Math.floor(R() * 3), ry: R() * TAU, sx: 0.9 + R() * 0.5, sy: 0.55 + R() * 0.35, sz: 0.9 + R() * 0.5, big, grey: true, moss: big }, big ? s * 1.05 : 0);
  }
  for (let i = 0; i < river.length; i += 2) { const p = river[i]; if (Math.abs(p[1]) > 70) continue;
    for (let k = 0; k < 2; k++) { const off = (R() - 0.5) * 2 * (rw + 1.2), x = p[0] + off, z = p[1] + (R() - 0.5) * 3;
      if (!M.isFree(x, z, 0.3, false)) continue;
      if (Math.abs(off) > rw - 1) M.add({ k: 'reeds', x, z, seed: Math.floor(R() * 1e9) });
      else M.add({ k: 'rock', x, z, s: 0.35 + R() * 0.4, v: Math.floor(R() * 6), c: 0, ry: R() * TAU, sx: 1, sy: 0.7, sz: 1, grey: true }); } }
  for (let i = 0; i < 700; i++) { const x = (R() - 0.5) * 150, z = (R() - 0.5) * 150;
    if (!M.isFree(x, z, 0.2, false)) continue; if (polyDist(x, z, river) < rw + 1) continue; if (polyDist(x, z, road) < 2.6) continue;
    if (R() < 0.18) M.add({ k: 'flower', x, z, c: Math.floor(R() * 3), ry: R() }); else M.add({ k: 'grass', x, z, seed: Math.floor(R() * 1e9) }); }
  M.env = { sky: 0xcfe6ff, ground: 0x557a3a, fog: 0xb7d3bd, dust: 0x9c8466 };
  return finish(M, (x, z) => x < -8 || (z > 8 && x < 14));
}

const cache = {};
export const MAP_IDS = ['desert', 'forest'];
export const MAP_NAMES = { desert: 'Dune Crossing', forest: 'Pinewood Ford' };
export function getMap(id) {
  if (!cache[id]) cache[id] = id === 'forest' ? forest() : desert();
  return cache[id];
}
