// @ts-check
import { LatheGeometry, Vector2 } from 'three';

/**
 * Tiện tròn quanh trục Z (trục thân của specimen).
 * profile: [[bán kính, z], ...] theo thứ tự z tăng dần.
 * phi = 0 ở ĐÁY (−Y), phi = π ở ĐỈNH (+Y) — dùng để cắt cửa sổ nắp lưng.
 * @param {[number, number][]} profile
 * @param {number} [segments]
 * @param {number} [phiStart]
 * @param {number} [phiLength]
 */
export function latheZ(profile, segments = 56, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, z]) => new Vector2(r, z));
  const g = new LatheGeometry(pts, segments, phiStart, phiLength);
  g.rotateX(Math.PI / 2); // trục Y của lathe → trục Z
  return g;
}
