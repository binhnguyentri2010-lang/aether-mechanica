// @ts-check
// Material state composition (plan §7, quyết định khoá #5).
//
// Mỗi vật liệu lưu GIÁ TRỊ GỐC. Giá trị cuối LUÔN tính lại từ gốc:
//   envMapIntensity = gốc × intro × dim
//   color           = gốc × dim
//   opacity         = gốc × dim                 (membrane)
//   emissive        = gốc × dim + glow          (core: cường độ × intro × (1 + flightBoost))
// Không bao giờ nhân vào giá trị hiện tại → intro, hover, focus, flight không thể nhân dồn.
// Đổi chủ đề = thay GIÁ TRỊ GỐC (setTheme), rồi ghi lại toàn bộ từ gốc mới.
// Chỉ lớp này được ghi các thuộc tính trên.
import { Color } from 'three';

const GLOW = new Color(0.11, 0.075, 0.035);
const _c = new Color();

/**
 * @typedef {{
 *   m: any, kind: string, key: string,
 *   b: {color: Color, emissive: Color|null, ei: number, env: number, opacity: number},
 *   dim: number, glow: number, tDim: number, tGlow: number,
 * }} Entry
 */

// Thứ tự lớp (đợt 3, §8): base(theme) → motion/emissive (core × (1 + boost))
//                           → interaction (dim, hover glow) → transition (intro / fade mẫu).
// Danh sách vật liệu TÁCH THEO MẪU VẬT: step() chỉ duyệt mẫu đang xem; setTheme() áp cho MỌI mẫu;
// đổi mẫu (setActiveOwner) → ghi lại toàn bộ vật liệu của mẫu mới một lần từ base.
export class MaterialState {
  constructor() {
    /** Danh sách theo mẫu vật. @type {Map<string, Entry[]>} */
    this.lists = new Map();
    /** @type {string|null} */ this.activeOwner = null;
    this.intro = 1;
    this.motionBoost = 0;
    /** @type {string|null} */ this.focusKind = null;
    /** @type {string|null} */ this.hoverKind = null;
    /** @type {string|null} */ this.hoverMat = null;
    this._targetsDirty = true;
    this._writeAll = true;
    this._animating = true;
  }

  /** Vật liệu của mẫu đang xem. */
  get entries() {
    return (this.activeOwner && this.lists.get(this.activeOwner)) || [];
  }

  /** @param {any} m @param {string} kind @param {string} owner id mẫu vật */
  register(m, kind, owner) {
    const e = /** @type {Entry} */ ({ m, kind, key: m.userData.matKey, b: /** @type {any} */ (null), dim: 1, glow: 0, tDim: 1, tGlow: 0 });
    this._capture(e);
    if (!this.lists.has(owner)) this.lists.set(owner, []);
    /** @type {Entry[]} */ (this.lists.get(owner)).push(e);
    if (this.activeOwner === null) this.activeOwner = owner;
  }

  /** Đổi mẫu đang xem: ghi lại toàn bộ từ base để hover/focus của lần trước không còn sót. @param {string} owner */
  setActiveOwner(owner) {
    if (owner === this.activeOwner) return;
    this.activeOwner = owner;
    for (const e of this.entries) {
      e.dim = e.tDim = 1;
      e.glow = e.tGlow = 0;
    }
    this._targetsDirty = true;
    this._writeAll = true;
    this._animating = true;
  }

  /** @param {Entry} e */
  _capture(e) {
    const m = e.m;
    e.b = {
      color: m.color.clone(),
      emissive: m.emissive ? m.emissive.clone() : null,
      ei: m.emissiveIntensity ?? 1,
      env: m.envMapIntensity ?? 1,
      opacity: m.opacity,
    };
  }

  /**
   * Đổi bảng màu: áp bảng mới lên từng vật liệu rồi chụp lại giá trị gốc.
   * @param {import('./materials.js').Theme} theme @param {import('./materials.js').MaterialLibrary} lib
   */
  setTheme(theme, lib) {
    lib.setTheme(theme); // vật liệu gốc của thư viện → mẫu dựng sau cũng mang chủ đề này
    // MỌI mẫu, không chỉ mẫu đang xem — mẫu ẩn cũng phải mang chủ đề đúng khi được chuyển sang
    for (const list of this.lists.values())
      for (const e of list) {
        lib.applyPalette(e.m, /** @type {any} */ (e.key), theme);
        this._capture(e);
      }
    this._writeAll = true;
    this._animating = true;
  }

  /** @param {string|null} k */ setFocus(k) { if (k !== this.focusKind) { this.focusKind = k; this._targetsDirty = true; } }
  /** @param {string|null} k */ setHover(k) { if (k !== this.hoverKind) { this.hoverKind = k; this._targetsDirty = true; } }
  /** @param {string|null} k */ setHoverMaterial(k) { if (k !== this.hoverMat) { this.hoverMat = k; this._targetsDirty = true; } }
  /** @param {number} v */ setIntro(v) { if (v !== this.intro) { this.intro = v; this._writeAll = true; } }
  /** @param {number} v */ setMotionBoost(v) { if (v !== this.motionBoost) { this.motionBoost = v; this._writeAll = true; } }

  /** Ưu tiên: selected > hovered > material-hover > mặc định. @param {Entry} e */
  _targets(e) {
    let dim = 1;
    let glow = 0;
    if (this.focusKind) {
      const on = e.kind === this.focusKind;
      dim = on ? 1 : this.hoverKind === e.kind ? 0.55 : 0.3;
      glow = on ? 0.55 : 0;
    } else if (this.hoverKind) {
      const on = e.kind === this.hoverKind;
      dim = on ? 1 : 0.5;
      glow = on ? 1 : 0;
    } else if (this.hoverMat) {
      const on = MAT_GROUPS[this.hoverMat]?.includes(e.key) ?? e.key === this.hoverMat;
      dim = on ? 1 : 0.35;
      glow = on ? 0.45 : 0;
    }
    e.tDim = dim;
    e.tGlow = glow;
  }

  /** @param {number} dt @returns {boolean} còn đang chuyển tiếp */
  step(dt) {
    if (this._targetsDirty) {
      for (const e of this.entries) this._targets(e);
      this._targetsDirty = false;
      this._animating = true;
    }
    // Không có gì đổi → thoát ngay, khỏi duyệt ~400 vật liệu mỗi khung
    if (!this._animating && !this._writeAll) return false;
    const k = 1 - Math.exp(-dt / 0.07); // ~200ms tới đích
    let busy = false;
    for (const e of this.entries) {
      let changed = this._writeAll;
      if (e.dim !== e.tDim || e.glow !== e.tGlow) {
        e.dim += (e.tDim - e.dim) * k;
        e.glow += (e.tGlow - e.glow) * k;
        if (Math.abs(e.dim - e.tDim) < 0.004) e.dim = e.tDim;
        if (Math.abs(e.glow - e.tGlow) < 0.004) e.glow = e.tGlow;
        changed = true;
        if (e.dim !== e.tDim || e.glow !== e.tGlow) busy = true;
      }
      if (changed) this._write(e);
    }
    this._writeAll = false;
    this._animating = busy;
    return busy;
  }

  /** @param {Entry} e */
  _write(e) {
    const m = e.m;
    m.color.copy(e.b.color).multiplyScalar(e.dim);
    if ('envMapIntensity' in m) m.envMapIntensity = e.b.env * this.intro * e.dim;
    if (e.key === 'membrane') m.opacity = e.b.opacity * (0.35 + 0.65 * e.dim) * this.intro;
    if (e.b.emissive) {
      if (e.key === 'amber') {
        m.emissive.copy(e.b.emissive);
        m.emissiveIntensity = e.b.ei * this.intro * (1 + this.motionBoost) * (0.4 + 0.6 * e.dim);
      } else {
        _c.copy(GLOW).multiplyScalar(e.glow);
        m.emissive.copy(e.b.emissive).multiplyScalar(e.dim).add(_c);
      }
    }
  }
}

/** Chip vật liệu ở HUD → các vai trò vật liệu tương ứng. */
export const MAT_GROUPS = /** @type {Record<string, string[]>} */ ({
  azure: ['azure', 'shell', 'optic', 'carbon'],
  gold: ['brass', 'plate', 'silver', 'ivory', 'copper'],
  pearl: ['pearl', 'steel', 'membrane'],
});
