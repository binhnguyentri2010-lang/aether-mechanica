// @ts-check
import { CatmullRomCurve3, Vector3 } from 'three';

/** @typedef {[number, number]} P2 */

/**
 * Lấy mẫu đường cong Catmull-Rom (centripetal) qua các điểm 2D, cách đều theo độ dài.
 * Dùng cho profile tiện tròn (thân, đầu, đốt sống, khớp nối).
 * @param {P2[]} ctrl @param {number} step khoảng cách mẫu xấp xỉ
 * @returns {P2[]}
 */
export function sampleCurve(ctrl, step = 0.02) {
  const c = new CatmullRomCurve3(ctrl.map(([u, v]) => new Vector3(u, v, 0)), false, 'centripetal');
  const n = Math.max(4, Math.round(c.getLength() / step));
  return c.getSpacedPoints(n).map((p) => /** @type {P2} */ ([p.x, p.y]));
}
