/* =====================================================================
   WIRE PROTOCOL
   - Real-time traffic (inputs, snapshots) is compact BINARY.
       input    ≈ 12 bytes, 30×/s per player (client → server)
       snapshot ≈ 18 header + 18 bytes per tank (server → client)
     With 8 tanks that's ~160 bytes × 30/s ≈ 5 KB/s per player.
   - Rare events (lobby, shots, hits, kills, chat) are small JSON text
     frames. Names/teams/scores are only sent when they change — they are
     never repeated inside snapshots.
   ===================================================================== */
import { TAU, wrapAngle, clamp } from './math.js';
import { MODE_DIR, MODE_CLASSIC } from './sim.js';

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

export const FLAG_ALIVE = 1, FLAG_SHIELD = 2, FLAG_CONNECTED = 4;
export const BTN_FIRE = 1;

export const qAngle = (a) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 65536) & 0xffff;
export const dqAngle = (q) => wrapAngle((q / 65536) * TAU);

/* ---------------- client → server: one input per sim tick ---------------- */
// raw = {seq, mode, dir, mag, throttle, steer, aim, fire}
export function encodeInput(raw) {
  const b = new ArrayBuffer(12), v = new DataView(b);
  v.setUint8(0, MSG_INPUT);
  v.setUint32(1, raw.seq >>> 0);
  v.setUint8(5, raw.mode);
  if (raw.mode === MODE_CLASSIC) {
    v.setUint16(6, Math.round(clamp(raw.throttle, -1, 1) * 127) + 127);
    v.setUint8(8, Math.round(clamp(raw.steer, -1, 1) * 127) + 127);
  } else {
    v.setUint16(6, qAngle(raw.dir || 0));
    v.setUint8(8, Math.round(clamp(raw.mag || 0, 0, 1) * 255));
  }
  v.setUint16(9, qAngle(raw.aim || 0));
  v.setUint8(11, raw.fire ? BTN_FIRE : 0);
  return b;
}
export function decodeInput(buf) {
  const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, 12);
  const mode = v.getUint8(5) === MODE_CLASSIC ? MODE_CLASSIC : MODE_DIR;
  const p1 = v.getUint16(6), p2 = v.getUint8(8);
  const inp = { seq: v.getUint32(1), mode, dir: 0, mag: 0, throttle: 0, steer: 0, aim: dqAngle(v.getUint16(9)), fire: (v.getUint8(11) & BTN_FIRE) !== 0 };
  if (mode === MODE_CLASSIC) { inp.throttle = clamp((p1 - 127) / 127, -1, 1); inp.steer = clamp((p2 - 127) / 127, -1, 1); }
  else { inp.dir = dqAngle(p1); inp.mag = p2 / 255; }
  return inp;
}
// The client runs its prediction on the *quantized* input so it matches the server bit-for-bit.
export const quantizeInput = (raw) => decodeInput(new Uint8Array(encodeInput(raw)));

/* ---------------- server → client: world snapshot ---------------- */
const HDR = 18, PER = 18;
// tanks = [{id, flags, x, z, yaw, t, v, w, hp, reload}]
export function encodeSnapshotBody(tanks) {
  const b = new ArrayBuffer(tanks.length * PER), v = new DataView(b);
  let o = 0;
  for (const t of tanks) {
    v.setUint8(o, t.id); v.setUint8(o + 1, t.flags);
    v.setInt16(o + 2, Math.round(clamp(t.x, -327, 327) * 100)); v.setInt16(o + 4, Math.round(clamp(t.z, -327, 327) * 100));
    v.setUint16(o + 6, qAngle(t.yaw)); v.setUint16(o + 8, qAngle(t.t));
    v.setInt16(o + 10, Math.round(clamp(t.v, -32, 32) * 1000)); v.setInt16(o + 12, Math.round(clamp(t.w, -32, 32) * 1000));
    v.setUint8(o + 14, clamp(Math.round(t.hp), 0, 255)); v.setUint8(o + 15, clamp(Math.round(t.reload * 50), 0, 255));
    v.setUint16(o + 16, clamp(Math.round(t.shield * 100), 0, 65535));
    o += PER;
  }
  return new Uint8Array(b);
}
export function encodeSnapshot(tick, time, ackSeq, body) {
  const out = new Uint8Array(HDR + body.length), v = new DataView(out.buffer);
  v.setUint8(0, MSG_SNAPSHOT); v.setUint32(1, tick >>> 0); v.setFloat64(5, time); v.setUint32(13, ackSeq >>> 0);
  v.setUint8(17, body.length / PER);
  out.set(body, HDR);
  return out;
}
export function decodeSnapshot(buf) {
  const v = new DataView(buf);
  const n = v.getUint8(17);
  const snap = { tick: v.getUint32(1), time: v.getFloat64(5), ack: v.getUint32(13), tanks: new Map() };
  let o = HDR;
  for (let i = 0; i < n; i++) {
    const t = {
      id: v.getUint8(o), flags: v.getUint8(o + 1),
      x: v.getInt16(o + 2) / 100, z: v.getInt16(o + 4) / 100,
      yaw: dqAngle(v.getUint16(o + 6)), t: dqAngle(v.getUint16(o + 8)),
      v: v.getInt16(o + 10) / 1000, w: v.getInt16(o + 12) / 1000,
      hp: v.getUint8(o + 14), reload: v.getUint8(o + 15) / 50, shield: v.getUint16(o + 16) / 100,
    };
    t.alive = (t.flags & FLAG_ALIVE) !== 0;
    snap.tanks.set(t.id, t);
    o += PER;
  }
  return snap;
}
