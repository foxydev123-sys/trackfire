/* =====================================================================
   NetClient — everything between the socket and the game renderer.

   ┌─ LOCAL PLAYER (client-side prediction + reconciliation) ───────────┐
   │ Every fixed tick (1/30 s) we sample the controls, send them to the │
   │ server AND immediately run the same shared simulateInput() locally,│
   │ so your tank reacts on the very next frame. Each input has a       │
   │ sequence number. Snapshots tell us the last input the server       │
   │ applied ("ack"); we reset to the server's state, replay the inputs │
   │ it hasn't seen yet, and blend any small difference out over ~60 ms │
   │ so corrections are invisible.                                      │
   └────────────────────────────────────────────────────────────────────┘
   ┌─ REMOTE TANKS (snapshot buffer + interpolation) ───────────────────┐
   │ Snapshots are stored in a buffer with their server timestamps. We  │
   │ render other tanks at  renderTime = serverNow − interpDelay         │
   │ (~100 ms) and blend between the two snapshots around that time on  │
   │ EVERY rendered frame. Movement is therefore continuous at 60 fps   │
   │ even though snapshots arrive 30×/s. If snapshots are late we       │
   │ extrapolate briefly, then hold — the game never freezes.           │
   └────────────────────────────────────────────────────────────────────┘
   Pure logic: no DOM, no Three.js (runs in Node for tests and bots).
   ===================================================================== */
import { NET, GAME } from '../../shared/config.js';
import { getMap } from '../../shared/maps.js';
import { newTankState, copyState, simulateInput, muzzleOf } from '../../shared/sim.js';
import { encodeInput, quantizeInput, decodeSnapshot, MSG_SNAPSHOT } from '../../shared/protocol.js';
import { lerp, lerpAngle, dist, wrapAngle } from '../../shared/math.js';
import { Connection } from './connection.js';

const DT = 1 / NET.TICK_RATE;
const TICK_MS = 1000 / NET.TICK_RATE;
const now = () => performance.now();

export class NetClient {
  constructor(opts) {
    this.openTransport = opts.openTransport;    // () => WebSocket-like
    this.name = opts.name; this.token = opts.token;
    this.h = opts.handlers || {};               // onRoom, onEvent, onStatus, onError, onWelcome
    this.conn = null; this.status = 'idle';     // idle | connecting | online | reconnecting | offline
    this.myId = 0; this.code = null; this.room = null; this.map = getMap('desert'); this.mapId = 'desert';
    this.reconnectTries = 0; this.wantOnline = false;
    // snapshots / clock
    this.snaps = []; this.latest = null;
    this.clockInit = false; this.offset = 0; this.offWin = []; this.excess = 0;
    this.interpDelay = NET.INTERP_DELAY_MS; this.renderTime = 0; this.renderInit = false;
    this.events = [];                           // scheduled on the render timeline
    // prediction
    this.seq = 0; this.history = []; this.acc = 0;
    this.me = newTankState(); this.prev = newTankState(); this.meAlive = false; this.meHp = GAME.HP;
    this.corr = { x: 0, z: 0, yaw: 0 };
    this.pendingShots = new Map();              // seq → predicted shot
    // stats
    this.st = { snaps: 0, snapsPS: 0, rtt: 0, rttAvg: 0, jitter: 0, corrections: 0, corrLast: 0, bytesInPS: 0, bytesOutPS: 0, snapAge: 0, bufferDepth: 0, lastIn: 0, lastOut: 0, extrap: 0 };
    this.statT = now(); this.pingT = 0;
  }

  /* ---------------- connection lifecycle ---------------- */
  connect(action, code, extra = {}) {
    this.wantOnline = true; this.action = action; this.code = code; this.extra = extra;
    this.open();
  }
  open() {
    this.setStatus(this.reconnectTries ? 'reconnecting' : 'connecting');
    this.conn = new Connection(this.openTransport, {
      onOpen: () => {
        this.conn.send(JSON.stringify({ t: 'hello', v: 1, name: this.name, token: this.token, action: this.action, code: this.code, ...this.extra }));
      },
      onMessage: (d) => this.onMessage(d),
      onClose: () => {
        if (!this.wantOnline) { this.setStatus('offline'); return; }
        this.reconnectTries++;
        if (this.reconnectTries > 12) { this.setStatus('offline'); this.h.onError && this.h.onError('Lost connection to the server.'); return; }
        this.setStatus('reconnecting');
        setTimeout(() => { if (this.wantOnline) this.open(); }, Math.min(4000, 500 * this.reconnectTries));
      },
    });
  }
  leave() { this.wantOnline = false; if (this.conn) { this.conn.send(JSON.stringify({ t: 'leave' })); this.conn.close(); } this.setStatus('offline'); }
  setStatus(s) { this.status = s; this.h.onStatus && this.h.onStatus(s); }
  sendJSON(o) { if (this.conn) this.conn.send(JSON.stringify(o)); }

  onMessage(d) {
    if (typeof d !== 'string') {
      const u8 = new Uint8Array(d);
      if (u8[0] === MSG_SNAPSHOT) this.onSnapshot(decodeSnapshot(d));
      return;
    }
    let m; try { m = JSON.parse(d); } catch (e) { return; }
    switch (m.t) {
      case 'welcome':
        this.myId = m.id; this.code = m.code; this.action = 'join'; this.reconnectTries = 0;
        this.setMap(m.map);
        this.mapMismatch = this.map.checksum !== m.checksum;
        this.serverTick = m.tickRate; this.snapEvery = m.snapEvery;
        this.setStatus('online');
        this.h.onWelcome && this.h.onWelcome(m);
        break;
      case 'room':
        this.room = m; if (m.map !== this.mapId) this.setMap(m.map);
        this.h.onRoom && this.h.onRoom(m);
        break;
      case 'pong': { const rtt = now() - m.c; this.st.rtt = rtt; this.st.rttAvg = this.st.rttAvg ? lerp(this.st.rttAvg, rtt, 0.2) : rtt; break; }
      case 'error': this.wantOnline = false; this.h.onError && this.h.onError(m.msg, m.code); this.conn.close(); break;
      case 'start': this.resetMatch(); this.setMap(m.map); this.h.onEvent && this.h.onEvent(m); break;
      case 'shot':
        if (m.o === this.myId) {                 // our own shot: confirm the predicted shell right away
          const p = this.pendingShots.get(m.seq); this.pendingShots.delete(m.seq);
          this.h.onEvent && this.h.onEvent({ ...m, own: true, pred: p || null });
        } else this.schedule(m);
        break;
      case 'hit':
        if (m.o === this.myId || m.v === this.myId) { if (m.v === this.myId) this.meHp = Math.max(0, this.meHp - m.dmg); this.h.onEvent && this.h.onEvent({ ...m, now: true }); }
        this.schedule(m);
        break;
      case 'kill':
        if (m.v === this.myId) { this.meAlive = false; this.h.onEvent && this.h.onEvent({ ...m, now: true }); }
        this.schedule(m);
        break;
      case 'spawn':
        if (m.id === this.myId) { this.me = newTankState(m.x, m.z, m.yaw); this.me.shield = GAME.SPAWN_SHIELD_S; copyState(this.prev, this.me); this.meAlive = true; this.meHp = GAME.HP; this.history = []; this.corr = { x: 0, z: 0, yaw: 0 }; }
        this.h.onEvent && this.h.onEvent({ ...m, now: true });
        break;
      default: this.h.onEvent && this.h.onEvent(m);
    }
  }
  setMap(id) { if (id && id !== this.mapId) { this.mapId = id; this.map = getMap(id); } }
  resetMatch() { this.snaps = []; this.events = []; this.history = []; this.meAlive = false; this.pendingShots.clear(); }
  schedule(m) { this.events.push(m); }

  /* ---------------- snapshots, clock, reconciliation ---------------- */
  onSnapshot(s) {
    const arrival = now();
    this.st.snaps++;
    // --- clock sync: offset = local − server. The smallest recent sample is the
    // least-delayed packet; everything above it is jitter.
    const sample = arrival - s.time;
    this.offWin.push([arrival, sample]);
    while (this.offWin.length && arrival - this.offWin[0][0] > 3000) this.offWin.shift();
    let mn = Infinity, mx = -Infinity; for (const w of this.offWin) { if (w[1] < mn) mn = w[1]; if (w[1] > mx) mx = w[1]; }
    if (!this.clockInit) { this.offset = mn; this.clockInit = true; }
    else this.offset = lerp(this.offset, mn, 0.05);
    this.excess = mx - mn;                         // worst recent jitter
    this.st.jitter = this.excess;
    // Interpolation delay grows with jitter so we always have a snapshot pair.
    const snapMs = TICK_MS * (this.snapEvery || NET.SNAPSHOT_EVERY);
    this.targetDelay = Math.min(NET.INTERP_DELAY_MAX_MS, Math.max(NET.INTERP_DELAY_MS, snapMs * 1.5 + this.excess + 10));

    this.snaps.push(s); this.latest = s;
    const cut = (this.renderTime || s.time) - 1500;
    while (this.snaps.length > 3 && this.snaps[0].time < cut) this.snaps.shift();
    if (this.snaps.length > 120) this.snaps.shift();

    // --- reconcile our own tank
    const me = s.tanks.get(this.myId);
    if (!me) return;
    this.meHp = me.hp;
    if (!me.alive) { this.meAlive = false; this.history = this.history.filter(h => h.seq > s.ack); return; }
    const others = this.othersFrom(s);
    if (!this.meAlive) {                           // (re)spawned: take the server state as-is
      this.meAlive = true; copyState(this.me, me); this.me.reload = me.reload; this.me.shield = me.shield;
      this.history = this.history.filter(h => h.seq > s.ack);
      for (const h of this.history) simulateInput(this.me, h.inp, DT, this.map, others);
      copyState(this.prev, this.me); this.corr = { x: 0, z: 0, yaw: 0 };
      return;
    }
    this.history = this.history.filter(h => h.seq > s.ack);
    const was = { x: this.me.x, z: this.me.z, yaw: this.me.yaw };
    const r = newTankState(); copyState(r, me);
    for (const h of this.history) simulateInput(r, h.inp, DT, this.map, others);
    const ex = was.x - r.x, ez = was.z - r.z, ey = wrapAngle(was.yaw - r.yaw);
    const err = Math.sqrt(ex * ex + ez * ez);
    if (err > 0.02 || Math.abs(ey) > 0.01) { this.st.corrections++; this.st.corrLast = err; }
    if (err > NET.SNAP_DISTANCE) { this.corr = { x: 0, z: 0, yaw: 0 }; copyState(this.prev, r); }
    else {
      // keep the tank visually where it was and fade the difference out
      this.corr.x += ex; this.corr.z += ez; this.corr.yaw += ey;
      this.prev.x -= ex; this.prev.z -= ez; this.prev.yaw -= ey;
    }
    copyState(this.me, r);
  }
  othersFrom(s) {
    const out = [];
    if (s) for (const t of s.tanks.values()) if (t.id !== this.myId && t.alive) out.push(t);
    return out;
  }

  /* ---------------- per-frame update ----------------
     getInput() returns the raw controls {mode, dir, mag, throttle, steer, aim, fire}.
     Returns info the renderer needs. */
  update(dtMs, getInput, playing) {
    const t = now();
    // ---- 1. fixed-rate input + local prediction
    this.acc += dtMs;
    let steps = 0;
    const fired = [];
    if (this.acc > TICK_MS * 6) this.acc = TICK_MS * 2;  // tab was asleep: don't burst
    while (this.acc >= TICK_MS && steps < 4) {
      this.acc -= TICK_MS; steps++;
      if (this.status !== 'online' || !playing) continue;
      const raw = getInput(this.me);
      raw.seq = ++this.seq;
      const inp = quantizeInput(raw);
      this.conn.send(encodeInput(raw));
      this.history.push({ seq: inp.seq, inp });
      if (this.history.length > 90) this.history.shift();
      if (this.meAlive) {
        copyState(this.prev, this.me);
        if (simulateInput(this.me, inp, DT, this.map, this.othersFrom(this.latest))) {
          const m = muzzleOf(this.me);
          const shot = { seq: inp.seq, x: m.x, z: m.z, a: this.me.t, at: t };
          this.pendingShots.set(inp.seq, shot); fired.push(shot);
          if (this.pendingShots.size > 20) this.pendingShots.delete(this.pendingShots.keys().next().value);
        }
      }
    }
    // correction offset decays with a half-life (smooth, frame-rate independent)
    const k = Math.pow(0.5, dtMs / NET.CORRECTION_HALF_LIFE_MS);
    this.corr.x *= k; this.corr.z *= k; this.corr.yaw *= k;

    // ---- 2. render clock for remote tanks
    if (this.clockInit) {
      // Delay changes are applied gently so the render clock never jumps.
      const td = this.targetDelay || NET.INTERP_DELAY_MS;
      this.interpDelay += Math.max(-0.02 * dtMs, Math.min(0.06 * dtMs, (td - this.interpDelay) * (td > this.interpDelay ? 0.05 : 0.01)));
      const target = t - this.offset - this.interpDelay;
      if (!this.renderInit || Math.abs(target - this.renderTime) > 400) { this.renderTime = target; this.renderInit = true; }
      else {
        // Time-scale by at most ±10% to converge on the target: remote tanks may
        // move 10% slower/faster for a moment, but never stop or jump.
        const adj = Math.max(-0.1 * dtMs, Math.min(0.1 * dtMs, (target - this.renderTime) * (dtMs / 250)));
        this.renderTime += dtMs + adj;
      }
    }
    // ---- 3. due events (remote shots, hits, kills) on the render timeline
    const due = [];
    if (this.events.length) {
      this.events.sort((a, b) => a.st - b.st);
      while (this.events.length && this.events[0].st <= this.renderTime) due.push(this.events.shift());
      if (this.events.length > 200) due.push(...this.events.splice(0, this.events.length - 200));
    }
    // ---- 4. stats + ping
    if (t - this.statT >= 1000) {
      const sec = (t - this.statT) / 1000; this.statT = t;
      this.st.snapsPS = this.st.snaps / sec; this.st.snaps = 0;
      if (this.conn) {
        this.st.bytesInPS = (this.conn.stats.bytesIn - this.st.lastIn) / sec; this.st.lastIn = this.conn.stats.bytesIn;
        this.st.bytesOutPS = (this.conn.stats.bytesOut - this.st.lastOut) / sec; this.st.lastOut = this.conn.stats.bytesOut;
      }
    }
    if (this.status === 'online' && t - this.pingT > NET.PING_INTERVAL_MS) { this.pingT = t; this.sendJSON({ t: 'ping', c: t, rtt: Math.round(this.st.rttAvg) }); }
    if (this.latest) this.st.snapAge = (t - this.offset) - this.latest.time;
    this.st.bufferDepth = this.snaps.filter(s => s.time > this.renderTime).length;
    return { alpha: this.acc / TICK_MS, fired, due };
  }

  /** Local tank pose for rendering (interpolated between fixed steps + smoothed corrections). */
  localPose(alpha) {
    const a = this.prev, b = this.me;
    return { x: lerp(a.x, b.x, alpha) + this.corr.x, z: lerp(a.z, b.z, alpha) + this.corr.z,
      yaw: lerpAngle(a.yaw, b.yaw, alpha) + this.corr.yaw, t: lerpAngle(a.t, b.t, alpha), v: b.v, reload: b.reload, shield: b.shield };
  }

  /** Remote tank pose at the current render time (interpolated / briefly extrapolated). */
  remotePose(id) {
    const S = this.snaps, rt = this.renderTime;
    if (!S.length) return null;
    let i = S.length - 1;
    while (i > 0 && S[i].time > rt) i--;
    const s0 = S[i], s1 = S[i + 1];
    const a = s0.tanks.get(id);
    if (!a) { const b = s1 && s1.tanks.get(id); return b && rt >= s1.time ? { ...b } : null; }
    if (rt < s0.time) return { ...a };                                 // older than our buffer
    if (s1) {
      const b = s1.tanks.get(id);
      if (!b || a.alive !== b.alive || dist(a.x, a.z, b.x, b.z) > 8) return { ...a }; // death/respawn: no sliding
      const f = (rt - s0.time) / (s1.time - s0.time);
      return { id, alive: a.alive, hp: b.hp, shield: b.shield, v: lerp(a.v, b.v, f),
        x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), yaw: lerpAngle(a.yaw, b.yaw, f), t: lerpAngle(a.t, b.t, f), extrap: 0 };
    }
    // Past the newest snapshot (late packet): extrapolate a little, then hold.
    const ex = Math.min(rt - s0.time, NET.EXTRAPOLATE_MAX_MS) / 1000;
    this.st.extrap = rt - s0.time;
    const yaw = a.yaw + a.w * ex;
    return { id, alive: a.alive, hp: a.hp, shield: a.shield, v: a.v, x: a.x + Math.sin(yaw) * a.v * ex, z: a.z + Math.cos(yaw) * a.v * ex, yaw, t: a.t, extrap: ex };
  }
  remoteIds() { return this.latest ? [...this.latest.tanks.keys()].filter(id => id !== this.myId) : []; }
}
