/* =====================================================================
   ROOM — one private match. Transport-agnostic: the Node server plugs
   real WebSockets in, practice mode plugs a Web Worker in. A "conn" is
   anything with send(stringOrBytes), close() and optional congested().

   The room is SERVER-AUTHORITATIVE: clients only send inputs (move
   direction, aim angle, fire button). The room moves tanks, fires shells,
   decides hits, damage, kills and respawns, and tells everyone.
   ===================================================================== */
import { NET, GAME } from './config.js';
import { getMap, MAP_IDS } from './maps.js';
import { newTankState, simulateInput, stepShell, muzzleOf } from './sim.js';
import { decodeInput, quantizeInput, encodeSnapshotBody, encodeSnapshot, MSG_INPUT, FLAG_ALIVE, FLAG_SHIELD, FLAG_CONNECTED } from './protocol.js';
import { BotBrain } from './bot.js';
import { dist } from './math.js';

const DT = 1 / NET.TICK_RATE;
const BOT_NAMES = ['Bolt', 'Rook', 'Havoc', 'Dozer', 'Ember', 'Flint', 'Ghost', 'Juno', 'Brick', 'Nova'];

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.now = opts.now || (() => Date.now());
    this.log = opts.log || (() => {});
    this.players = new Map();
    this.state = 'lobby';          // lobby → playing → ended → lobby
    this.mapId = 'desert';
    this.mode = 'tdm';
    this.map = getMap(this.mapId);
    this.hostId = 0;
    this.tick = 0;
    this.time = this.now();
    this.shells = [];
    this.shellSeq = 1;
    this.dirty = true;
    this.infoT = 0;
    this.endTime = 0;
    this.endAt = 0;
    this.emptySince = this.time;
    this.winner = null;
  }

  /* ---------------- membership ---------------- */
  humans() { return [...this.players.values()].filter(p => !p.bot); }
  connectedHumans() { return this.humans().filter(p => p.connected); }
  nextId() { for (let i = 1; i < 250; i++) if (!this.players.has(i)) return i; return 0; }
  teamCounts() { const c = { blue: 0, red: 0 }; for (const p of this.players.values()) if (c[p.team] !== undefined) c[p.team]++; return c; }
  pickTeam() { if (this.mode === 'ffa') return 'ffa'; const c = this.teamCounts(); return c.blue <= c.red ? 'blue' : 'red'; }

  join(conn, name, token) {
    name = String(name || 'Player').replace(/[^\w\- .]/g, '').trim().slice(0, 14) || 'Player';
    // Reconnect: same token takes its old slot back (stats kept).
    if (token) for (const p of this.players.values()) {
      if (!p.bot && p.token === token) {
        if (p.conn && p.conn !== conn && p.connected) try { p.conn.close(); } catch (e) {}
        p.conn = conn; p.connected = true; p.disconnectedAt = 0; p.name = name; p.inputQ.length = 0; p.starving = true;
        this.emptySince = 0; this.dirty = true;
        if (!this.hostId || !this.players.get(this.hostId)?.connected) this.hostId = p.id;
        this.welcome(p);
        if (this.state === 'playing' && !p.alive && p.deadT <= 0) this.spawn(p);
        this.log(`[${this.code}] ${name} reconnected`);
        return p;
      }
    }
    if (this.players.size >= GAME.MAX_PLAYERS) {
      const bot = [...this.players.values()].find(p => p.bot);
      if (!bot) return { error: 'This room is full.' };
      this.removePlayer(bot);
    }
    const id = this.nextId();
    const p = this.makePlayer(id, name, this.pickTeam());
    p.token = token; p.conn = conn; p.connected = true;
    this.players.set(id, p);
    if (!this.hostId || !this.players.get(this.hostId)?.connected) this.hostId = id;
    this.emptySince = 0; this.dirty = true;
    this.welcome(p);
    if (this.state === 'playing') this.spawn(p);
    this.log(`[${this.code}] ${name} joined (${this.players.size} players)`);
    return p;
  }
  makePlayer(id, name, team) {
    return { id, name, team, token: null, conn: null, connected: false, bot: null, ready: false,
      k: 0, d: 0, ping: 0, s: newTankState(), alive: false, hp: GAME.HP, deadT: 0, killer: 0,
      inputQ: [], lastSeq: 0, lastQueued: 0, lastInput: null, debt: 0, starving: true, bufTarget: NET.INPUT_BUFFER_MIN + 1,
      disconnectedAt: 0 };
  }
  addBot() {
    if (this.players.size >= GAME.MAX_PLAYERS) return;
    const id = this.nextId();
    const used = new Set([...this.players.values()].map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot' + id;
    const p = this.makePlayer(id, name, this.pickTeam());
    p.bot = new BotBrain(this.map, id * 7919); p.ready = true; p.connected = true;
    this.players.set(id, p); this.dirty = true;
    if (this.state === 'playing') this.spawn(p);
  }
  removeBot() { const b = [...this.players.values()].reverse().find(p => p.bot); if (b) this.removePlayer(b); }
  removePlayer(p) {
    this.players.delete(p.id);
    if (this.hostId === p.id) { const h = this.connectedHumans()[0]; this.hostId = h ? h.id : 0; }
    this.dirty = true;
    this.broadcast({ t: 'left', id: p.id });
  }
  disconnect(p) {
    if (!this.players.has(p.id) || !p.connected) return;
    p.connected = false; p.conn = null; p.disconnectedAt = this.time; p.alive = false; p.inputQ.length = 0;
    if (this.hostId === p.id) { const h = this.connectedHumans()[0]; if (h) this.hostId = h.id; }
    if (!this.connectedHumans().length) this.emptySince = this.time;
    this.dirty = true;
    this.log(`[${this.code}] ${p.name} disconnected`);
  }
  welcome(p) {
    this.send(p, { t: 'welcome', id: p.id, code: this.code, tickRate: NET.TICK_RATE, snapEvery: NET.SNAPSHOT_EVERY, st: this.time, map: this.mapId, checksum: this.map.checksum });
    this.send(p, this.roomInfo());
  }

  /* ---------------- messages ---------------- */
  onBinary(p, bytes) {
    if (bytes[0] !== MSG_INPUT || bytes.length < 12) return;
    const inp = decodeInput(bytes);
    if (inp.seq <= p.lastQueued) return;          // duplicate / old
    p.lastQueued = inp.seq;
    p.inputQ.push(inp);
    // Arrival jitter estimate (ms) → sizes the cushion at the next spawn.
    const t = this.now(), gap = p.lastArr ? t - p.lastArr : 33.3; p.lastArr = t;
    const dev = Math.abs(gap - 1000 / NET.TICK_RATE);
    p.arrJit = (p.arrJit || 0) * 0.97 + dev * 0.03;
    if (p.inputQ.length > NET.MAX_INPUT_QUEUE) p.inputQ.splice(0, p.inputQ.length - NET.INPUT_BUFFER_MAX);
  }
  onJSON(p, m) {
    const host = p.id === this.hostId;
    switch (m.t) {
      case 'ping': p.ping = Math.max(0, Math.min(9999, m.rtt | 0)); this.send(p, { t: 'pong', c: m.c, st: this.now() }); break;
      case 'ready': p.ready = !!m.v; this.dirty = true; break;
      case 'team':
        if (this.mode === 'tdm' && (m.team === 'blue' || m.team === 'red') && this.state !== 'playing') { p.team = m.team; this.dirty = true; }
        break;
      case 'map': if (host && MAP_IDS.includes(m.map) && this.state === 'lobby') { this.mapId = m.map; this.map = getMap(m.map); this.dirty = true; } break;
      case 'mode':
        if (host && GAME.MODES[m.mode] && this.state === 'lobby' && m.mode !== this.mode) {
          this.mode = m.mode;
          let i = 0; for (const q of this.players.values()) q.team = m.mode === 'ffa' ? 'ffa' : (i++ % 2 ? 'red' : 'blue');
          this.dirty = true;
        }
        break;
      case 'start': if (host) this.start(); break;
      case 'stop': if (host && this.state === 'playing') this.end(null); break;
      case 'addBot': if (host) this.addBot(); break;
      case 'removeBot': if (host) this.removeBot(); break;
      case 'leave': this.removePlayer(p); try { p.conn?.close(); } catch (e) {} break;
    }
  }
  send(p, obj) { if (p.conn && p.connected) p.conn.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  broadcast(obj) { const s = JSON.stringify(obj); for (const p of this.players.values()) if (!p.bot) this.send(p, s); }

  /* ---------------- match flow ---------------- */
  start() {
    if (this.state !== 'lobby') return;
    this.shells = [];
    for (const p of this.players.values()) {
      p.k = 0; p.d = 0; p.alive = false; p.deadT = 0; p.inputQ.length = 0; p.starving = true;
      if (p.bot) p.bot = new BotBrain(this.map, p.id * 7919 + this.tick);
    }
    this.state = 'playing'; this.winner = null;
    this.endTime = this.time + GAME.MODES[this.mode].timeLimitS * 1000;
    this.broadcast({ t: 'start', map: this.mapId, mode: this.mode, st: this.time });
    for (const p of this.players.values()) if (p.connected) this.spawn(p);
    this.dirty = true;
    this.log(`[${this.code}] match started on ${this.mapId}`);
  }
  end(winner) {
    this.state = 'ended'; this.winner = winner; this.endAt = this.time + GAME.END_SCREEN_S * 1000; this.shells = [];
    this.broadcast({ t: 'end', winner, st: this.time });
    this.dirty = true;
  }
  toLobby() {
    this.state = 'lobby';
    for (const p of this.players.values()) { p.alive = false; if (!p.bot) p.ready = false; }
    this.dirty = true;
  }
  teamScore(team) { let s = 0; for (const p of this.players.values()) if (p.team === team) s += p.k; return s; }
  checkScore() {
    const lim = GAME.MODES[this.mode].scoreLimit;
    if (this.mode === 'tdm') { for (const t of ['blue', 'red']) if (this.teamScore(t) >= lim) return this.end(t); }
    else for (const p of this.players.values()) if (p.k >= lim) return this.end(p.id);
  }
  timeUp() {
    if (this.mode === 'tdm') { const b = this.teamScore('blue'), r = this.teamScore('red'); this.end(b === r ? 'draw' : b > r ? 'blue' : 'red'); }
    else { let best = null; for (const p of this.players.values()) if (!best || p.k > best.k) best = p; this.end(best ? best.id : 'draw'); }
  }

  enemies(a, b) { return a.id !== b.id && (a.team === 'ffa' || a.team !== b.team); }

  spawn(p) {
    const pool = this.mode === 'tdm' ? this.map.spawns[p.team] : this.map.spawns.any;
    const live = [...this.players.values()].filter(q => q.alive && q !== p);
    let best = null, bestScore = -1e9;
    for (const [x, z] of pool) {
      let minFoe = 200, minAny = 200;
      for (const q of live) {
        const d = dist(x, z, q.s.x, q.s.z);
        if (d < minAny) minAny = d;
        if (this.enemies(p, q) && d < minFoe) minFoe = d;
      }
      if (minAny < 6) continue;                          // never on top of a tank
      const score = Math.min(minFoe, 45) + Math.random() * 8; // far from enemies, a bit random
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    if (!best) best = pool[Math.floor(Math.random() * pool.length)] || [0, 0];
    const yaw = Math.atan2(-best[0], -best[1]);          // face the middle of the map
    p.s = newTankState(best[0], best[1], yaw);
    p.s.shield = GAME.SPAWN_SHIELD_S;
    p.hp = GAME.HP; p.alive = true; p.deadT = 0; p.inputQ.length = 0; p.starving = true; p.debt = 0; p.lastInput = null;
    p.bufTarget = Math.max(NET.INPUT_BUFFER_MIN, Math.min(NET.INPUT_BUFFER_MAX, 1 + Math.ceil((p.arrJit || 0) * 2.5 / (1000 / NET.TICK_RATE))));
    this.broadcast({ t: 'spawn', id: p.id, x: p.s.x, z: p.s.z, yaw, st: this.time });
  }

  fire(p, seq) {
    const m = muzzleOf(p.s);
    const sh = { id: this.shellSeq++, owner: p.id, x: m.x, z: m.z, dx: Math.sin(p.s.t), dz: Math.cos(p.s.t), trav: 0, max: GAME.SHELL_RANGE };
    this.shells.push(sh);
    this.broadcast({ t: 'shot', id: sh.id, o: p.id, x: +m.x.toFixed(2), z: +m.z.toFixed(2), a: +p.s.t.toFixed(4), seq, st: this.time });
  }

  kill(v, k) {
    v.alive = false; v.deadT = GAME.RESPAWN_S; v.killer = k.id; v.d++;
    if (k !== v) k.k++;
    this.broadcast({ t: 'kill', k: k.id, v: v.id, st: this.time });
    this.dirty = true;
    this.checkScore();
  }

  /* ---------------- the fixed-rate server tick ---------------- */
  update() {
    this.time = this.now();
    this.tick++;
    if (this.state === 'playing') this.simulate();
    else if (this.state === 'ended' && this.time >= this.endAt) this.toLobby();

    if (this.state === 'playing' && this.tick % NET.SNAPSHOT_EVERY === 0) this.sendSnapshots();
    this.infoT += DT;
    if (this.dirty || this.infoT > 2) { this.broadcast(this.roomInfo()); this.dirty = false; this.infoT = 0; }
    // Drop players whose reconnect grace ran out.
    for (const p of [...this.players.values()])
      if (!p.bot && !p.connected && this.time - p.disconnectedAt > NET.RECONNECT_GRACE_MS) this.removePlayer(p);
  }

  simulate() {
    const list = [...this.players.values()];
    const othersOf = (p) => list.filter(q => q !== p && q.alive).map(q => q.s);
    for (const p of list) {
      if (p.bot) {
        if (!p.alive) continue;
        const foes = list.filter(q => q.alive && this.enemies(p, q)).map(q => q.s);
        const inp = quantizeInput(p.bot.think(p.s, foes, DT));
        if (simulateInput(p.s, inp, DT, this.map, othersOf(p))) this.fire(p, 0);
        continue;
      }
      if (!p.connected) continue;
      // ---- input jitter buffer (see NET.INPUT_BUFFER_*) ----
      // A cushion of `bufTarget` inputs is built only while the tank is
      // standing at spawn. After that: one input per tick; if an input is
      // late we take a "phantom" step with the previous input (so nobody
      // sees a stall) and repay it one-per-tick once the late inputs arrive.
      const q = p.inputQ;
      if (p.starving) {
        if (q.length < p.bufTarget) { p.nStarve = (p.nStarve || 0) + 1; continue; }
        p.starving = false;
      }
      if (!q.length) {
        if (p.alive && p.lastInput && p.debt < NET.INPUT_BUFFER_MAX + 2) {
          p.debt++; p.nPhantom = (p.nPhantom || 0) + 1;
          simulateInput(p.s, { ...p.lastInput, fire: false }, DT, this.map, othersOf(p));
        } else p.starving = true;
        continue;
      }
      // Jitter got worse mid-match: keep one phantom step instead of repaying it,
      // which grows the cushion by one input without ever pausing the tank.
      const want = Math.min(NET.INPUT_BUFFER_MAX, 1 + Math.ceil((p.arrJit || 0) * 2.5 / (1000 / NET.TICK_RATE)));
      if (p.debt > 0 && p.bufTarget < want) { p.bufTarget++; p.debt--; }
      if (p.debt > 0 && q.length > p.bufTarget) {
        const skip = q.shift(); p.debt--; p.lastSeq = skip.seq; p.lastInput = skip;
        if (p.alive && skip.fire && p.s.reload <= 0) { p.s.reload = GAME.RELOAD_S; p.s.shield = 0; this.fire(p, skip.seq); }
      }
      // Normally one input per tick; catch up gently if a big burst piled up.
      let n = q.length > p.bufTarget + 6 ? 2 : 1;
      while (n-- > 0 && q.length) {
        const inp = q.shift();
        p.lastSeq = inp.seq; p.lastInput = inp;
        if (!p.alive) continue;
        if (simulateInput(p.s, inp, DT, this.map, othersOf(p))) this.fire(p, inp.seq);
      }
    }
    // Respawn timers
    for (const p of list) if (!p.alive && p.deadT > 0) { p.deadT -= DT; if (p.deadT <= 0 && p.connected) this.spawn(p); }
    // Shells — the server alone decides what they hit.
    const targets = list.filter(p => p.alive).map(p => ({ id: p.id, x: p.s.x, z: p.s.z, alive: true }));
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      const r = stepShell(sh, DT, this.map, targets);
      if (!r) continue;
      this.shells.splice(i, 1);
      let victim = 0, dmg = 0;
      if (r.hit === 'tank') {
        const v = this.players.get(r.id), k = this.players.get(sh.owner);
        if (v && v.alive) {
          victim = v.id;
          const friendly = k && !this.enemies(k, v);
          if (v.s.shield <= 0 && !friendly) {
            dmg = GAME.DAMAGE_MIN + Math.floor(Math.random() * (GAME.DAMAGE_MAX - GAME.DAMAGE_MIN + 1));
            v.hp -= dmg;
          }
          this.broadcast({ t: 'hit', s: sh.id, o: sh.owner, x: +r.x.toFixed(2), z: +r.z.toFixed(2), v: victim, dmg, st: this.time });
          if (v.hp <= 0 && v.alive) this.kill(v, k || v);
          continue;
        }
      }
      this.broadcast({ t: 'hit', s: sh.id, o: sh.owner, x: +r.x.toFixed(2), z: +r.z.toFixed(2), v: 0, dmg: 0, w: r.hit === 'wall' ? 1 : 0, st: this.time });
    }
    if (this.state === 'playing' && this.time >= this.endTime) this.timeUp();
  }

  sendSnapshots() {
    const tanks = [];
    for (const p of this.players.values()) {
      if (!p.connected && !p.bot) continue;
      tanks.push({ id: p.id, flags: (p.alive ? FLAG_ALIVE : 0) | (p.s.shield > 0 ? FLAG_SHIELD : 0) | (p.connected ? FLAG_CONNECTED : 0),
        x: p.s.x, z: p.s.z, yaw: p.s.yaw, t: p.s.t, v: p.s.v, w: p.s.w, hp: Math.max(0, p.hp), reload: p.s.reload, shield: p.s.shield });
    }
    const body = encodeSnapshotBody(tanks);
    for (const p of this.players.values()) {
      if (p.bot || !p.connected || !p.conn) continue;
      // A client that can't keep up gets this snapshot skipped instead of
      // building a backlog (a backlog is what makes tanks lag seconds behind).
      if (p.conn.congested && p.conn.congested()) { p.skipped = (p.skipped || 0) + 1; continue; }
      p.conn.send(encodeSnapshot(this.tick, this.time, p.lastSeq, body));
    }
  }

  roomInfo() {
    const lim = GAME.MODES[this.mode];
    return { t: 'room', code: this.code, host: this.hostId, map: this.mapId, mode: this.mode, state: this.state,
      limit: lim.scoreLimit, timeLeft: this.state === 'playing' ? Math.max(0, Math.round((this.endTime - this.time) / 1000)) : lim.timeLimitS,
      winner: this.winner,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, k: p.k, d: p.d, ping: p.bot ? 0 : p.ping, conn: p.connected, bot: !!p.bot })) };
  }
}
