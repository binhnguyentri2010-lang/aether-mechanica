// @ts-check
// Hệ annotation (plan §13).
//
// Pipeline mỗi khung (chỉ ghi DOM khi lệch > 0.5px):
//  1. chiếu điểm neo → màn hình; loại nếu sau camera / ngoài vùng an toàn / vượt giới hạn mật độ
//  2. chia trái/phải theo tâm hình chiếu model, hysteresis 20px
//  3. corridor: mỗi phía một cột nhãn thẳng hàng sát mép hình chiếu model + 24px; thiếu chỗ thì
//     được lấn vào vùng mút cánh, kẹp theo mép viewport và bề rộng nhãn đo thật. Điện thoại: đặt gần neo.
//  4. thứ tự dọc theo y của neo, nới 1D, khoảng cách tối thiểu = cao nhãn + 4px
//  5. gỡ chéo: hai leader cùng phía cắt nhau → đổi chỗ, tối đa 20 lượt; còn chéo → bỏ nhãn ưu tiên thấp
//  6. va chạm với nhau / với HUD / với mép → bỏ nhãn ưu tiên thấp nhất
//  7. che khuất: CHỈ khi dirty, ≤ 1 lần / 6 khung; chỉ tính là bị che khi hộp bao của một PART
//     KHỐI ĐẶC KHÁC nằm trước neo ≥ 0.02. Dùng hộp bao (Picker.blocked) chứ không raycast từng tam
//     giác: bản đầu raycast tam giác tốn 83 ms mỗi lượt → camera giật mỗi 6 khung khi xoay.
//  Cả pipeline chỉ chạy khi có gì đổi (camera, explode, flight, resize, highlight) — đứng yên thì 0 chi phí.
//  Catalog và danh sách vật che (occluders) do MẪU VẬT cấp qua tham số — component không import mẫu nào.
import { Vector3, Ray } from 'three';

const NS = 'http://www.w3.org/2000/svg';
const _v = new Vector3();
const _w = new Vector3();
const _dir = new Vector3();
const SIDES = /** @type {(-1|1)[]} */ ([-1, 1]);
/** @param {{ay: number}} a @param {{ay: number}} b */
const byAy = (a, b) => a.ay - b.ay;

/**
 * @typedef {{
 *   c: import('../model/types.js').CatalogEntry, part: import('../model/Part.js').Part,
 *   label: HTMLButtonElement, g: SVGGElement, path: SVGPathElement, ring: SVGCircleElement, dot: SVGCircleElement,
 *   w: number, h: number, ax: number, ay: number, depth: number, vis: boolean, side: -1|0|1,
 *   lx: number, ly: number, ex: number, shown: boolean, occluded: boolean,
 *   last: {lx: number, ly: number, ax: number, ay: number, ex: number, cls: string},
 * }} Entry
 */

/** @param {number} ax @param {number} ay @param {number} bx @param {number} by @param {number} cx @param {number} cy @param {number} dx @param {number} dy */
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export class AnnotationLayer {
  /**
   * @param {{
   *   svg: SVGSVGElement, host: HTMLElement,
   *   model: import('../model/MechanicalModel.js').MechanicalModel,
   *   camera: import('three').PerspectiveCamera,
   *   getLayout: () => {W: number, H: number, safe: {x0: number, y0: number, x1: number, y1: number}, cls: string, hud: DOMRect[]},
   *   onHover: (name: string|null) => void, onSelect: (name: string) => void,
   *   picker: import('../core/pick.js').Picker,
   *   catalog: import('../model/types.js').CatalogEntry[],
   *   occluders: Set<string>,
   * }} o
   */
  constructor(o) {
    this.svg = o.svg;
    this.host = o.host;
    this.model = o.model;
    this.camera = o.camera;
    this.getLayout = o.getLayout;
    this.picker = o.picker;
    /** Loại part khối đặc có thể che nhãn (bỏ màng/khung mỏng, ống, dây…). */
    this.occluders = o.occluders;
    this.ray = new Ray();
    this.frame = 0;
    this.occlusionDirty = true;
    this.layoutDirty = true;
    /** @type {string|null} */ this.hotKind = null;
    /** @type {string|null} */ this.focusKind = null;
    this.stats = { shown: 0, overlaps: 0, crossings: 0 };
    /** Mảng dùng lại mỗi khung (xem update). @type {Entry[][]} */
    this._side = [[], []];
    /** @type {number[]} */
    this._ys = [];
    /** @type {Entry[]} */
    this._vis = [];

    this.onHover = o.onHover;
    this.onSelect = o.onSelect;
    /** @type {Entry[]} */
    this.entries = [];
    this._build(o.catalog);
  }

  /**
   * Đổi mẫu vật (commit chuyển mẫu): gỡ toàn bộ nhãn/leader cũ, dựng lại theo catalog mới — trong CÙNG
   * khung với việc đổi model, nên không khung nào có nhãn của mẫu B khi cảnh còn mẫu A.
   * @param {import('../model/MechanicalModel.js').MechanicalModel} model
   * @param {import('../model/types.js').CatalogEntry[]} catalog @param {Set<string>} occluders
   * @param {import('../core/pick.js').Picker} picker
   */
  setModel(model, catalog, occluders, picker) {
    for (const e of this.entries) {
      e.label.remove();
      e.g.remove();
    }
    this.entries = [];
    this.model = model;
    this.occluders = occluders;
    this.picker = picker;
    this.hotKind = null;
    this.focusKind = null;
    this._build(catalog);
    this.markDirty();
  }

  /** @param {import('../model/types.js').CatalogEntry[]} catalog */
  _build(catalog) {
    let order = 0;
    for (const c of catalog) {
      const part = this.model.reps[c.id];
      if (!c.annotate || !part) continue;
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'lbl';
      label.dataset.kind = c.id;
      label.style.setProperty('--i', String(order++));
      label.innerHTML = `<span class="no">${c.no}</span><span class="nm">${c.name}</span><span class="sub"></span>`;
      label.addEventListener('pointerenter', () => this.onHover(part.name));
      label.addEventListener('pointerleave', () => this.onHover(null));
      label.addEventListener('focus', () => this.onHover(part.name));
      label.addEventListener('blur', () => this.onHover(null));
      label.addEventListener('click', () => this.onSelect(part.name));
      this.host.appendChild(label);
      const g = /** @type {SVGGElement} */ (document.createElementNS(NS, 'g'));
      g.setAttribute('class', 'ann');
      g.style.setProperty('--i', String(order));
      const path = /** @type {SVGPathElement} */ (document.createElementNS(NS, 'path'));
      path.setAttribute('pathLength', '1');
      path.setAttribute('class', 'ldr');
      const ring = /** @type {SVGCircleElement} */ (document.createElementNS(NS, 'circle'));
      ring.setAttribute('r', '3.4');
      ring.setAttribute('class', 'ring');
      const dot = /** @type {SVGCircleElement} */ (document.createElementNS(NS, 'circle'));
      dot.setAttribute('r', '1.3');
      dot.setAttribute('class', 'dot');
      g.append(path, ring, dot);
      this.svg.appendChild(g);
      this.entries.push({
        c, part, label, g, path, ring, dot, w: 120, h: 14, ax: 0, ay: 0, depth: 0, vis: false, side: 0,
        lx: 0, ly: 0, ex: 0, shown: false, occluded: false,
        last: { lx: NaN, ly: NaN, ax: NaN, ay: NaN, ex: NaN, cls: '' },
      });
    }
  }

  /** Dòng phụ (vật liệu · số lượng) đổi theo chủ đề; đổi chữ thì phải đo lại bề rộng. @param {'azure'|'obsidian'} theme */
  setTheme(theme) {
    for (const e of this.entries) {
      /** @type {HTMLElement} */ (e.label.querySelector('.sub')).textContent = `${e.c.mat[theme]} · ${e.c.qty}`;
    }
    this.measure();
    this.markDirty();
  }

  /** Đo bề rộng/cao thật của nhãn (sau khi font nạp và khi đổi lớp viewport). */
  measure() {
    for (const e of this.entries) {
      e.w = e.label.offsetWidth || e.w;
      e.h = e.label.offsetHeight || e.h;
    }
  }

  /** @param {string|null} hot @param {string|null} focus */
  setHighlight(hot, focus) {
    this.hotKind = hot;
    this.focusKind = focus;
  }

  markDirty() {
    this.occlusionDirty = true;
    this.layoutDirty = true;
  }

  /** Còn việc phải làm không (bố trí lại hoặc lượt che khuất đang chờ). */
  needsUpdate() {
    return this.layoutDirty || this.occlusionDirty;
  }

  /** @param {number} e explode hiện tại @returns {typeof this.stats} */
  update(e) {
    const L = this.getLayout();
    const cam = this.camera;
    const m = this.model;
    const small = L.cls === 'mobile' || L.cls === 'phone-landscape';
    const cap = L.cls === 'desktop' ? 16 : L.cls === 'tablet' ? 12 : 99;
    const maxPri = small ? 1 : L.cls === 'tablet' ? 2 : 3;

    // 1. chiếu neo
    let n = 0;
    for (const en of this.entries) {
      en.vis = false;
      const a = en.part.anchor;
      if (!a) continue;
      _v.copy(a).applyMatrix4(en.part.pivot.matrixWorld);
      _w.copy(_v).applyMatrix4(cam.matrixWorldInverse);
      if (_w.z > -cam.near) continue;
      en.depth = -_w.z;
      _v.project(cam);
      en.ax = ((_v.x + 1) / 2) * L.W;
      en.ay = ((1 - _v.y) / 2) * L.H;
      if (en.c.priority > maxPri || n >= cap) continue;
      if (en.ax < L.safe.x0 + 4 || en.ax > L.safe.x1 - 4 || en.ay < L.safe.y0 + 4 || en.ay > L.safe.y1 - 4) continue;
      en.vis = true;
      n++;
    }

    // 2. hình chiếu model (mẫu nhẹ) → tâm và mép
    const s0 = /** @type {Float32Array} */ (m.lite0);
    const s1 = /** @type {Float32Array} */ (m.lite1);
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < s0.length; i += 3) {
      _v.set(s0[i] + (s1[i] - s0[i]) * e, s0[i + 1] + (s1[i + 1] - s0[i + 1]) * e, s0[i + 2] + (s1[i + 2] - s0[i + 2]) * e);
      _v.applyMatrix4(m.root.matrixWorld).project(cam);
      const x = ((_v.x + 1) / 2) * L.W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    const cx = (minX + maxX) / 2;

    for (const en of this.entries) {
      if (!en.vis) continue;
      if (en.side === 0) en.side = en.ax < cx ? -1 : 1;
      else if (en.side < 0 && en.ax > cx + 20) en.side = 1;
      else if (en.side > 0 && en.ax < cx - 20) en.side = -1;
      if (small) {
        // Đặt gần neo: phía nào không đủ chỗ thì lật sang phía kia; cả hai không đủ thì bỏ.
        // (Nếu cứ kẹp vào mép, nhãn sẽ trượt đè lên chính điểm neo của nó.)
        const fitsL = en.ax - 38 - en.w >= L.safe.x0;
        const fitsR = en.ax + 38 + en.w <= L.safe.x1;
        if (en.side < 0 && !fitsL) en.side = fitsR ? 1 : en.side;
        else if (en.side > 0 && !fitsR) en.side = fitsL ? -1 : en.side;
        if (!fitsL && !fitsR) en.vis = false;
      }
    }

    // 3–6. bố trí từng phía, bỏ nhãn khi không giải được. Mảng cấp sẵn, không filter/map mỗi khung: pipeline chạy
    // MỖI KHUNG khi camera xoay, rác nhỏ dồn lại thành những lần dọn rác làm p95 của khung nhảy vọt.
    for (let guard = 0; guard < 20; guard++) {
      let dropped = false;
      for (const side of SIDES) {
        const list = this._side[side < 0 ? 0 : 1];
        list.length = 0;
        for (const en of this.entries) if (en.vis && en.side === side) list.push(en);
        list.sort(byAy);
        if (!list.length) continue;
        let maxW = 0;
        for (const en of list) if (en.w > maxW) maxW = en.w;
        let col = side < 0 ? minX - 24 : maxX + 24;
        if (side < 0) col = Math.max(col, L.safe.x0 + maxW);
        else col = Math.min(col, L.safe.x1 - maxW);
        for (const en of list) {
          const corridorOk = !small && (side < 0 ? col < en.ax - 16 : col > en.ax + 16);
          if (corridorOk) en.lx = side < 0 ? col - en.w : col;
          else en.lx = side < 0 ? en.ax - 38 - en.w : en.ax + 38;
          en.lx = Math.min(Math.max(en.lx, L.safe.x0), L.safe.x1 - en.w);
        }
        // nới dọc (theo tâm nhãn)
        const ys = this._ys;
        ys.length = list.length;
        for (let i = 0; i < list.length; i++) ys[i] = list[i].ay;
        for (let i = 1; i < list.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + (list[i - 1].h + list[i].h) / 2 + 4);
        const lastI = list.length - 1;
        ys[lastI] = Math.min(ys[lastI], L.safe.y1 - list[lastI].h / 2);
        for (let i = lastI - 1; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - (list[i].h + list[i + 1].h) / 2 - 4);
        if (ys[0] - list[0].h / 2 < L.safe.y0) {
          // tràn cả hai đầu → bỏ nhãn ưu tiên thấp nhất của phía này (hoà thì giữ cái đứng trước, như reduce cũ)
          let worst = list[0];
          for (let i = 1; i < list.length; i++) if (list[i].c.priority > worst.c.priority) worst = list[i];
          worst.vis = false;
          dropped = true;
          break;
        }
        for (let i = 0; i < list.length; i++) list[i].ly = ys[i] - list[i].h / 2;

        // leader 45° rồi ngang; gỡ chéo bằng cách đổi chỗ hai hàng
        for (let pass = 0; pass < 20; pass++) {
          this._leaders(list);
          let swapped = false;
          for (let i = 0; i < list.length && !swapped; i++)
            for (let j = i + 1; j < list.length && !swapped; j++) {
              if (this._cross(list[i], list[j])) {
                const a = list[i], b = list[j];
                const ta = a.ly + a.h / 2, tb = b.ly + b.h / 2;
                a.ly = tb - a.h / 2;
                b.ly = ta - b.h / 2;
                list[i] = b;
                list[j] = a;
                swapped = true;
              }
            }
          if (!swapped) break;
        }
        this._leaders(list);
        for (let i = 0; i < list.length && !dropped; i++)
          for (let j = i + 1; j < list.length && !dropped; j++)
            if (this._cross(list[i], list[j])) {
              const lo = list[i].c.priority >= list[j].c.priority ? list[i] : list[j];
              lo.vis = false;
              dropped = true;
            }
        if (dropped) break;
      }
      if (dropped) continue;

      // va chạm giữa mọi nhãn và với HUD
      const vis = this._vis;
      vis.length = 0;
      for (const en of this.entries) if (en.vis) vis.push(en);
      outer: for (let i = 0; i < vis.length; i++) {
        const a = vis[i];
        for (const r of L.hud)
          if (a.lx < r.right + 4 && a.lx + a.w > r.left - 4 && a.ly < r.bottom + 4 && a.ly + a.h > r.top - 4) {
            a.vis = false;
            dropped = true;
            break outer;
          }
        for (let j = i + 1; j < vis.length; j++) {
          const b = vis[j];
          if (a.lx < b.lx + b.w + 2 && a.lx + a.w + 2 > b.lx && a.ly < b.ly + b.h + 2 && a.ly + a.h + 2 > b.ly) {
            (a.c.priority >= b.c.priority ? a : b).vis = false;
            dropped = true;
            break outer;
          }
        }
      }
      if (!dropped) break;
    }

    // 7. che khuất (thưa, chỉ hộp bao)
    this.frame++;
    this.layoutDirty = false;
    if (this.occlusionDirty && this.frame % 6 === 0) {
      this.occlusionDirty = false;
      cam.getWorldPosition(_w);
      for (const en of this.entries) {
        if (!en.vis || !en.part.anchor) continue;
        _v.copy(en.part.anchor).applyMatrix4(en.part.pivot.matrixWorld);
        _dir.subVectors(_v, _w);
        const dist = _dir.length();
        this.ray.set(_w, _dir.normalize());
        const self = en.part;
        const occ = this.occluders;
        en.occluded = this.picker.blocked(this.ray, _v, dist - 0.02, (mesh) => {
          const p = mesh.userData.part;
          return p !== self && occ.has(p.kind);
        });
      }
    }

    // ghi DOM
    let shown = 0;
    for (const en of this.entries) {
      const on = en.vis;
      const hot = on && this.hotKind === en.c.id;
      const dim = on && !!this.focusKind && this.focusKind !== en.c.id;
      const cls = !on ? 'off' : `${hot ? ' hot' : ''}${dim ? ' dim' : ''}${en.occluded && !hot ? ' occ' : ''}${en.side < 0 ? ' left' : ''}`;
      if (cls !== en.last.cls) {
        en.label.className = 'lbl' + (on ? cls : ' off');
        en.g.setAttribute('class', 'ann' + (on ? cls : ' off'));
        en.last.cls = cls;
      }
      if (!on) continue;
      shown++;
      const lt = en.last;
      // Viết "!(… <= x)" để NaN ban đầu cũng tính là "đã đổi" (NaN > x luôn sai)
      if (!(Math.abs(en.lx - lt.lx) <= 0.5) || !(Math.abs(en.ly - lt.ly) <= 0.5)) {
        en.label.style.transform = `translate3d(${en.lx.toFixed(1)}px, ${en.ly.toFixed(1)}px, 0)`;
        lt.lx = en.lx;
        lt.ly = en.ly;
      }
      if (!(Math.abs(en.ax - lt.ax) <= 0.4) || !(Math.abs(en.ay - lt.ay) <= 0.4) || !(Math.abs(en.ex - lt.ex) <= 0.4) || lt.ly !== en.ly) {
        const yRow = en.ly + en.h / 2;
        const endX = en.side < 0 ? en.lx + en.w + 5 : en.lx - 5;
        en.path.setAttribute('d', `M${en.ax.toFixed(1)} ${en.ay.toFixed(1)}L${en.ex.toFixed(1)} ${yRow.toFixed(1)}L${endX.toFixed(1)} ${yRow.toFixed(1)}`);
        en.ring.setAttribute('cx', en.ax.toFixed(1));
        en.ring.setAttribute('cy', en.ay.toFixed(1));
        en.dot.setAttribute('cx', en.ax.toFixed(1));
        en.dot.setAttribute('cy', en.ay.toFixed(1));
        lt.ax = en.ax;
        lt.ay = en.ay;
        lt.ex = en.ex;
      }
    }
    this.stats.shown = shown;
    return this.stats;
  }

  /** Tính khuỷu leader: đi chéo 45° từ neo tới hàng của nhãn, rồi ngang. @param {Entry[]} list */
  _leaders(list) {
    for (const en of list) {
      const yRow = en.ly + en.h / 2;
      const endX = en.side < 0 ? en.lx + en.w + 5 : en.lx - 5;
      const dir = en.side < 0 ? -1 : 1;
      let ex = en.ax + dir * Math.abs(yRow - en.ay);
      if (dir < 0) ex = Math.max(ex, endX);
      else ex = Math.min(ex, endX);
      en.ex = ex;
    }
  }

  /** Hai leader có cắt nhau không. @param {Entry} a @param {Entry} b */
  _cross(a, b) {
    const ay = a.ly + a.h / 2, by = b.ly + b.h / 2;
    const aEnd = a.side < 0 ? a.lx + a.w + 5 : a.lx - 5;
    const bEnd = b.side < 0 ? b.lx + b.w + 5 : b.lx - 5;
    const A = [[a.ax, a.ay, a.ex, ay], [a.ex, ay, aEnd, ay]];
    const B = [[b.ax, b.ay, b.ex, by], [b.ex, by, bEnd, by]];
    for (const s of A) for (const t of B) if (segCross(s[0], s[1], s[2], s[3], t[0], t[1], t[2], t[3])) return true;
    return false;
  }

  /** Kiểm tra cho selftest: số cặp nhãn chồng nhau, số cặp leader cắt nhau, nhãn đè HUD/tràn mép. */
  audit() {
    const L = this.getLayout();
    const vis = this.entries.filter((e) => e.vis);
    let overlaps = 0, crossings = 0, hud = 0, out = 0, nan = 0;
    for (let i = 0; i < vis.length; i++) {
      const a = vis[i];
      if (![a.lx, a.ly, a.ax, a.ay, a.ex].every(Number.isFinite)) nan++;
      if (a.lx < -0.5 || a.ly < -0.5 || a.lx + a.w > L.W + 0.5 || a.ly + a.h > L.H + 0.5) out++;
      for (const r of L.hud) if (a.lx < r.right && a.lx + a.w > r.left && a.ly < r.bottom && a.ly + a.h > r.top) hud++;
      for (let j = i + 1; j < vis.length; j++) {
        const b = vis[j];
        if (a.lx < b.lx + b.w && a.lx + a.w > b.lx && a.ly < b.ly + b.h && a.ly + a.h > b.ly) overlaps++;
        if (a.side === b.side && this._cross(a, b)) crossings++;
      }
    }
    return { shown: vis.length, overlaps, crossings, hud, out, nan };
  }
}
