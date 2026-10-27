// @ts-check
// Camera — MỘT CHỖ GHI DUY NHẤT (plan §11, quyết định khoá #2).
//
// • OrbitControls sở hữu hướng nhìn + khoảng cách (xoay/zoom/pan của người dùng).
// • applyFraming() là nơi DUY NHẤT ghi camera.fov, camera.zoom, setViewOffset, controls.panSpeed,
//   min/maxDistance, controls.cursor. Tween preset/focus cũng chạy trong file này.
// • Explode/flight chỉ đổi camera.zoom → zoom tay của người dùng không bao giờ bị ghi đè.
//
// Bẫy của OrbitControls r160 đã kiểm trong vendor:
//   - update() kẹp khoảng cách vào [min,max] MỖI lần gọi (dòng 268–272) → không gọi update() khi tween.
//   - update() kẹp target quanh controls.cursor MỖI lần gọi (dòng 259–262) → cursor phải theo focus.
//   - Tắt damping rồi update() một lần sẽ xoá sphericalDelta (dòng 285–294) → dùng để xả quán tính.
import { Vector3, Spherical, Quaternion, Box3, Vector2 } from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { DEG, clamp, lerp, easeInOutCubic, angleDelta } from '../core/easing.js';

/** @typedef {'iso'|'plan'|'front'|'profile'} PresetName */
/** @typedef {{theta: number, phi: number, fov: number}} Preset */

/** @type {Record<PresetName | 'isoPortrait', Preset>} */
export const PRESETS = {
  iso: { theta: 215 * DEG, phi: 38 * DEG, fov: 30 },
  plan: { theta: 180 * DEG, phi: 0.001, fov: 18 },
  front: { theta: 0, phi: 84 * DEG, fov: 18 },
  profile: { theta: 90 * DEG, phi: 84 * DEG, fov: 18 },
  // Điện thoại dọc: xoay 90° để sải cánh chạy theo chiều dọc màn hình
  // (theta 125° đã thử: sải cánh nằm chéo, model chỉ dùng ~1/3 chiều cao màn điện thoại)
  isoPortrait: { theta: 102 * DEG, phi: 33 * DEG, fov: 30 },
};

const R_BASE = 14; // khoảng cách chuẩn ở fov 30°
/** Khoảng cách chuẩn cho một fov: giữ nguyên kích thước hiển thị khi đổi fov (dolly-zoom). @param {number} fov */
export const radiusFor = (fov) => (R_BASE * Math.tan(15 * DEG)) / Math.tan((fov / 2) * DEG);

const _v = new Vector3();
const _c = new Vector3();
const _sph = new Spherical();

export class CameraControls {
  /**
   * @param {{
   *   camera: import('three').PerspectiveCamera,
   *   dom: HTMLElement,
   *   model: import('../model/MechanicalModel.js').MechanicalModel,
   *   getLayout: () => {W: number, H: number, safe: {x0: number, y0: number, x1: number, y1: number}, cls: string},
   *   onTweenChange: (tweening: boolean) => void,
   *   views?: Partial<Record<keyof typeof PRESETS, Preset>>, scale?: number,
   * }} o
   */
  constructor(o) {
    this.camera = o.camera;
    this.model = o.model;
    this.getLayout = o.getLayout;
    this.onTweenChange = o.onTweenChange;
    /** Preset đang dùng = PRESETS chung, ghi đè bởi góc riêng của mẫu vật (SpecimenDef.views). */
    this.presets = { ...PRESETS, ...(o.views || {}) };
    /** Hệ số khoảng cách camera theo mẫu vật: mẫu cao/dài lùi camera xa hơn → bớt méo phối cảnh. */
    this.scale = o.scale ?? 1;

    const c = new OrbitControls(o.camera, o.dom);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.5;
    c.screenSpacePanning = true;
    c.maxTargetRadius = 1.5;
    c.autoRotateSpeed = 0.55;
    this.controls = c;

    this.center = /** @type {Vector3} */ (o.model.center0).clone();
    c.target.copy(this.center);
    c.cursor.copy(this.center);

    /** @type {PresetName} */ this.preset = 'iso';
    this.fov = PRESETS.iso.fov;
    /** @type {Record<string, {z0: number, z1: number}>} */ this.fits = {};
    /** @type {null | {t: number, dur: number, from: any, to: any, focusFrom: number, focusTo: number}} */
    this.tween = null;
    /** @type {null | {part: import('../model/Part.js').Part, local: Vector3, radius: number, returnRadius: number}} */
    this.focus = null;
    this.focusBlend = 0;
    this.pinned = new Vector3();
    /** Tâm focus gần nhất — giữ lại để nhả focus mượt, không nhảy khung. */
    this.pinFocus = new Vector3();
    this.lastPos = new Vector3(Infinity, 0, 0);
    this.lastQuat = new Quaternion();
    this.userActive = false;
    /** Số đo cho HUD, ghi đè tại chỗ mỗi khung (readout). */
    this._readout = { az: 0, el: 0, dist: 0, fov: 0, zoom: 1 };
    this.orbitResumeAt = 0;
    c.addEventListener('start', () => {
      this.userActive = true;
    });
    c.addEventListener('end', () => {
      this.userActive = false;
      this.orbitResumeAt = performance.now() + 3000;
    });
  }

  /** Preset thực dùng (ISO dọc trên điện thoại). @param {PresetName} name @returns {keyof typeof PRESETS} */
  presetKey(name) {
    const L = this.getLayout();
    return name === 'iso' && L.H > L.W * 1.15 ? 'isoPortrait' : name;
  }

  /**
   * Đổi mẫu vật (commit chuyển mẫu, plan §3 bước 2): model mới, tâm mới, preset riêng, tính lại khung.
   * KHÔNG tự tween — người gọi quyết định (commit dùng goTo(..., true) vì lúc đó cảnh đang tối).
   * @param {import('../model/MechanicalModel.js').MechanicalModel} model
   * @param {Partial<Record<keyof typeof PRESETS, Preset>>} [views] @param {number} [scale]
   */
  setModel(model, views, scale = 1) {
    this.model = model;
    this.presets = { ...PRESETS, ...(views || {}) };
    this.scale = scale;
    this.center.copy(/** @type {Vector3} */ (model.center0));
    this.focus = null;
    this.focusBlend = 0;
    this.computeFits();
  }

  /** Khoảng cách chuẩn cho fov, theo hệ số của mẫu vật. @param {number} fov */
  radius(fov) {
    return radiusFor(fov) * this.scale;
  }

  // ── Căn khung ────────────────────────────────────────────────────────────────────────────────

  /** Chiếu một điểm (toạ độ thế giới) sang NDC ở zoom = 1, không view offset, theo hướng camera cho trước. */
  _ndc(/** @type {Vector3} */ p, /** @type {import('three').Matrix4} */ viewInv, /** @type {number} */ tanH, /** @type {number} */ aspect, /** @type {Vector2} */ out) {
    _v.copy(p).applyMatrix4(viewInv);
    const z = -_v.z || 1e-6;
    return out.set(_v.x / z / (tanH * aspect), _v.y / z / tanH);
  }

  /** Tính fitZoom cho mọi preset ở e = 0 và e = 1 (khi khởi tạo và khi resize). */
  computeFits() {
    const L = this.getLayout();
    const aspect = L.W / L.H;
    const tmp = this.camera.clone();
    const m = this.model;
    const out = new Vector2();
    const cN = new Vector2();
    for (const key of /** @type {(keyof typeof PRESETS)[]} */ (Object.keys(this.presets))) {
      const P = this.presets[key];
      const tanH = Math.tan((P.fov / 2) * DEG);
      /** @type {number[]} */
      const zs = [];
      for (const e of [0, 1]) {
        const ctr = m.centerAt(e, new Vector3());
        _sph.set(this.radius(P.fov), P.phi, P.theta);
        tmp.position.setFromSpherical(_sph).add(ctr);
        tmp.up.set(0, 1, 0);
        tmp.lookAt(ctr);
        tmp.updateMatrixWorld(true);
        const viewInv = tmp.matrixWorldInverse;
        this._ndc(ctr, viewInv, tanH, aspect, cN);
        const pts = /** @type {Float32Array} */ (e ? m.samples1 : m.samples0);
        let l = 0, r = 0, t = 0, b = 0;
        for (let i = 0; i < pts.length; i += 3) {
          this._ndc(_c.fromArray(pts, i), viewInv, tanH, aspect, out);
          const dx = ((out.x - cN.x) * L.W) / 2;
          const dy = ((out.y - cN.y) * L.H) / 2;
          if (-dx > l) l = -dx;
          if (dx > r) r = dx;
          if (dy > t) t = dy;
          if (-dy > b) b = -dy;
        }
        const d = this.desiredPoint(L);
        const sw = L.safe.x1 - L.safe.x0;
        const sh = L.safe.y1 - L.safe.y0;
        // Điện thoại: ít nhãn, chiều ngang là giới hạn → cho model lấn sát mép hơn
        const small = L.cls === 'mobile' || L.cls === 'phone-landscape';
        const z = Math.min(
          ((small ? 0.9 : 0.74) * sw) / (l + r),
          ((small ? 0.86 : 0.76) * sh) / (t + b),
          (0.97 * (d.x - L.safe.x0)) / l,
          (0.97 * (L.safe.x1 - d.x)) / r,
          (0.97 * (d.y - L.safe.y0)) / t,
          (0.97 * (L.safe.y1 - d.y)) / b,
        );
        zs.push(z);
      }
      this.fits[key] = { z0: zs[0], z1: zs[1] };
    }
  }

  /** Điểm trên màn hình nơi tâm model được ghim: giữa vùng an toàn, lệch phải ~4% trên màn rộng. */
  desiredPoint(L = this.getLayout()) {
    const shift = L.cls === 'desktop' || L.cls === 'tablet' ? 0.04 * L.W : 0;
    return { x: (L.safe.x0 + L.safe.x1) / 2 + shift, y: (L.safe.y0 + L.safe.y1) / 2 };
  }

  /**
   * NƠI DUY NHẤT GHI thuộc tính camera.
   * @param {number} e explode hiện tại @param {number} flight 0..1
   */
  applyFraming(e, flight) {
    const cam = this.camera;
    const L = this.getLayout();
    const f = this.fits[this.presetKey(this.preset)] || { z0: 1, z1: 1 };
    const zoom = (1 / lerp(1 / f.z0, 1 / f.z1, e)) * (1 - 0.1 * flight);

    cam.fov = this.fov;
    cam.zoom = zoom;
    cam.aspect = L.W / L.H;

    // Điểm cần ghim: tâm model ở mức nổ e, hoặc tâm part khi đang focus
    this.model.centerAt(e, this.pinned);
    this.model.root.localToWorld(this.pinned);
    if (this.focus) this.focusCenter(this.pinFocus);
    if (this.focusBlend > 0) this.pinned.lerp(this.pinFocus, this.focusBlend);
    cam.updateMatrixWorld(true);
    const tanH = Math.tan((this.fov / 2) * DEG);
    _v.copy(this.pinned).applyMatrix4(cam.matrixWorldInverse);
    const z = -_v.z || 1e-6;
    const nx = (_v.x / z / (tanH * cam.aspect)) * zoom;
    const ny = (_v.y / z / tanH) * zoom;
    const d = this.desiredPoint(L);
    const offX = ((nx + 1) / 2) * L.W - d.x;
    const offY = ((1 - ny) / 2) * L.H - d.y;
    cam.setViewOffset(L.W, L.H, offX, offY, L.W, L.H);
    cam.updateProjectionMatrix();

    const c = this.controls;
    c.panSpeed = 0.5 / zoom;
    if (this.focus) c.cursor.copy(this.focusCenter(_c));
    else c.cursor.copy(this.center);
    c.maxTargetRadius = this.focus ? 0.8 : 1.5;
    if (!this.tween) {
      const base = this.radius(this.fov);
      c.minDistance = this.focus ? 0.35 : base * 0.3;
      c.maxDistance = base * 2.4;
    }
  }

  // ── Preset & focus ─────────────────────────────────────────────────────────────────────────

  flushInertia() {
    const c = this.controls;
    c.enableDamping = false;
    c.update();
    c.enableDamping = true;
  }

  /** @param {PresetName} name @param {boolean} [instant] */
  goTo(name, instant = false) {
    this.preset = name;
    const P = this.presets[this.presetKey(name)];
    this.focus = null;
    this._startTween(
      { theta: P.theta, phi: P.phi, radius: this.radius(P.fov), target: this.center.clone(), fov: P.fov },
      instant ? 0 : 0.9,
      this.focusBlend,
      0,
    );
  }

  /** @param {import('../model/Part.js').Part} part */
  focusOn(part) {
    const box = new Box3();
    for (const m of part.meshes) box.expandByObject(m);
    if (box.isEmpty()) return;
    const world = box.getCenter(new Vector3());
    const radius = Math.max(0.06, box.getSize(new Vector3()).length() / 2);
    const local = part.group.worldToLocal(world.clone());
    const returnRadius = this.focus ? this.focus.returnRadius : this.camera.position.distanceTo(this.controls.target);
    this.focus = { part, local, radius, returnRadius };
    const tanH = Math.tan((this.fov / 2) * DEG);
    const dist = clamp((radius * this.camera.zoom) / (0.3 * tanH), 0.45, this.radius(this.fov) * 1.2);
    _v.copy(this.camera.position).sub(this.controls.target);
    _sph.setFromVector3(_v);
    this._startTween({ theta: _sph.theta, phi: _sph.phi, radius: dist, target: world, fov: this.fov }, 0.85, this.focusBlend, 1);
  }

  clearFocus() {
    if (!this.focus) return;
    const back = this.focus.returnRadius;
    this.focus = null;
    _v.copy(this.camera.position).sub(this.controls.target);
    _sph.setFromVector3(_v);
    this._startTween({ theta: _sph.theta, phi: _sph.phi, radius: back, target: this.center.clone(), fov: this.fov }, 0.8, this.focusBlend, 0);
  }

  /** Tâm part đang focus (bám theo khi part dịch vì explode). @param {Vector3} out */
  focusCenter(out) {
    if (!this.focus) return out.copy(this.center);
    return out.copy(this.focus.local).applyMatrix4(this.focus.part.group.matrixWorld);
  }

  /** @param {{theta: number, phi: number, radius: number, target: Vector3, fov: number}} to @param {number} dur @param {number} fFrom @param {number} fTo */
  _startTween(to, dur, fFrom, fTo) {
    this.flushInertia();
    _v.copy(this.camera.position).sub(this.controls.target);
    _sph.setFromVector3(_v);
    const from = { theta: _sph.theta, phi: _sph.phi, radius: _sph.radius, target: this.controls.target.clone(), fov: this.fov };
    // Nới min/max để bao cả hai đầu trong lúc tween (update() không được gọi, nhưng phòng hờ)
    this.controls.minDistance = Math.min(from.radius, to.radius) * 0.9;
    this.controls.maxDistance = Math.max(from.radius, to.radius) * 1.1;
    this.tween = { t: 0, dur: Math.max(dur, 1e-3), from, to, focusFrom: fFrom, focusTo: fTo };
    this.controls.enabled = false;
    this.onTweenChange(true);
    if (dur === 0) this._stepTween(1);
  }

  /** @param {number} dt */
  _stepTween(dt) {
    const tw = /** @type {NonNullable<CameraControls['tween']>} */ (this.tween);
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const k = easeInOutCubic(tw.t);
    const { from, to } = tw;
    const theta = from.theta + angleDelta(from.theta, to.theta) * k;
    const phi = lerp(from.phi, to.phi, k);
    const radius = Math.exp(lerp(Math.log(from.radius), Math.log(to.radius), k));
    const target = this.controls.target.lerpVectors(from.target, this.focus ? this.focusCenter(_c) : to.target, k);
    this.fov = lerp(from.fov, to.fov, k);
    this.focusBlend = lerp(tw.focusFrom, tw.focusTo, k);
    _sph.set(radius, phi, theta);
    this.camera.position.setFromSpherical(_sph).add(target);
    this.camera.lookAt(target);
    if (tw.t >= 1) {
      this.tween = null;
      this.controls.enabled = true;
      this.flushInertia();
      this.onTweenChange(false);
    }
  }

  /**
   * @param {number} dt @param {number} e @param {number} flight @param {boolean} autoOrbit
   * @returns {boolean} camera đang chuyển động
   */
  update(dt, e, flight, autoOrbit) {
    if (this.tween) this._stepTween(dt);
    else {
      // Focus: target bám tâm part khi part đang dịch chuyển (explode)
      if (this.focus) {
        const fc = this.focusCenter(_c);
        _v.subVectors(fc, this.controls.target);
        if (_v.lengthSq() > 1e-10) {
          this.controls.target.add(_v);
          this.camera.position.add(_v);
        }
      }
      this.controls.autoRotate = autoOrbit && !this.userActive && performance.now() > this.orbitResumeAt;
      this.controls.update();
    }
    this.applyFraming(e, flight);
    const moved = this.camera.position.distanceToSquared(this.lastPos) > 1e-12 || this.camera.quaternion.angleTo(this.lastQuat) > 1e-7;
    this.lastPos.copy(this.camera.position);
    this.lastQuat.copy(this.camera.quaternion);
    return !!this.tween || moved || this.controls.autoRotate;
  }

  /** Thông số cho HUD. */
  readout() {
    _v.copy(this.camera.position).sub(this.controls.target);
    _sph.setFromVector3(_v);
    let az = (_sph.theta / DEG) % 360;
    if (az < 0) az += 360;
    // Gọi mỗi khung (HUD) → ghi vào một object dùng lại, không tạo object mới
    const r = this._readout;
    r.az = az; r.el = 90 - _sph.phi / DEG; r.dist = _sph.radius / 10; r.fov = this.fov; r.zoom = this.camera.zoom;
    return r;
  }
}
