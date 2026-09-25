/* In-game HUD: health, reload, crosshair, name tags, kill feed, scores,
   minimap, debug panel, death and end-of-match cards. Pure DOM. */
import { GAME, NET } from '../../shared/config.js';
import { clamp } from '../../shared/math.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SHELL_SVG = '<svg viewBox="0 0 22 10"><path d="M0 3h13l6 2-6 2H0z" fill="#f1c56a"/><path d="M0 3h4v4H0z" fill="#9a6a24"/></svg>';

export class HUD {
  constructor() {
    this.wrap = $('hud'); this.vl = $('hudVL'); this.ov = $('ov');
    this.feed = []; this.tags = new Map(); this.lastHp = 100; this.slowT = 0; this.touch = false;
    this.xh = document.createElement('div'); this.xh.className = 'xh';
    this.xh.innerHTML = '<svg viewBox="-26 -26 52 52"><circle r="15" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="4"/><circle r="15" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>' +
      '<circle class="arc" r="15" fill="none" stroke="#fff" stroke-width="2.4" stroke-dasharray="94.25" stroke-dashoffset="0" transform="rotate(-90)" stroke-linecap="round"/>' +
      '<g stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M0 -22v-4M0 22v4M-22 0h-4M22 0h4"/></g><circle r="1.8" fill="#fff"/>' +
      '<g class="hitx" stroke="#ff5a4a" stroke-width="2.6" stroke-linecap="round"><path d="M-9 -9l-5 -5M9 -9l5 -5M-9 9l-5 5M9 9l5 5"/></g></svg>';
    this.xhArc = this.xh.querySelector('.arc');
    this.ov.appendChild(this.xh);
    this.perfHist = [];
  }
  show(on) { this.wrap.hidden = !on; this.ov.hidden = !on; }
  layout() {
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight; if (!W || !H) return;
    const baseH = this.touch ? 520 : 720, minW = this.touch ? 860 : 1100;
    let s = H / baseH; if (W / s < minW) s = W / minW;
    s = clamp(s, 0.45, 2.2);
    this.vl.style.width = W / s + 'px'; this.vl.style.height = H / s + 'px'; this.vl.style.transform = `scale(${s})`;
    this.scale = s;
    const t = $('touch'); t.style.setProperty('--ts', clamp(Math.min(window.innerWidth, window.innerHeight) / 390, 0.75, 1.3).toFixed(3));
    this.tagFont = clamp(window.innerWidth / 105, 9, 13);
    this.ov.style.setProperty('--tf', this.tagFont + 'px');
  }
  setTouch(on) { this.touch = on; document.body.classList.toggle('touchui', on); $('touch').hidden = !on; this.layout(); }

  /* ---------- room / scores ---------- */
  setRoom(room, myId) {
    this.room = room; this.myId = myId;
    const me = room.players.find(p => p.id === myId);
    this.me = me;
    const ffa = room.mode === 'ffa';
    $('hhName').textContent = me ? me.name : 'You';
    $('hhSub').textContent = ffa ? 'FREE FOR ALL' : (me ? me.team.toUpperCase() + ' TEAM' : '');
    $('modeLbl').textContent = (ffa ? 'FREE FOR ALL' : 'TEAM DEATHMATCH') + ' · TO ' + room.limit;
    $('roomTxt').textContent = 'ROOM ' + room.code;
    if (ffa) {
      const sorted = [...room.players].sort((a, b) => b.k - a.k);
      const lead = sorted[0], mine = me || { k: 0 };
      $('sBlueLbl').textContent = 'YOU'; $('sBlue').textContent = mine.k;
      $('sRedLbl').textContent = 'LEADER'; $('sRed').textContent = lead ? lead.k : 0;
    } else {
      const ts = (t) => room.players.filter(p => p.team === t).reduce((a, p) => a + p.k, 0);
      $('sBlueLbl').textContent = 'BLUE'; $('sRedLbl').textContent = 'RED';
      $('sBlue').textContent = ts('blue'); $('sRed').textContent = ts('red');
    }
    this.clockBase = { left: room.timeLeft, at: performance.now() };
    this.renderBoards();
  }
  isAlly(p) { const me = this.me; if (!me || !p) return false; if (p.id === me.id) return true; return p.team !== 'ffa' && p.team === me.team; }
  renderBoards() {
    const r = this.room; if (!r) return;
    const rows = [...r.players].sort((a, b) => b.k - a.k || a.d - b.d);
    const col = (p) => p.team === 'blue' ? 'var(--blue)' : p.team === 'red' ? 'var(--red)' : (this.isAlly(p) ? 'var(--acc)' : '#ccc');
    $('miniboard').innerHTML = '<div class="row hd"><span></span><span>PLAYER</span><span class="k">K</span><span class="d">D</span></div>' +
      rows.slice(0, 8).map(p => `<div class="row${p.id === this.myId ? ' me' : ''}"><span class="sw" style="background:${col(p)}"></span><span class="n">${esc(p.name)}</span><span class="k">${p.k}</span><span class="d">${p.d}</span></div>`).join('');
    $('scoreboard').innerHTML = `<h3>SCOREBOARD <small>ROOM ${esc(r.code)} · ${r.map === 'forest' ? 'PINEWOOD FORD' : 'DUNE CROSSING'}</small></h3>` + this.gridHTML(r);
  }
  gridHTML(r) {
    let h = '<div class="sb-grid"><div class="h">PLAYER</div><div class="h num">KILLS</div><div class="h num">DEATHS</div><div class="h num">SCORE</div><div class="h num">PING</div>';
    const groups = r.mode === 'ffa' ? [['ffa', 'ALL PLAYERS']] : [['blue', 'BLUE TEAM'], ['red', 'RED TEAM']];
    for (const [t, label] of groups) {
      const ps = r.players.filter(p => p.team === t).sort((a, b) => b.k - a.k || a.d - b.d);
      const sum = ps.reduce((a, p) => a + p.k, 0);
      h += `<div class="tb ${t}">${label}${r.mode === 'ffa' ? '' : ' · ' + sum}</div>`;
      for (const p of ps) {
        const c = (p.id === this.myId ? ' me' : '') + (p.conn ? '' : ' off');
        h += `<div class="${c.trim()}">${esc(p.name)}${p.bot ? ' <small style="opacity:.6">BOT</small>' : ''}</div><div class="num${c}">${p.k}</div><div class="num${c}">${p.d}</div><div class="num${c}">${p.k * 100 + Math.max(0, p.k - p.d) * 25}</div><div class="num${c}">${p.bot ? '–' : p.ping}</div>`;
      }
    }
    return h + '</div>';
  }
  toggleScores(on) { $('scoreboard').hidden = !on; }

  /* ---------- kill feed ---------- */
  kill(killer, victim) {
    if (!killer || !victim) return;
    this.feed.unshift({ k: killer, v: victim, t: performance.now() });
    if (this.feed.length > 5) this.feed.pop();
    this.renderFeed();
  }
  renderFeed() {
    const cls = (p) => (p.team === 'blue' ? 'b' : p.team === 'red' ? 'r' : (this.isAlly(p) ? 'b' : 'r')) + (p.id === this.myId ? ' me' : '');
    $('killfeed').innerHTML = this.feed.map(f => `<div class="kf pnl"><span class="${cls(f.k)}">${esc(f.k.name)}</span>${SHELL_SVG}<span class="${cls(f.v)}">${esc(f.v.name)}</span></div>`).join('');
  }

  /* ---------- per-frame ---------- */
  frame(st) {
    const hp = st.alive ? clamp(st.hp, 0, 100) : 0;
    const col = hp > 60 ? 'var(--ok)' : hp > 30 ? 'var(--warn)' : 'var(--bad)';
    const bar = $('hpBar'); bar.style.width = hp + '%'; bar.style.background = col;
    if (hp !== this.lastHp) { $('hpLag').style.width = hp + '%'; this.lastHp = hp; $('hpNum').textContent = Math.round(hp); }
    const k = st.alive ? 1 - st.reload / GAME.RELOAD_S : 0, ready = st.alive && st.reload <= 0;
    $('rlBar').style.width = (k * 100).toFixed(1) + '%'; $('rlBar').className = ready ? '' : 'busy';
    const lbl = $('rlLabel'); const txt = !st.alive ? 'WAITING' : ready ? 'READY' : 'RELOADING'; if (lbl.textContent !== txt) { lbl.textContent = txt; lbl.className = ready ? 'ready' : 'busy'; }
    $('rlTime').textContent = !st.alive ? '' : ready ? GAME.RELOAD_S.toFixed(1) + ' s reload' : st.reload.toFixed(1) + ' s';
    $('fireRing').setAttribute('stroke-dashoffset', (439.8 * (1 - k)).toFixed(1)); $('fireBtn').classList.toggle('cool', !ready);
    // crosshair
    const showX = st.crosshair && st.alive && !this.touch;
    this.xh.style.display = showX ? '' : 'none';
    if (showX) {
      this.xh.style.transform = `translate(${st.crosshair.x}px,${st.crosshair.y}px)`;
      this.xhArc.setAttribute('stroke-dashoffset', (94.25 * (1 - k)).toFixed(1)); this.xhArc.setAttribute('stroke', ready ? '#fff' : '#ffb347');
    }
    // death card
    $('deathcard').hidden = st.alive || !st.playing || !st.deadInfo;
    if (!st.alive && st.deadInfo) { $('dcKiller').textContent = st.deadInfo.killer; $('dcTime').textContent = Math.max(1, Math.ceil(st.deadInfo.left)); }
    // slow parts (5×/s)
    this.slowT -= st.dt;
    if (this.slowT <= 0) {
      this.slowT = 0.2;
      const ping = Math.round(st.net.st.rttAvg);
      $('pingTxt').textContent = ping + ' ms';
      $('netDot').style.color = $('netDot').style.background = ping < 80 ? 'var(--ok)' : ping < 160 ? 'var(--warn)' : 'var(--bad)';
      if (this.clockBase) {
        const left = Math.max(0, this.clockBase.left - (performance.now() - this.clockBase.at) / 1000);
        $('clock').textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(Math.floor(left % 60)).padStart(2, '0');
      }
      const now = performance.now(); const before = this.feed.length;
      this.feed = this.feed.filter(f => now - f.t < 9000); if (this.feed.length !== before) this.renderFeed();
      $('connBar').hidden = st.net.status === 'online';
      $('connBar').textContent = st.net.status === 'offline' ? 'DISCONNECTED' : 'RECONNECTING…';
      if (!$('debug').hidden) this.debug(st);
    }
  }
  debug(st) {
    const n = st.net, s = n.st;
    const rows = [
      ['FPS', st.fps.toFixed(0) + ' · ' + st.frameMs.toFixed(1) + ' ms'],
      ['Render', `${st.res} · ${st.quality}`],
      ['Ping (RTT)', Math.round(s.rttAvg) + ' ms'],
      ['Server tick', (n.serverTick || NET.TICK_RATE) + ' Hz'],
      ['Snapshots in', s.snapsPS.toFixed(0) + ' /s'],
      ['Snapshot age', Math.max(0, s.snapAge).toFixed(0) + ' ms'],
      ['Interp. delay', Math.round(n.interpDelay) + ' ms'],
      ['Buffered snaps', String(s.bufferDepth), s.bufferDepth < 1],
      ['Jitter', s.jitter.toFixed(0) + ' ms', s.jitter > 40],
      ['Corrections', s.corrections + ' (last ' + s.corrLast.toFixed(2) + ' m)'],
      ['Down / up', (s.bytesInPS / 1024).toFixed(1) + ' / ' + (s.bytesOutPS / 1024).toFixed(1) + ' KB/s'],
      ['Room · players', (n.code || '-') + ' · ' + (this.room ? this.room.players.length : 0) + '/' + GAME.MAX_PLAYERS],
    ];
    if (n.mapMismatch) rows.push(['Map check', 'MISMATCH', true]);
    $('dbgRows').innerHTML = rows.map(r => `<div class="r"><span>${r[0]}</span><b class="${r[2] ? 'warn' : ''}">${r[1]}</b></div>`).join('');
    this.perfHist.push(st.frameMs); if (this.perfHist.length > 54) this.perfHist.shift();
    const c = $('spark').getContext('2d'); c.clearRect(0, 0, 216, 26);
    c.strokeStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.moveTo(0, 26 - 16.7 / 40 * 24); c.lineTo(216, 26 - 16.7 / 40 * 24); c.stroke();
    c.strokeStyle = '#8fd16a'; c.lineWidth = 1.5; c.beginPath();
    this.perfHist.forEach((v, i) => { const y = 26 - clamp(v / 40, 0, 1) * 24; i ? c.lineTo(i * 4, y) : c.moveTo(0, y); }); c.stroke();
  }

  /* ---------- name tags ---------- */
  tag(id, name, ally, x, y, hp, visible) {
    let e = this.tags.get(id);
    if (!e) { e = document.createElement('div'); e.innerHTML = '<span></span><i><b></b></i>'; this.ov.appendChild(e); this.tags.set(id, e); e._n = ''; e._a = null; }
    if (!visible) { if (e.style.display !== 'none') e.style.display = 'none'; return; }
    if (e._n !== name) { e.firstChild.textContent = name; e._n = name; }
    if (e._a !== ally) { e.className = 'tag ' + (ally ? 'ally' : 'enemy'); e._a = ally; }
    e.style.display = '';
    e.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
    const w = clamp(hp, 0, 100) + '%'; const b = e.lastChild.firstChild; if (b.style.width !== w) b.style.width = w;
  }
  pruneTags(ids) { for (const [id, e] of this.tags) if (!ids.has(id)) { e.remove(); this.tags.delete(id); } }
  hitMarker() { this.xh.classList.add('hit'); clearTimeout(this._hm); this._hm = setTimeout(() => this.xh.classList.remove('hit'), 220); }
  damageNumber(x, y, n) {
    const d = document.createElement('div'); d.className = 'dmgnum'; d.textContent = '-' + n; d.style.transform = `translate(${x}px,${y}px)`;
    this.ov.appendChild(d); setTimeout(() => d.remove(), 950);
  }
  flash() { const e = $('vign'); e.style.transition = 'none'; e.style.opacity = 1; requestAnimationFrame(() => { e.style.transition = 'opacity .7s'; e.style.opacity = 0; }); }

  /* ---------- minimap ---------- */
  minimap(img, me, others) {
    const cv = $('mm'); const x = cv.getContext('2d'); const s = cv.width; x.clearRect(0, 0, s, s);
    if (!img || !me) return;
    const span = 90, O = 75, k = 2;
    x.drawImage(img, (me.x - span / 2 + O) * k, (me.z - span / 2 + O) * k, span * k, span * k, 0, 0, s, s);
    const to = (px, pz) => [(px - me.x + span / 2) / span * s, (pz - me.z + span / 2) / span * s];
    for (const o of others) {
      const [a, b] = to(o.x, o.z); if (a < -5 || b < -5 || a > s + 5 || b > s + 5) continue;
      x.fillStyle = o.ally ? '#62a2ff' : '#ff6250'; x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 2;
      x.beginPath(); x.arc(a, b, s * 0.028, 0, Math.PI * 2); x.fill(); x.stroke();
    }
    const [a, b] = to(me.x, me.z);
    x.save(); x.translate(a, b); x.rotate(-me.yaw + Math.PI); x.fillStyle = '#ffc466'; x.strokeStyle = '#000'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -s * 0.05); x.lineTo(s * 0.033, s * 0.035); x.lineTo(0, s * 0.018); x.lineTo(-s * 0.033, s * 0.035); x.closePath(); x.fill(); x.stroke(); x.restore();
  }

  /* ---------- end of match ---------- */
  showEnd(room, myId) {
    const e = $('endcard'); const me = room.players.find(p => p.id === myId);
    let title = 'MATCH OVER';
    const w = room.winner;
    if (w === 'draw') title = 'DRAW';
    else if (w === 'blue' || w === 'red') title = (me && me.team === w) ? 'VICTORY' : 'DEFEAT';
    else if (typeof w === 'number') { const p = room.players.find(x => x.id === w); title = p ? (p.id === myId ? 'YOU WIN' : esc(p.name) + ' WINS') : 'MATCH OVER'; }
    e.innerHTML = `<div class="big">${title}</div><p>${w === 'blue' || w === 'red' ? w.toUpperCase() + ' TEAM WINS · ' : ''}BACK TO THE LOBBY IN <span id="endT">${GAME.END_SCREEN_S}</span> S</p>` + this.gridHTML(room);
    e.hidden = false; this.endAt = performance.now() + GAME.END_SCREEN_S * 1000;
    clearInterval(this._endI); this._endI = setInterval(() => { const t = $('endT'); if (t) t.textContent = Math.max(0, Math.ceil((this.endAt - performance.now()) / 1000)); }, 250);
  }
  hideEnd() { $('endcard').hidden = true; clearInterval(this._endI); }
}
