// @ts-check
// Raycast nhanh cho hover/click và kiểm tra che khuất nhãn.
//
// Đo thật trước khi tối ưu: raycast thẳng vào ~190 mesh (≈200k tam giác, phần lớn là ống gân cánh)
// tốn ~15 ms mỗi lần hover và ~83 ms mỗi lượt kiểm che khuất 16 nhãn → camera giật khi xoay.
//
// Cách làm: pha lọc bằng HỘP BAO (biến tia sang hệ toạ độ riêng của mesh, cắt với boundingBox),
// sắp theo khoảng cách vào hộp, rồi chỉ thử tam giác ở vài mesh đầu — dừng khi hộp kế tiếp đã xa hơn
// điểm trúng tốt nhất. Thử tam giác qua cây BVH của từng geometry (core/triBvh.js — dựng lần đầu mesh đó
// cần thử, rồi dùng lại); mesh có geometry đổi mỗi khung (userData.dynamic) dùng raycast của three.
// Kiểm che khuất chỉ cần hộp (không cần tam giác).
import { Ray, Matrix4, Vector3, Raycaster } from 'three';
import { TriBVH } from './triBvh.js';

const _inv = new Matrix4();
const _local = new Ray();
const _hit = new Vector3();

/** @typedef {{m: import('three').Mesh, box: import('three').Box3, d: number, bvh: TriBVH|null}} Item */
/** So sánh dùng lại (không tạo closure mỗi lần pick). @param {Item} a @param {Item} b */
const byDist = (a, b) => a.d - b.d;

export class Picker {
  /** @param {import('three').Mesh[]} meshes */
  constructor(meshes) {
    /** @type {Item[]} */
    this.items = meshes.map((m) => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      return { m, box: /** @type {import('three').Box3} */ (m.geometry.boundingBox), d: 0, bvh: null };
    });
    /** @type {typeof this.items} */
    this.cand = [];
    this._prep = 0;
    this.raycaster = new Raycaster();
    // Mesh gốc nằm ở layer 1 khi model vẽ theo lô (MechanicalModel._batchSteps) — vẫn phải pick được
    this.raycaster.layers.enableAll();
  }

  /** Mọi cây BVH đã dựng sẵn. */
  get prepared() {
    return this._prep >= this.items.length;
  }

  /**
   * Dựng sẵn cây BVH cho các mesh còn thiếu tới khi hết hạn (việc nền lúc app rảnh — SpecimenManager.tick):
   * lần hover đầu qua một part lớn khỏi phải dựng cây ngay trong khung đó (~10 ms với mesh lớn nhất).
   * @param {number} deadline performance.now() @returns {boolean} đã xong
   */
  prepare(deadline) {
    while (this._prep < this.items.length) {
      const it = this.items[this._prep++];
      if (!it.bvh && !it.m.userData.dynamic) it.bvh = new TriBVH(it.m.geometry);
      if (performance.now() >= deadline) break;
    }
    return this.prepared;
  }

  /** Khoảng cách (thế giới) từ gốc tia tới hộp của mesh, hoặc −1. @param {Ray} ray @param {typeof this.items[0]} it */
  _boxDist(ray, it) {
    _inv.copy(it.m.matrixWorld).invert();
    _local.copy(ray).applyMatrix4(_inv);
    if (!_local.intersectBox(it.box, _hit)) return -1;
    return _hit.applyMatrix4(it.m.matrixWorld).distanceTo(ray.origin);
  }

  /**
   * Mesh đầu tiên bị tia trúng (chính xác tới tam giác).
   * @param {Ray} ray
   * @returns {{object: import('three').Mesh, distance: number} | null}
   */
  first(ray) {
    const cand = this.cand;
    cand.length = 0;
    for (const it of this.items) {
      if (!it.m.visible) continue;
      const d = this._boxDist(ray, it);
      if (d < 0) continue;
      it.d = d;
      cand.push(it);
    }
    cand.sort(byDist);
    this.raycaster.ray.copy(ray);
    let best = Infinity;
    /** @type {import('three').Mesh|null} */
    let obj = null;
    for (const it of cand) {
      if (it.d > best) break;
      const d = this._triDist(ray, it);
      if (d >= 0 && d < best) {
        best = d;
        obj = it.m;
      }
    }
    return obj ? { object: obj, distance: best } : null;
  }

  /** Khoảng cách (thế giới) tới tam giác gần nhất của mesh mà tia cắt, hoặc −1. @param {Ray} ray @param {Item} it */
  _triDist(ray, it) {
    const m = it.m;
    if (m.userData.dynamic) {
      const hits = this.raycaster.intersectObject(m, false);
      return hits.length ? hits[0].distance : -1;
    }
    if (!it.bvh) it.bvh = new TriBVH(m.geometry);
    _inv.copy(m.matrixWorld).invert();
    _local.copy(ray).applyMatrix4(_inv);
    const t = it.bvh.raycast(_local, /** @type {any} */ (m.material).side);
    if (t < 0) return -1;
    // Biến đổi affine: t nhỏ nhất trên tia cục bộ = điểm gần nhất trên tia thế giới; khoảng cách đo lại ở hệ thế giới
    _hit.copy(_local.direction).multiplyScalar(t).add(_local.origin).applyMatrix4(m.matrixWorld);
    return _hit.distanceTo(ray.origin);
  }

  /**
   * Có hộp nào của mesh "che" nằm giữa gốc tia và điểm đích không.
   * Hộp nào CHỨA LUÔN điểm đích thì bỏ qua: hộp bao không phân biệt được "ở trong" với "ở sau"
   * (ví dụ hộp của vỏ ngực chứa cả servo và bản lề — tính vào sẽ làm mờ oan các nhãn đó).
   * @param {Ray} ray @param {Vector3} target @param {number} maxDist
   * @param {(m: import('three').Mesh) => boolean} isOccluder
   */
  blocked(ray, target, maxDist, isOccluder) {
    for (const it of this.items) {
      if (!it.m.visible || !isOccluder(it.m)) continue;
      const d = this._boxDist(ray, it);
      if (d < 0 || d >= maxDist) continue;
      _hit.copy(target).applyMatrix4(_inv); // _inv vẫn là nghịch đảo của mesh này (vừa tính ở _boxDist)
      if (it.box.containsPoint(_hit)) continue;
      return true;
    }
    return false;
  }
}
