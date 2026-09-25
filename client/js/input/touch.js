/* Touch controls built for thumbs (not an emulated mouse):
   - Left half: floating MOVE stick (appears where your thumb lands).
   - Right side: floating AIM stick; turret points where you push.
   - FIRE button: hold to keep firing whenever the gun is loaded.
   Multi-touch safe: each finger is tracked by its pointer id. */
export class TouchControls {
  constructor(root, els) {
    this.root = root; this.els = els; // {moveBase, moveKnob, aimBase, aimKnob, fire}
    this.active = false; this.moveAngle = 0; this.moveMag = 0; this.aimAngle = 0; this.aimMag = 0; this.fire = false; this.everAimed = false;
    this.ptr = { move: null, aim: null, fire: null };
    this.R = 70; // stick radius in CSS px (before HUD scale)
    const down = (e) => this.down(e), move = (e) => this.move(e), up = (e) => this.up(e);
    root.addEventListener('pointerdown', down, { passive: false });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    els.fire.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.ptr.fire = e.pointerId; this.fire = true; els.fire.classList.add('press'); this.onFire && this.onFire(); }, { passive: false });
  }
  scale() { return this.getScale ? this.getScale() : 1; }
  zoneOf(e) {
    const w = window.innerWidth;
    return e.clientX < w * 0.45 ? 'move' : 'aim';
  }
  place(base, x, y) { base.style.left = x + 'px'; base.style.top = y + 'px'; base.classList.add('live'); }
  down(e) {
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('.m-btn, .firebtn, .no-stick')) return;
    e.preventDefault();
    this.active = true;
    const z = this.zoneOf(e);
    if (this.ptr[z] !== null) return;
    this.ptr[z] = e.pointerId;
    const s = z === 'move' ? this.els.moveBase : this.els.aimBase;
    const r = this.root.getBoundingClientRect();
    this['o_' + z] = { x: e.clientX, y: e.clientY };
    this.place(s, e.clientX - r.left, e.clientY - r.top);
    this.move(e);
  }
  move(e) {
    for (const z of ['move', 'aim']) {
      if (this.ptr[z] !== e.pointerId) continue;
      e.preventDefault();
      const o = this['o_' + z]; const R = this.R * this.scale();
      let dx = e.clientX - o.x, dy = e.clientY - o.y; const d = Math.hypot(dx, dy);
      const mag = Math.min(1, d / R); if (d > R) { dx *= R / d; dy *= R / d; }
      const knob = z === 'move' ? this.els.moveKnob : this.els.aimKnob;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const ang = Math.atan2(dx, dy); // screen right = +x, screen down = +z
      if (z === 'move') { this.moveAngle = ang; this.moveMag = mag < 0.15 ? 0 : mag; }
      else { this.aimAngle = ang; this.aimMag = mag; if (mag > 0.25) this.everAimed = true; }
    }
  }
  up(e) {
    if (this.ptr.fire === e.pointerId) { this.ptr.fire = null; this.fire = false; this.els.fire.classList.remove('press'); }
    for (const z of ['move', 'aim']) {
      if (this.ptr[z] !== e.pointerId) continue;
      this.ptr[z] = null;
      const knob = z === 'move' ? this.els.moveKnob : this.els.aimKnob; knob.style.transform = '';
      const base = z === 'move' ? this.els.moveBase : this.els.aimBase; base.classList.remove('live'); base.style.left = ''; base.style.top = '';
      if (z === 'move') this.moveMag = 0; else this.aimMag = 0;
    }
  }
  reset() { this.ptr = { move: null, aim: null, fire: null }; this.moveMag = 0; this.aimMag = 0; this.fire = false; }
}
