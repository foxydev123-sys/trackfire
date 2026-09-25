/* =====================================================================
   TRACKFIRE server — one Node process that:
     1. serves the game's web files (so friends only need one URL), and
     2. runs every private room over WebSockets at a fixed tick rate.
   Zero npm dependencies:  node server/index.js
   Env: PORT (default 8080), HOST (default 0.0.0.0),
        SIM_LATENCY_MS (adds artificial one-way delay to server→client, for testing)
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { attachWebSocket } from './ws.js';
import { Room } from '../client/shared/room.js';
import { NET, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../client/shared/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const SIM_LATENCY = Number(process.env.SIM_LATENCY_MS) || 0;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------- static files ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let base = path.join(ROOT, 'client');
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- rooms ---------------- */
const rooms = new Map();
const now = () => performance.now();
function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true })); return; }
  if (url === '/stats') {
    const r = [...rooms.values()].map(x => ({ code: x.code, state: x.state, map: x.mapId, players: x.players.size }));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rooms: r, tickRate: NET.TICK_RATE })); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  serveStatic(req, res);
});

attachWebSocket(server, '/ws', (ws) => {
  ws.sendDelay = SIM_LATENCY;
  let room = null, player = null;
  const helloTimer = setTimeout(() => { if (!player) ws.close(1008); }, 15000);
  ws.on('message', (data, isBinary) => {
    if (player) {
      if (isBinary) room.onBinary(player, data);
      else { let m; try { m = JSON.parse(data); } catch (e) { return; } room.onJSON(player, m); if (m.t === 'leave') { player = null; room = null; } }
      return;
    }
    // First message must be {t:'hello', name, token, action:'create'|'join', code}
    if (isBinary) return;
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t !== 'hello') return;
    if (m.action === 'create') {
      const code = newCode();
      room = new Room(code, { now, log });
      rooms.set(code, room);
      log(`room ${code} created`);
    } else {
      const code = String(m.code || '').toUpperCase().trim();
      room = rooms.get(code);
      if (!room) { ws.send(JSON.stringify({ t: 'error', code: 'no_room', msg: `No room with code ${code}. Check the code or create a new room.` })); return; }
    }
    const r = room.join(ws, m.name, String(m.token || '').slice(0, 64));
    if (r.error) { ws.send(JSON.stringify({ t: 'error', code: 'full', msg: r.error })); room = null; return; }
    player = r; clearTimeout(helloTimer);
    if (m.action === 'create') { if (m.map) room.onJSON(player, { t: 'map', map: m.map }); if (m.mode) room.onJSON(player, { t: 'mode', mode: m.mode }); }
  });
  ws.on('close', () => { clearTimeout(helloTimer); if (room && player) room.disconnect(player); });
});

/* ---------------- fixed-rate simulation loop ----------------
   Every room advances exactly NET.TICK_RATE times per second. The loop
   corrects for timer drift, and if the process stalls it catches up a few
   ticks instead of slowing the game down. */
const TICK_MS = 1000 / NET.TICK_RATE;
let nextTick = performance.now();
function loop() {
  const t = performance.now();
  let steps = 0;
  while (t >= nextTick && steps < 5) {
    for (const [code, room] of rooms) {
      try { room.update(); } catch (e) { log('room error', code, e); }
      if (!room.connectedHumans().length && room.emptySince && t - room.emptySince > NET.RECONNECT_GRACE_MS) { rooms.delete(code); log(`room ${code} closed (empty)`); }
    }
    nextTick += TICK_MS; steps++;
  }
  if (t - nextTick > 500) nextTick = t;           // don't spiral after a long stall
  setTimeout(loop, Math.max(0, nextTick - performance.now()));
}
loop();

server.listen(PORT, HOST, () => log(`Trackfire server on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (tick ${NET.TICK_RATE} Hz, snapshots ${NET.TICK_RATE / NET.SNAPSHOT_EVERY}/s${SIM_LATENCY ? `, simulated latency ${SIM_LATENCY} ms` : ''})`));
