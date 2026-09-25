/* =====================================================================
   TRACKFIRE — app entry: screens (menu → lobby → match), wiring between
   the network client, the 3D game, HUD, input, audio and settings.
   ===================================================================== */
import { settings, saveSettings, useTouch, getToken, CAMERA, QUALITY } from './settings.js';
import { NetClient } from './net/netclient.js';
import { workerTransport, LAT_SIM } from './net/connection.js';
import { HUD } from './ui/hud.js';
import { Input } from './input/input.js';
import { TouchControls } from './input/touch.js';
import { GameAudio } from './audio/audio.js';
import { GAME } from '../shared/config.js';
import { getMap } from '../shared/maps.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let THREE, buildWorld, Game;
let renderer, camera, game, net = null, hud, input, touch, audio;
let screen = 'loading';            // loading | menu | lobby | game
let room = null, worlds = {}, menuWorld = null, menuAngle = 0, practice = false;

const params = new URLSearchParams(location.search);
const SERVER_URL = params.get('server') || window.TRACKFIRE_SERVER || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function showErr(msg) { const e = $('menuErr'); e.textContent = msg; e.hidden = !msg; }

/* ---------------- boot ---------------- */
async function boot() {
  try {
    THREE = await import('./three.js');
    ({ buildWorld } = await import('./game/world.js'));
    ({ Game } = await import('./game/game.js'));
  } catch (e) {
    $('loadMsg').textContent = 'Could not load the 3D engine. Check your internet connection and reload.'; console.error(e); return;
  }
  $('loadMsg').textContent = 'Building maps…';
  await new Promise(r => setTimeout(r, 20));
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
  } catch (e) { $('loadMsg').textContent = 'WebGL is not available in this browser.'; return; }
  renderer.shadowMap.enabled = true;
  camera = new THREE.PerspectiveCamera(CAMERA.FOV, innerWidth / innerHeight, 1, 400);
  hud = new HUD(); input = new Input($('view')); input.mode = settings.controls;
  touch = new TouchControls($('touch'), { moveBase: $('moveBase'), moveKnob: $('moveKnob'), aimBase: $('aimBase'), aimKnob: $('aimKnob'), fire: $('fireBtn') });
  touch.getScale = () => parseFloat(getComputedStyle($('touch')).getPropertyValue('--ts')) || 1;
  audio = new GameAudio(); applyAudio();
  game = new Game({ renderer, camera, net: null, hud, input, audio, getWorld });
  applyTouchMode();
  menuWorld = getWorld('desert');
  renderThumbs();
  game.W = null;
  $('nameInp').value = settings.name || '';
  const code = (params.get('room') || '').toUpperCase().slice(0, 5);
  if (code) $('codeInp').value = code;
  refreshPlayHint();
  if (window.TRACKFIRE_PRACTICE_ONLY) {
    for (const id of ['btnPlay', 'btnCreate']) $(id).hidden = true;
    document.querySelector('.join').hidden = true; $('menuNote').hidden = false;
    $('btnPractice').classList.add('primary');
  }
  $('loading').remove();
  show('menu');
  if (code && settings.name && !window.TRACKFIRE_PRACTICE_ONLY) joinRoom(code);
  window.addEventListener('resize', onResize); onResize();
  // Handy for debugging from the browser console: __tf.net.st, __tf.game …
  window.__tf = { get net() { return net; }, game, hud, get room() { return room; }, LAT_SIM };
  requestAnimationFrame(loop);
}

function getWorld(id) {
  if (!worlds[id]) worlds[id] = buildWorld(getMap(id), { lowDetail: (QUALITY[settings.quality] || QUALITY.medium).lowDetail, sun: settings.sun });
  return worlds[id];
}
function renderThumbs() {
  const tc = new THREE.PerspectiveCamera(40, 16 / 9, 1, 400);
  renderer.setPixelRatio(1); renderer.setSize(480, 270, false);
  for (const id of ['desert', 'forest']) {
    const W = getWorld(id); tc.position.set(0, 70, 52); tc.lookAt(0, 0, -4); W.follow(new THREE.Vector3(0, 0, 0));
    renderer.render(W.scene, tc);
    $(id === 'desert' ? 'thDesert' : 'thForest').src = renderer.domElement.toDataURL('image/jpeg', 0.82);
  }
  onResize();
}

/* ---------------- screens ---------------- */
function show(s) {
  screen = s;
  $('scr-menu').hidden = s !== 'menu';
  $('scr-lobby').hidden = s !== 'lobby';
  hud.show(s === 'game');
  $('touch').hidden = !(s === 'game' && hud.touch);
  document.body.classList.toggle('aiming', s === 'game' && !hud.touch);
  if (s !== 'game') { $('pause').hidden = true; hud.toggleScores(false); }
  if (s === 'game') { audio.stopMusic(); } else if (audio.ctx) audio.startMusic();
  checkRotate();
}
function onResize() {
  if (!renderer) return;
  if (screen === 'game') game.resize();
  else { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); hud.layout(); }
  checkRotate();
}
function checkRotate() { $('rotate').hidden = !(screen === 'game' && hud && hud.touch && innerHeight > innerWidth); }

/* ---------------- networking ---------------- */
function playerName() {
  const n = $('nameInp').value.trim().slice(0, 14);
  if (!n) { $('nameInp').focus(); showErr('Enter a callsign first.'); return null; }
  settings.name = n; saveSettings(); return n;
}
function makeNet(openTransport) {
  if (net) { net.wantOnline = false; try { net.conn && net.conn.close(); } catch (e) {} }
  net = new NetClient({
    name: settings.name, token: getToken(), openTransport,
    handlers: {
      onWelcome: (m) => { if (!practice) { try { localStorage.setItem('trackfire-last-room', m.code); } catch (e) {} } history.replaceState(null, '', practice ? location.pathname : '?room=' + m.code + (params.get('server') ? '&server=' + encodeURIComponent(params.get('server')) : '')); },
      onRoom: onRoom,
      onEvent: onNetEvent,
      onError: (msg) => { toMenu(); showErr(msg); },
      onStatus: (s) => { if (screen === 'lobby') $('lbNote').textContent = s === 'online' ? '' : s === 'reconnecting' ? 'Connection lost — reconnecting…' : s === 'connecting' ? 'Connecting…' : ''; },
    },
  });
  game.net = net;
  return net;
}
function connect(action, code, extra) {
  audio.unlock(); showErr('');
  const name = playerName(); if (!name) return;
  practice = false;
  makeNet(() => new WebSocket(SERVER_URL)).connect(action, code, extra);
  $('lbNote').textContent = 'Connecting…';
  room = null; showLobbySkeleton(code);
}
function joinRoom(code) {
  code = (code || '').toUpperCase().trim();
  if (code.length !== 5) { showErr('Room codes are 5 characters, like F7K2Q.'); return; }
  connect('join', code);
}
function startPractice() {
  audio.unlock(); showErr('');
  const name = playerName(); if (!name) return;
  practice = true;
  const worker = new Worker(new URL('./practice-worker.js', import.meta.url), { type: 'module' });
  makeNet(() => workerTransport(worker)).connect('create', null, { map: settings.lastMap || 'desert' });
  showLobbySkeleton('SOLO');
  let added = false;
  const orig = net.h.onRoom;
  net.h.onRoom = (r) => { orig(r); if (!added && r.host === net.myId) { added = true; for (let i = 0; i < 5; i++) net.sendJSON({ t: 'addBot' }); } };
}
function toMenu() {
  if (net) { net.leave(); net = null; game.net = null; }
  room = null; practice = false; game.clearViews && game.W && game.clearViews();
  history.replaceState(null, '', location.pathname + (params.get('server') ? '?server=' + encodeURIComponent(params.get('server')) : ''));
  refreshPlayHint(); show('menu');
}
function refreshPlayHint() {
  let last = null; try { last = localStorage.getItem('trackfire-last-room'); } catch (e) {}
  $('playHint').textContent = last ? 'REJOIN ' + last : 'NEW ROOM';
}

/* ---------------- room / lobby ---------------- */
function showLobbySkeleton(code) {
  $('lbCode').textContent = code || '·····';
  $('lbPlayers').innerHTML = ''; $('lbLink').textContent = '';
  show('lobby');
}
function onRoom(r) {
  const prev = room; room = r;
  if (r.state === 'playing' && screen !== 'game') { enterGame(); }
  else if (r.state === 'lobby' && screen === 'game') { hud.hideEnd(); show('lobby'); menuWorld = getWorld(r.map); }
  else if (r.state === 'ended' && screen === 'game' && (!prev || prev.state !== 'ended')) hud.showEnd(r, net.myId);
  if (screen === 'game') { game.room = r; hud.setRoom(r, net.myId); }
  renderLobby();
}
function renderLobby() {
  if (!room || !net) return;
  const r = room, host = r.host === net.myId, me = r.players.find(p => p.id === net.myId);
  $('lbCode').textContent = practice ? 'SOLO' : r.code;
  const link = location.origin + location.pathname + '?room=' + r.code + (params.get('server') ? '&server=' + encodeURIComponent(params.get('server')) : '');
  $('lbLink').textContent = practice ? 'Practice mode — offline, only you and bots' : link;
  $('btnCopy').hidden = practice;
  for (const b of document.querySelectorAll('#lbMaps .map')) { b.setAttribute('aria-pressed', b.dataset.map === r.map ? 'true' : 'false'); b.disabled = !host; }
  for (const b of document.querySelectorAll('#lbModeSeg button')) { b.setAttribute('aria-pressed', b.dataset.mode === r.mode ? 'true' : 'false'); b.disabled = !host; }
  $('lbCount').textContent = `${r.players.length} / ${GAME.MAX_PLAYERS} PLAYERS`;
  const crown = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 5l3 3 3-5 3 5 3-3-1 8H3z"/></svg>';
  $('lbPlayers').innerHTML = r.players.map(p => `<li class="${p.id === net.myId ? 'me' : ''}"><span>${p.id === r.host ? crown : ''}</span><span class="nm">${esc(p.name)}${p.bot ? '<small>BOT</small>' : ''}${p.id === net.myId ? '<small>YOU</small>' : ''}${!p.conn ? '<small>OFFLINE</small>' : ''}</span><span class="chip ${p.team}">${p.team === 'ffa' ? 'FFA' : p.team.toUpperCase()}</span><span class="pg">${p.bot ? '' : p.ping + ' ms'}</span><span class="rd ${p.ready || p.bot ? 'y' : 'n'}">${p.ready || p.bot ? 'READY' : 'WAITING'}</span></li>`).join('');
  $('btnReady').textContent = me && me.ready ? 'NOT READY' : 'READY';
  $('btnTeam').hidden = r.mode !== 'tdm';
  for (const id of ['btnStart', 'btnAddBot', 'btnDelBot']) $(id).hidden = !host;
  $('btnStart').disabled = r.state !== 'lobby';
  if (net.status === 'online') {
    $('lbNote').textContent = r.state === 'ended' ? 'Match finished — back in a moment.' : host ? (r.players.length < 2 ? 'Send the code to your friends, or add a bot to try it out. Start when everyone is in.' : 'Start the match when everyone is in. Friends can also join mid-match.') : 'Waiting for the host to start the match…';
  }
  if (menuWorld !== getWorld(r.map) && screen === 'lobby') menuWorld = getWorld(r.map);
  settings.lastMap = r.map;
}

/* ---------------- match ---------------- */
function enterGame() {
  hud.setTouch(useTouch());
  game.startMatch(room);
  hud.setRoom(room, net.myId);
  show('game');
  game.resize();
  if (room.state === 'ended') hud.showEnd(room, net.myId);
}
function onNetEvent(ev) {
  if (ev.t === 'start') { hud.hideEnd(); return; }
  if (ev.t === 'end') return;              // room info with winner follows
  if (screen === 'game') game.onEvent(ev);
}

/* ---------------- main loop ---------------- */
let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(250, t - last); last = t;
  if (screen === 'game' && net) { game.frame(dt); return; }
  if (net) net.update(dt, () => ({ mode: 0, dir: 0, mag: 0, aim: 0, fire: false }), false); // keep pings / clock alive in lobby
  // Menu / lobby background: slow orbit over the map.
  if (!menuWorld) return;
  menuAngle += dt / 1000 * 0.045;
  camera.position.set(Math.sin(menuAngle) * 62, 40, Math.cos(menuAngle) * 62); camera.lookAt(0, 0, 0);
  menuWorld.follow(new THREE.Vector3(0, 0, 0));
  renderer.render(menuWorld.scene, camera);
}

/* ---------------- settings ---------------- */
function applyAudio() { audio.setVolumes({ master: settings.master / 100, music: settings.music / 100, sfx: settings.sfx / 100, mute: settings.mute }); }
function applyTouchMode() { hud.setTouch(useTouch()); document.body.classList.toggle('aiming', screen === 'game' && !hud.touch); $('touch').hidden = !(screen === 'game' && hud.touch); input.touch = hud.touch ? touch : null; touch.active = hud.touch; }
function syncSettingsUI() {
  for (const seg of document.querySelectorAll('#settings .seg[data-set]')) for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(settings[seg.dataset.set]) === b.dataset.v ? 'true' : 'false');
  for (const t of document.querySelectorAll('#settings .tg[data-set]')) t.setAttribute('aria-pressed', settings[t.dataset.set] ? 'true' : 'false');
  for (const r of document.querySelectorAll('#settings input[data-set]')) { r.value = settings[r.dataset.set]; r.nextElementSibling.textContent = r.value + (r.dataset.set === 'renderScale' ? '%' : ''); }
  for (const b of document.querySelectorAll('#simPing button')) b.setAttribute('aria-pressed', String(LAT_SIM.oneWay * 2) === b.dataset.v ? 'true' : 'false');
  for (const b of document.querySelectorAll('#simJit button')) b.setAttribute('aria-pressed', String(LAT_SIM.jitter) === b.dataset.v ? 'true' : 'false');
}
function settingChanged(key) {
  saveSettings();
  if (['master', 'music', 'sfx', 'mute'].includes(key)) applyAudio();
  if (key === 'controls') input.mode = settings.controls;
  if (key === 'touch') { applyTouchMode(); hud.layout(); }
  if (key === 'debug') $('debug').hidden = !settings.debug;
  if (key === 'sun') for (const W of Object.values(worlds)) W.setSun(settings.sun);
  if (['quality', 'shadows', 'particles', 'renderScale', 'sun'].includes(key) && game.W) game.applyQuality();
  if (key === 'quality') toast('Map detail changes apply to the next map you load.');
  syncSettingsUI();
}
function openSettings() { syncSettingsUI(); $('settings').hidden = false; }

/* ---------------- UI wiring ---------------- */
function click(id, fn) { $(id).addEventListener('click', (e) => { audio.unlock(); audio.play('click'); fn(e); }); }
click('btnPlay', () => { let last = null; try { last = localStorage.getItem('trackfire-last-room'); } catch (e) {} if (last) joinRoom(last); else connect('create', null); });
click('btnCreate', () => connect('create', null, { map: settings.lastMap || 'desert' }));
click('btnJoin', () => joinRoom($('codeInp').value));
click('btnPractice', startPractice);
$('codeInp').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('codeInp').value); });
$('codeInp').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('nameInp').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnPlay').click(); });
click('btnSettings', openSettings); click('btnSettings2', openSettings); click('btnSettings3', openSettings);
click('btnCloseSettings', () => { $('settings').hidden = true; });
click('btnLeave', toMenu);
click('btnReady', () => { const me = room && room.players.find(p => p.id === net.myId); net.sendJSON({ t: 'ready', v: !(me && me.ready) }); });
click('btnTeam', () => { const me = room && room.players.find(p => p.id === net.myId); if (me) net.sendJSON({ t: 'team', team: me.team === 'blue' ? 'red' : 'blue' }); });
click('btnAddBot', () => net.sendJSON({ t: 'addBot' }));
click('btnDelBot', () => net.sendJSON({ t: 'removeBot' }));
click('btnStart', () => net.sendJSON({ t: 'start' }));
click('btnCopy', async (e) => {
  const link = $('lbLink').textContent;
  try { await navigator.clipboard.writeText(link); toast('Invite link copied — send it to your friends'); }
  catch (err) { const r = document.createRange(); r.selectNodeContents($('lbLink')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Select and copy the link below the button'); }
});
for (const b of document.querySelectorAll('#lbMaps .map')) b.addEventListener('click', () => { audio.play('click'); net && net.sendJSON({ t: 'map', map: b.dataset.map }); });
for (const b of document.querySelectorAll('#lbModeSeg button')) b.addEventListener('click', () => { audio.play('click'); net && net.sendJSON({ t: 'mode', mode: b.dataset.mode }); });
// pause menu
function togglePause(on) { $('pause').hidden = !on; $('btnEndMatch').hidden = !(room && net && room.host === net.myId); input.enabled = !on; }
click('btnPause', () => togglePause(true));
click('btnResume', () => togglePause(false));
click('btnQuit', () => { togglePause(false); toMenu(); });
click('btnEndMatch', () => { net.sendJSON({ t: 'stop' }); togglePause(false); });
click('btnFullscreen', async () => {
  try { if (!document.fullscreenElement) { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); try { await window.screen.orientation.lock('landscape'); } catch (e) {} } else await document.exitFullscreen(); }
  catch (e) { toast('Fullscreen isn’t available here. On iPhone, use Share → Add to Home Screen.'); }
});
$('btnScores').addEventListener('pointerdown', (e) => { e.stopPropagation(); hud.toggleScores($('scoreboard').hidden); });
// settings controls
for (const seg of document.querySelectorAll('#settings .seg[data-set]')) seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; settings[seg.dataset.set] = b.dataset.v; settingChanged(seg.dataset.set); });
for (const t of document.querySelectorAll('#settings .tg[data-set]')) t.addEventListener('click', () => { settings[t.dataset.set] = !settings[t.dataset.set]; settingChanged(t.dataset.set); });
for (const r of document.querySelectorAll('#settings input[data-set]')) r.addEventListener('input', () => { settings[r.dataset.set] = Number(r.value); settingChanged(r.dataset.set); });
$('simPing').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; LAT_SIM.oneWay = Number(b.dataset.v) / 2; syncSettingsUI(); toast(b.dataset.v === '0' ? 'Network simulation off' : `Simulating ${b.dataset.v} ms ping`); });
$('simJit').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; LAT_SIM.jitter = Number(b.dataset.v); syncSettingsUI(); });
// keyboard shortcuts in game
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (screen !== 'game') return;
  if (e.code === 'Tab') { e.preventDefault(); hud.toggleScores(true); }
  if (e.code === 'F3') { e.preventDefault(); settings.debug = !settings.debug; $('debug').hidden = !settings.debug; saveSettings(); }
  if (e.code === 'Escape') { if (!$('settings').hidden) $('settings').hidden = true; else togglePause($('pause').hidden); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Tab' && screen === 'game') hud.toggleScores(false); });
window.addEventListener('pointerdown', () => audio && audio.unlock(), { once: false, passive: true });
$('debug').hidden = !settings.debug;
// Switch to touch UI automatically the first time someone touches the screen.
window.addEventListener('touchstart', () => { if (settings.touch === 'auto' && hud && !hud.touch) applyTouchMode(); }, { passive: true });

boot();
