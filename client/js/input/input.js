/* Controls → one raw input per tick.
   PC:     WASD / arrows = drive, mouse = aim, left click or Space = fire.
           Mode "Direction" (default): WASD is a screen direction and the
           tank turns toward it. Mode "Classic": W/S throttle, A/D rotate.
   Mobile: see touch.js (left stick drive, right stick aim, FIRE button). */
import { MODE_DIR, MODE_CLASSIC } from '../../shared/sim.js';

export class Input {
  constructor(el) {
    this.el = el; this.keys = new Set(); this.mouse = { x: 0, y: 0, in: false, down: false };
    this.aimWorld = null;            // {x, z} ground point under cursor (set by game)
    this.touch = null;               // TouchControls when on mobile
    this.mode = 'dir';
    this.lastAim = 0; this.enabled = true;
    this.onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (e.type === 'keydown') {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(k)) e.preventDefault();
        this.keys.add(k);
      } else this.keys.delete(k);
    };
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    el.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.in = true; });
    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; if (e.button === 0) this.mouse.down = true; this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.in = true; });
    window.addEventListener('pointerup', (e) => { if (e.button === 0) this.mouse.down = false; });
    el.addEventListener('pointerleave', () => { this.mouse.in = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  key(...codes) { return codes.some(c => this.keys.has(c)); }
  /** me = predicted local tank state */
  get(me) {
    if (!this.enabled) return { mode: MODE_DIR, dir: 0, mag: 0, aim: me.t, fire: false };
    if (this.touch && this.touch.active) {
      const t = this.touch;
      if (t.aimMag > 0.25) this.lastAim = t.aimAngle; else if (!t.everAimed) this.lastAim = me.yaw;
      return { mode: MODE_DIR, dir: t.moveAngle, mag: t.moveMag, aim: this.lastAim, fire: t.fire };
    }
    let aim = this.lastAim;
    if (this.aimWorld) { aim = Math.atan2(this.aimWorld.x - me.x, this.aimWorld.z - me.z); this.lastAim = aim; }
    const fire = this.mouse.down || this.key('Space');
    const up = this.key('KeyW', 'ArrowUp'), dn = this.key('KeyS', 'ArrowDown'), lf = this.key('KeyA', 'ArrowLeft'), rt = this.key('KeyD', 'ArrowRight');
    if (this.mode === 'classic') {
      return { mode: MODE_CLASSIC, throttle: (up ? 1 : 0) - (dn ? 1 : 0), steer: (lf ? 1 : 0) - (rt ? 1 : 0), aim, fire };
    }
    // Screen-relative: camera looks north (−z), so screen up = −z, right = +x.
    const x = (rt ? 1 : 0) - (lf ? 1 : 0), z = (dn ? 1 : 0) - (up ? 1 : 0);
    const mag = x || z ? 1 : 0;
    return { mode: MODE_DIR, dir: Math.atan2(x, z), mag, aim, fire };
  }
}
