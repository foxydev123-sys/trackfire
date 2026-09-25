/* =====================================================================
   Game — one match on screen. Runs every rendered frame:
     net.update()  → fixed-rate inputs + prediction, render clock, due events
     local tank    → predicted pose (instant response)
     remote tanks  → interpolated poses (smooth at any frame rate)
     shells / fx / camera / HUD / audio
   ===================================================================== */
import * as THREE from '../three.js';
import { TankView, TEAM_COLORS, TEAM_ACCENT, FFA_COLORS } from './tank.js';
import { FX } from './fx.js';
import { Shells } from './shells.js';
import { CAMERA, QUALITY, settings } from '../settings.js';
import { GAME } from '../../shared/config.js';
import { dist, clamp, lerp } from '../../shared/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Game {
  constructor({ renderer, camera, net, hud, input, audio, getWorld }) {
    Object.assign(this, { renderer, camera, net, hud, input, audio, getWorld });
    this.views = new Map(); this.W = null; this.camT = new THREE.Vector3(); this.shake = 0;
    this.recent = []; this.deadInfo = null; this.room = null; this.lastMe = { x: 0, z: 0, yaw: 0 };
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); this.ndc = new THREE.Vector2();
    this.perf = { frames: 0, acc: 0, fps: 60, ms: 16.7, low: 0, high: 0 }; this.resScale = settings.renderScale / 100;
    this.aimLine = null; this.scoresHeld = false;
  }

  /* ---------------- setup ---------------- */
  useMap(mapId) {
    const W = this.getWorld(mapId);
    if (this.W === W) return;
    this.clearViews();
    if (this.aimLine && this.W) { this.W.scene.remove(this.aimLine, this.aimDot); }
    this.W = W;
    if (!W.fx) { W.fx = new FX(W.scene, W.map.env.dust); W.shells = new Shells(W.scene); }
    W.shells.clear();
    if (!this.aimLine) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
      this.aimLine = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.7, gapSize: 0.5, transparent: true, opacity: 0.55 }));
      this.aimLine.frustumCulled = false;
      this.aimDot = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
      this.aimDot.rotation.x = -Math.PI / 2;
    }
    W.scene.add(this.aimLine, this.aimDot);
    this.applyQuality();
  }
  applyQuality() {
    const Q = QUALITY[settings.quality] || QUALITY.medium;
    const shadows = Q.shadows && settings.shadows;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      if (this.W) this.W.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
    }
    this.renderer.shadowMap.type = settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.W) {
      const ms = Q.shadowMap; const sh = this.W.sun.shadow;
      if (sh.mapSize.x !== ms) { sh.mapSize.set(ms, ms); if (sh.map) { sh.map.dispose(); sh.map = null; } }
      this.W.fx.budget = settings.particles === 'low' ? Math.min(0.45, Q.particles) : Q.particles;
      this.W.setSun(settings.sun);
    }
    this.resScale = settings.renderScale / 100;
    this.resize();
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const Q = QUALITY[settings.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(dpr, Q.pixelRatio) * this.resScale));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
    this.hud.layout();
  }
  clearViews() { for (const v of this.views.values()) v.dispose(); this.views.clear(); this.hud.pruneTags(new Set()); }

  startMatch(room) {
    this.room = room; this.useMap(room.map); this.clearViews();
    this.deadInfo = null; this.recent = []; this.W.shells.clear(); this.hud.feed = []; this.hud.renderFeed(); this.hud.hideEnd();
    this.keysShownAt = performance.now();
    this.camT.set(0, 0, 0); if (this.net && this.net.meAlive) this.lastMe = { ...this.net.me };
  }

  playerInfo(id) { return this.room ? this.room.players.find(p => p.id === id) : null; }
  viewFor(id) {
    const info = this.playerInfo(id);
    const team = info ? info.team : 'ffa';
    const key = this.room && this.room.mode === 'ffa' ? 'ffa' + (id % 8) : team;
    let v = this.views.get(id);
    if (v && v.key === key) return v;
    if (v) v.dispose();
    const col = key.startsWith('ffa') ? FFA_COLORS[id % 8] : TEAM_COLORS[team] || 0x777777;
    const acc = key.startsWith('ffa') ? 0xffffff : TEAM_ACCENT[team] || 0xffffff;
    v = new TankView(this.W.scene, col, acc, id === this.net.myId); v.key = key;
    this.views.set(id, v); return v;
  }
  groundY(x, z) {
    const M = this.W.map; const h = M.height(x, z);
    const b = M.bridge; if (b && x > b.x0 - 0.5 && x < b.x1 + 0.5 && Math.abs(z - b.zc) < b.halfW + 1) return Math.max(h, 0.45);
    return h;
  }
  isAlly(id) { const me = this.playerInfo(this.net.myId), p = this.playerInfo(id); return !!(me && p && p.team !== 'ffa' && p.team === me.team); }

  /* ---------------- events ---------------- */
  // Called immediately when the message arrives (own shots, things that hit US).
  onEvent(ev) {
    const me = this.net.myId, W = this.W; if (!W) return;
    if (ev.t === 'shot' && ev.own) {
      const s = W.shells.bySeq(ev.seq);
      if (s) s.id = ev.id;
      else { W.shells.spawn({ x: ev.x, z: ev.z, a: ev.a, y: this.groundY(ev.x, ev.z) + 1.5, id: ev.id, own: true, owner: me }); }
    } else if (ev.t === 'hit' && ev.now) {
      if (ev.o === me) {
        const s = W.shells.byId(ev.s); if (s) W.shells.remove(s);
        this.impact(ev.x, ev.z, ev.v && ev.dmg === 0);
        if (ev.v && ev.dmg > 0) {
          this.hud.hitMarker(); this.audio.play('hitmark');
          const p = this.project(ev.x, this.groundY(ev.x, ev.z) + 2.5, ev.z); if (p) this.hud.damageNumber(p.x, p.y, ev.dmg);
        }
      }
      if (ev.v === me && ev.dmg > 0) { this.hud.flash(); this.addShake(0.5); this.audio.play('hurt'); }
    } else if (ev.t === 'kill' && ev.now && ev.v === me) {
      const v = this.views.get(me);
      const p = v ? v.root.position : _v.set(this.lastMe.x, this.groundY(this.lastMe.x, this.lastMe.z), this.lastMe.z);
      W.fx.explode(_v2.set(p.x, p.y + 1.2, p.z), true); this.audio.play('explosion', null, 1.1); this.addShake(1);
      if (v) v.setVisible(false);
      const k = this.playerInfo(ev.k);
      this.deadInfo = { killer: k ? (k.id === me ? 'YOURSELF' : k.name) : '?', until: performance.now() + GAME.RESPAWN_S * 1000 };
      this.hud.kill(k, this.playerInfo(ev.v));
    } else if (ev.t === 'spawn' && ev.id === me) {
      this.deadInfo = null; this.audio.play('spawn');
      this.camT.set(ev.x, this.groundY(ev.x, ev.z), ev.z);
    } else if (ev.t === 'left') {
      const v = this.views.get(ev.id); if (v) { v.dispose(); this.views.delete(ev.id); }
    }
  }
  // Called when the render timeline reaches the event's server time (matches what you see).
  onScheduled(ev) {
    const me = this.net.myId, W = this.W;
    if (ev.t === 'shot') {
      const y = this.groundY(ev.x, ev.z) + 1.5;
      W.shells.spawn({ x: ev.x, z: ev.z, a: ev.a, y, id: ev.id, owner: ev.o });
      W.fx.muzzle(_v.set(ev.x, y, ev.z), _v2.set(Math.sin(ev.a), 0, Math.cos(ev.a)));
      const v = this.views.get(ev.o); if (v) v.recoil = 1;
      this.audio.play('cannon', { x: ev.x, z: ev.z }, 0.9);
    } else if (ev.t === 'hit') {
      if (ev.o === me) return;                        // our own shells were handled instantly
      const s = W.shells.byId(ev.s); if (s) W.shells.remove(s);
      this.impact(ev.x, ev.z, ev.v && ev.dmg === 0);
    } else if (ev.t === 'kill') {
      if (ev.v === me) return;
      const v = this.views.get(ev.v);
      if (v) { const p = v.root.position; W.fx.explode(_v.set(p.x, p.y + 1.2, p.z), true); this.audio.play('explosion', { x: p.x, z: p.z }); if (dist(p.x, p.z, this.lastMe.x, this.lastMe.z) < 25) this.addShake(0.35); v.setVisible(false); }
      this.hud.kill(this.playerInfo(ev.k), this.playerInfo(ev.v));
    }
  }
  impact(x, z, deflect) {
    const now = performance.now();
    this.recent = this.recent.filter(r => now - r.t < 900);
    if (this.recent.some(r => dist(r.x, r.z, x, z) < 3.5)) return;   // already exploded locally
    this.recent.push({ x, z, t: now });
    const y = this.groundY(x, z) + 1.2;
    if (deflect) { this.W.fx.deflect(_v.set(x, y, z)); this.audio.play('deflect', { x, z }); }
    else { this.W.fx.explode(_v.set(x, y, z), false); this.audio.play('impact', { x, z }, 0.8); }
  }
  addShake(a) { if (settings.shake) this.shake = Math.max(this.shake, a); }
  project(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    if (_v.z > 1) return null;
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight, on: Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 };
  }

  /* ---------------- per-frame ---------------- */
  frame(dtMs) {
    const dt = Math.min(0.1, dtMs / 1000), net = this.net, W = this.W, me = net.myId;
    if (!W) return;
    this.t = (this.t || 0) + dt;
    const playing = !!(this.room && this.room.state === 'playing');
    // Mouse → ground point for aiming (desktop)
    if (!this.hud.touch && this.input.mouse.in) {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.ndc.set((this.input.mouse.x - r.left) / r.width * 2 - 1, -(this.input.mouse.y - r.top) / r.height * 2 + 1);
      this.ray.setFromCamera(this.ndc, this.camera);
      this.plane.constant = -(this.groundY(this.lastMe.x, this.lastMe.z) + 1);
      if (this.ray.ray.intersectPlane(this.plane, _v)) this.input.aimWorld = { x: _v.x, z: _v.z };
    }
    const r = net.update(dtMs, (s) => this.input.get(s), playing);

    // predicted own shots → instant shell, flash, sound
    const myView = net.meAlive ? this.viewFor(me) : this.views.get(me);
    for (const f of r.fired) {
      const y = this.groundY(f.x, f.z) + 1.5;
      W.shells.spawn({ x: f.x, z: f.z, a: f.a, y, own: true, seq: f.seq, owner: me });
      W.fx.muzzle(_v.set(f.x, y, f.z), _v2.set(Math.sin(f.a), 0, Math.cos(f.a)));
      if (myView) myView.recoil = 1;
      this.audio.play('cannon', null, 1); this.addShake(0.22);
      this.reloadSoundAt = performance.now() + GAME.RELOAD_S * 1000 - 250;
    }
    if (this.reloadSoundAt && performance.now() > this.reloadSoundAt) { this.reloadSoundAt = 0; if (net.meAlive) this.audio.play('reload', null, 0.8); }
    for (const ev of r.due) this.onScheduled(ev);

    // ---- local tank
    let mePose = null;
    if (net.meAlive && playing) {
      mePose = net.localPose(r.alpha);
      myView.setVisible(true);
      myView.setPose(mePose.x, mePose.z, mePose.yaw, mePose.t, (x, z) => this.groundY(x, z), dt, mePose.v);
      myView.setShield(mePose.shield > 0, this.t);
      this.lastMe = mePose;
      this.dust(myView, mePose.v, dt);
    } else if (myView) myView.setVisible(false);

    // ---- remote tanks (interpolated)
    const live = new Set([me]); const remotes = []; const mm = [];
    for (const id of net.remoteIds()) {
      live.add(id);
      const p = net.remotePose(id); const v = this.viewFor(id);
      const info = this.playerInfo(id);
      if (!p || !p.alive || !playing) { v.setVisible(false); this.hud.tag(id, '', false, 0, 0, 0, false); continue; }
      v.setVisible(true);
      v.setPose(p.x, p.z, p.yaw, p.t, (x, z) => this.groundY(x, z), dt, p.v);
      v.setShield(p.shield > 0, this.t);
      this.dust(v, p.v, dt);
      remotes.push({ id, x: p.x, z: p.z });
      const ally = this.isAlly(id);
      mm.push({ x: p.x, z: p.z, ally });
      const sp = this.project(p.x, v.root.position.y + 3.4, p.z);
      this.hud.tag(id, info ? info.name : '…', ally, sp ? sp.x : 0, sp ? sp.y : 0, p.hp, !!(sp && sp.on));
    }
    for (const [id, v] of this.views) if (!live.has(id)) { v.dispose(); this.views.delete(id); }
    this.hud.pruneTags(live);

    // ---- shells + particles
    W.shells.update(dt, W.map, remotes, (s, x, z, hit) => { if (s.own || hit) this.impact(x, z, false); });
    W.fx.update(dt);

    // ---- aim line (where the turret actually points)
    const showAim = !!mePose;
    this.aimLine.visible = this.aimDot.visible = showAim;
    if (showAim) {
      myView.muzzleWorld(_v);
      let d = GAME.SHELL_RANGE * 0.6;
      if (!this.hud.touch && this.input.aimWorld) d = Math.min(GAME.SHELL_RANGE, Math.max(4, dist(this.input.aimWorld.x, this.input.aimWorld.z, mePose.x, mePose.z) - 3.4));
      const ex = _v.x + Math.sin(mePose.t) * d, ez = _v.z + Math.cos(mePose.t) * d, gy = this.groundY(ex, ez) + 0.15;
      const a = this.aimLine.geometry.attributes.position; a.setXYZ(0, _v.x, _v.y, _v.z); a.setXYZ(1, ex, gy, ez); a.needsUpdate = true;
      this.aimLine.computeLineDistances(); this.aimDot.position.set(ex, gy - 0.03, ez);
    }

    // ---- camera: smooth follow with a little look-ahead toward the aim
    const focus = mePose || this.lastMe;
    let lx = 0, lz = 0;
    if (mePose) {
      if (!this.hud.touch && this.input.aimWorld) { lx = (this.input.aimWorld.x - focus.x) * CAMERA.LOOK_AHEAD; lz = (this.input.aimWorld.z - focus.z) * CAMERA.LOOK_AHEAD; }
      else { lx = Math.sin(focus.t) * 3; lz = Math.cos(focus.t) * 3; }
      const L = Math.hypot(lx, lz); if (L > CAMERA.LOOK_AHEAD_MAX) { lx *= CAMERA.LOOK_AHEAD_MAX / L; lz *= CAMERA.LOOK_AHEAD_MAX / L; }
    }
    const fy = this.groundY(focus.x, focus.z);
    if (this.camT.lengthSq() === 0) this.camT.set(focus.x, fy, focus.z);
    this.camT.lerp(_v.set(focus.x + lx, fy, focus.z + lz), 1 - Math.exp(-CAMERA.FOLLOW * dt));
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.5; const pr = CAMERA.PITCH_DEG * Math.PI / 180;
    this.camera.position.set(this.camT.x + (Math.random() - 0.5) * sh, this.camT.y + Math.sin(pr) * CAMERA.DIST + (Math.random() - 0.5) * sh, this.camT.z + Math.cos(pr) * CAMERA.DIST);
    this.camera.lookAt(this.camT);
    W.follow(this.camT);
    this.renderer.render(W.scene, this.camera);

    // ---- audio
    this.audio.listener = { x: focus.x, z: focus.z };
    this.audio.engine(mePose ? Math.abs(mePose.v) / GAME.MAX_SPEED : 0, !!mePose);

    // ---- HUD
    this.perfTick(dtMs);
    if (this.deadInfo) this.deadInfo.left = (this.deadInfo.until - performance.now()) / 1000;
    if (this.keysShownAt && performance.now() - this.keysShownAt > 20000) { document.getElementById('keys').style.opacity = 0; this.keysShownAt = 0; }
    const st = mePose || net.me;
    this.hud.frame({
      dt, alive: !!mePose, hp: net.meHp, reload: st.reload || 0, playing, deadInfo: this.deadInfo,
      crosshair: this.input.mouse.in ? { x: this.input.mouse.x, y: this.input.mouse.y } : null,
      net, fps: this.perf.fps, frameMs: this.perf.ms, quality: settings.quality,
      res: this.renderer.domElement.width + '×' + this.renderer.domElement.height,
    });
    this.mmT = (this.mmT || 0) - dt;
    if (this.mmT <= 0) { this.mmT = 0.1; this.hud.minimap(W.minimap, mePose || this.lastMe, mm); }
  }
  dust(v, speed, dt) {
    v.dustT -= dt;
    if (Math.abs(speed) > 1.2 && v.dustT <= 0) {
      v.dustT = 0.07; const yaw = v.root.rotation.y, s = Math.random() < 0.5 ? -1 : 1, p = v.root.position;
      this.W.fx.dust(_v.set(p.x - Math.sin(yaw) * 1.9 * Math.sign(speed) + Math.cos(yaw) * s * 1.05, p.y + 0.25, p.z - Math.cos(yaw) * 1.9 * Math.sign(speed) - Math.sin(yaw) * s * 1.05));
    }
  }
  // FPS meter + automatic resolution scaling to hold frame rate on phones.
  perfTick(dtMs) {
    const P = this.perf; P.frames++; P.acc += dtMs;
    if (P.acc < 500) return;
    P.fps = P.frames / (P.acc / 1000); P.ms = P.acc / P.frames; P.frames = 0; P.acc = 0;
    if (!settings.autoRes || document.hidden) return;
    if (P.fps < 48) { P.low++; P.high = 0; } else if (P.fps > 58) { P.high++; P.low = 0; } else { P.low = 0; P.high = 0; }
    const max = settings.renderScale / 100;
    if (P.low >= 4 && this.resScale > 0.55) { this.resScale = Math.max(0.55, this.resScale - 0.1); P.low = 0; this.resize(); }
    else if (P.high >= 10 && this.resScale < max) { this.resScale = Math.min(max, this.resScale + 0.05); P.high = 0; this.resize(); }
  }
}
