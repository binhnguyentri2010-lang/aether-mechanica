// @ts-check
// Cây BVH tam giác của MỘT geometry — cho raycast hover/click (core/pick.js).
//
// Đo thật (bench trên Edge + Intel Iris Xe): hover là kịch bản CPU nặng nhất (p95 ~10 ms) vì Mesh.raycast của
// three duyệt TỪNG tam giác của mỗi mesh ứng viên (vỏ ngực, cụm vòng đồng… hàng chục nghìn tam giác) và tạo đối
// tượng kết quả cho mỗi lần trúng. Cây này chỉ thử các tam giác nằm trong những hộp mà tia đi qua, cắt tỉa theo
// điểm trúng gần nhất đã biết, 0 cấp phát khi truy vấn.
//
// Đúng như three (có test so từng tia): phép thử tam giác dùng CHÍNH Ray.intersectTriangle của three, cùng quy
// tắc mặt (FrontSide bỏ mặt sau, BackSide đảo thứ tự đỉnh, DoubleSide thử cả hai). Dựng trong hệ toạ độ của
// geometry; tia vào phải ở cùng hệ đó (đã chuẩn hoá hướng). Geometry đổi đỉnh mỗi khung (dây cáp động) KHÔNG
// dùng cây này.
import { Vector3, FrontSide, BackSide } from 'three';

const LEAF = 8;

/**
 * Quickselect: sắp lại order[lo..hi] sao cho phần tử thứ k đúng chỗ theo toạ độ tâm trên trục, bên trái ≤, bên
 * phải ≥ — đủ để tách đôi tại trung vị với chi phí O(n) (sắp toàn bộ mỗi tầng tốn O(n log² n) khi dựng).
 * @param {Uint32Array} order @param {Float32Array} cen @param {number} axis
 * @param {number} lo @param {number} hi @param {number} k
 */
function select(order, cen, axis, lo, hi, k) {
  while (hi > lo) {
    const pivot = cen[order[(lo + hi) >> 1] * 3 + axis];
    let i = lo, j = hi;
    while (i <= j) {
      while (cen[order[i] * 3 + axis] < pivot) i++;
      while (cen[order[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const t = order[i]; order[i] = order[j]; order[j] = t;
        i++; j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _p = new Vector3();

export class TriBVH {
  /** @param {import('three').BufferGeometry} geo */
  constructor(geo) {
    const pos = geo.attributes.position;
    const index = geo.index;
    const n = index ? index.count : pos.count;
    const T = Math.floor(n / 3);
    // Toạ độ 3 đỉnh của từng tam giác liền nhau (9 số/tam giác) → vòng lặp thử không phải tra index
    const tri = new Float32Array(T * 9);
    const cen = new Float32Array(T * 3);
    // Đọc thẳng mảng khi thuộc tính là mảng liền (không interleave, không normalized) — nhanh hơn getX() nhiều lần
    const direct = !(/** @type {any} */ (pos).isInterleavedBufferAttribute) && !pos.normalized && pos.itemSize === 3;
    const pa = /** @type {any} */ (pos).array;
    const ia = index ? index.array : null;
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < 3; k++) {
        const v = ia ? ia[t * 3 + k] : t * 3 + k;
        const o = t * 9 + k * 3;
        if (direct) {
          tri[o] = pa[v * 3]; tri[o + 1] = pa[v * 3 + 1]; tri[o + 2] = pa[v * 3 + 2];
        } else {
          tri[o] = pos.getX(v); tri[o + 1] = pos.getY(v); tri[o + 2] = pos.getZ(v);
        }
      }
      for (let a = 0; a < 3; a++) cen[t * 3 + a] = (tri[t * 9 + a] + tri[t * 9 + 3 + a] + tri[t * 9 + 6 + a]) / 3;
    }
    const order = new Uint32Array(T);
    for (let t = 0; t < T; t++) order[t] = t;

    /** @type {number[]} */ const box = []; // 6 số/nút: min xyz, max xyz
    /** @type {number[]} */ const kid = []; // 2 số/nút: con trái, con phải (−1 = lá)
    /** @type {number[]} */ const span = []; // 2 số/nút: đầu, số tam giác (chỉ lá)

    /** @param {number} s @param {number} e @returns {number} chỉ số nút */
    const build = (s, e) => {
      const id = kid.length / 2;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let i = s; i < e; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) {
          const x = tri[t * 9 + k * 3], y = tri[t * 9 + k * 3 + 1], z = tri[t * 9 + k * 3 + 2];
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        const x = cen[t * 3], y = cen[t * 3 + 1], z = cen[t * 3 + 2];
        if (x < cx0) cx0 = x; if (x > cx1) cx1 = x;
        if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
        if (z < cz0) cz0 = z; if (z > cz1) cz1 = z;
      }
      box.push(x0, y0, z0, x1, y1, z1);
      kid.push(-1, -1);
      span.push(s, e - s);
      if (e - s <= LEAF) return id;
      // Tách theo trục dài nhất của tâm tam giác, tại trung vị (sắp một đoạn con của order)
      const dx = cx1 - cx0, dy = cy1 - cy0, dz = cz1 - cz0;
      const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;
      if (Math.max(dx, dy, dz) <= 0) return id; // mọi tâm trùng nhau → để thành lá
      const mid = (s + e) >> 1;
      select(order, cen, axis, s, e - 1, mid);
      const l = build(s, mid);
      const r = build(mid, e);
      kid[id * 2] = l;
      kid[id * 2 + 1] = r;
      return id;
    };
    if (T > 0) build(0, T);

    this.tri = tri;
    this.order = order;
    this.box = new Float32Array(box);
    this.kid = new Int32Array(kid);
    this.span = new Uint32Array(span);
    this.triangles = T;
    /** Ngăn xếp duyệt cấp sẵn (độ sâu ~log2(T/8) ≪ 64). */
    this.stack = new Int32Array(128);
  }

  /**
   * Tham số t nhỏ nhất (theo hướng đã chuẩn hoá của tia) mà tia cắt một tam giác, hoặc −1.
   * @param {import('three').Ray} ray tia trong hệ toạ độ của geometry, hướng đã chuẩn hoá
   * @param {number} side material.side (FrontSide / BackSide / DoubleSide)
   */
  raycast(ray, side) {
    if (!this.triangles) return -1;
    const o = ray.origin, d = ray.direction;
    const ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z;
    const { box, kid, span, tri, order, stack } = this;
    let best = Infinity;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const nd = stack[--sp];
      // Tia cắt hộp của nút ở khoảng [tn, tf]; bỏ nút nếu trượt hoặc xa hơn điểm trúng tốt nhất
      const b = nd * 6;
      let t1 = (box[b] - o.x) * ix, t2 = (box[b + 3] - o.x) * ix;
      let tn = Math.min(t1, t2), tf = Math.max(t1, t2);
      t1 = (box[b + 1] - o.y) * iy; t2 = (box[b + 4] - o.y) * iy;
      tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
      t1 = (box[b + 2] - o.z) * iz; t2 = (box[b + 5] - o.z) * iz;
      tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
      // NaN (gốc tia nằm đúng mặt hộp, hướng song song) → không loại, để phép thử tam giác quyết định
      if (tf < 0 || tn > tf || tn > best) continue;
      const k = nd * 2;
      if (kid[k] < 0) {
        const s = span[k], cnt = span[k + 1];
        for (let i = s; i < s + cnt; i++) {
          const q = order[i] * 9;
          _a.set(tri[q], tri[q + 1], tri[q + 2]);
          _b.set(tri[q + 3], tri[q + 4], tri[q + 5]);
          _c.set(tri[q + 6], tri[q + 7], tri[q + 8]);
          const hit = side === BackSide
            ? ray.intersectTriangle(_c, _b, _a, true, _p)
            : ray.intersectTriangle(_a, _b, _c, side === FrontSide, _p);
          if (hit) {
            const t = _p.distanceTo(o);
            if (t < best) best = t;
          }
        }
      } else {
        stack[sp++] = kid[k];
        stack[sp++] = kid[k + 1];
      }
    }
    return best === Infinity ? -1 : best;
  }
}
