// @ts-check
// IK HAI ĐOẠN trong mặt phẳng dọc (y, z) của một chân (plan đợt 3 §6). Nghiệm giải tích, KHÔNG cấp
// phát: ghi vào object `out` do người gọi giữ.
//
// Quy ước góc ψ: đo từ phương −Y (thẳng xuống), dương khi ngả về +Z (phía trước).
//   hướng đoạn = (y, z) = (−cos ψ, sin ψ)
//   node quay quanh X với rotation.x = θ đưa (0, −1, 0) thành (0, −cos θ, −sin θ) → θ = −ψ.
// pole = −1: khớp giữa lệch về −Z (khuỷu chân trước); +1: lệch về +Z (gối chân sau).

/** Biên an toàn của tầm với: |L1 − L2| + ε ≤ d ≤ L1 + L2 − ε (plan §6). */
export const REACH_EPS = 0.05;

/**
 * @typedef {{
 *   psi1: number, psi2: number, midY: number, midZ: number,
 *   d: number, clamped: boolean, inner: number,
 * }} IK2
 */

/** @returns {IK2} */
export const ik2 = () => ({ psi1: 0, psi2: 0, midY: 0, midZ: 0, d: 0, clamped: false, inner: 0 });

/**
 * @param {number} ry @param {number} rz gốc (vai/hông)
 * @param {number} ty @param {number} tz đích (cổ chân / khớp hock)
 * @param {number} L1 @param {number} L2 @param {number} pole ±1
 * @param {IK2} out
 */
export function solveIK2(ry, rz, ty, tz, L1, L2, pole, out) {
  const vy = ty - ry;
  const vz = tz - rz;
  const d = Math.hypot(vy, vz);
  const dMin = Math.abs(L1 - L2) + REACH_EPS;
  const dMax = L1 + L2 - REACH_EPS;
  out.clamped = d < dMin || d > dMax;
  const dc = Math.min(dMax, Math.max(dMin, d));
  const psiT = Math.atan2(vz, -vy);
  const cosA = (L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const psi1 = psiT + pole * alpha;
  const my = ry - L1 * Math.cos(psi1);
  const mz = rz + L1 * Math.sin(psi1);
  // Đích thực dùng (trùng đích nếu không phải kẹp): trên tia gốc→đích, cách gốc dc
  const k = d > 1e-9 ? dc / d : 0;
  const ey = ry + vy * k;
  const ez = rz + vz * k;
  out.psi1 = psi1;
  out.psi2 = Math.atan2(ez - mz, -(ey - my));
  out.midY = my;
  out.midZ = mz;
  out.d = d;
  out.inner = Math.PI - Math.abs(out.psi2 - psi1);
  return out;
}
