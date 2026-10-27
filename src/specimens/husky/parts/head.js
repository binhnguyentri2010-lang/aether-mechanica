// @ts-check
// Đầu husky: hộp sọ (mặt trắng + mũ tối kiểu husky), mõm, cảm biến mũi, hai mắt, hai tai dựng, hàm có
// khớp. Đỉnh đầu 6.1, đỉnh tai 7.0, mũi (cao 5.0, z 4.2) — theo spec.js. Toàn bộ đầu gật quanh khớp
// cổ–đầu (pivot của skull); tai, mắt, hàm, mũi là part con nên gật theo.
import { Vector3, Quaternion, Shape, ExtrudeGeometry, TorusGeometry } from 'three';
import { loftZ, loftPoint } from '../../../model/geo/loft.js';
import { H } from '../spec.js';
import { ellipsoid, seamRing, seamLong } from './shapes.js';

/**
 * @param {number} z @param {number} bottom @param {number} top @param {number} rx @param {number} [n] @param {number} [keel]
 * @returns {import('../../../model/geo/loft.js').Station}
 */
const K = (z, bottom, top, rx, n = 2.3, keel = 0.8) => ({ z, cy: H((bottom + top) / 2), ry: (top - bottom) / 2, rx, n, keel });

/** Hộp sọ + mõm trên. Đáy mõm = 4.9 (đường môi); hàm nằm dưới đường này. */
export const HEAD = [
  K(2.7, 5.12, 5.78, 0.34),
  K(2.88, 4.92, 6.0, 0.46),
  K(3.12, 4.82, 6.1, 0.52),
  K(3.38, 4.84, 6.03, 0.5),
  K(3.58, 4.88, 5.8, 0.42),
  K(3.76, 4.9, 5.52, 0.31),
  K(3.96, 4.91, 5.36, 0.25),
  K(4.1, 4.92, 5.26, 0.2, 2.6, 0.9),
];

/** Hàm dưới: đỉnh 4.88 < đáy mõm 4.9 → khép kín không chạm; chỉ mở XUỐNG. */
export const JAW = [
  K(3.12, 4.68, 4.88, 0.3, 2.4, 0.7),
  K(3.4, 4.6, 4.88, 0.3, 2.4, 0.7),
  K(3.7, 4.64, 4.88, 0.24, 2.4, 0.7),
  K(3.94, 4.72, 4.88, 0.17, 2.4, 0.7),
  K(4.05, 4.77, 4.875, 0.12, 2.4, 0.7),
];

const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Khớp gật đầu (cổ–đầu) và khớp hàm, toạ độ root. */
export const HEAD_JOINT = new Vector3(0, H(5.4), 2.85);
export const JAW_HINGE = new Vector3(0, H(4.88), 3.2);
/** Góc mở hàm tối đa (rad) — test hàm–đầu kiểm giới hạn này. */
export const JAW_MAX = 12 * Math.PI / 180;

/**
 * Tìm góc phi trên nửa +X (π/2..π) sao cho điểm mặt loft tại z có toạ độ `axis` = v.
 * @param {import('../../../model/geo/loft.js').Station[]} st @param {number} z @param {0|1} axis 0 = x, 1 = y @param {number} v
 */
function phiWhere(st, z, axis, v) {
  let lo = Math.PI / 2, hi = Math.PI;
  const f = (/** @type {number} */ phi) => loftPoint(st, z, phi)[axis] - v;
  const sLo = Math.sign(f(lo));
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(f(mid)) === sLo) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** @param {number} s ±1 → tai trái/phải (hình tam giác cong, đỉnh bo tròn, nghiêng ra ngoài). */
function earShape(s, scale = 1, lift = 0) {
  const sh = new Shape();
  const w = 0.27 * scale, top = 1.1 * scale + lift;
  sh.moveTo(-w * s, lift);
  sh.lineTo(w * s, lift);
  sh.quadraticCurveTo(0.22 * scale * s, lift + 0.6 * scale, 0.08 * scale * s, top - 0.05 * scale);
  sh.quadraticCurveTo(0.055 * scale * s, top + 0.02 * scale, 0.025 * scale * s, top - 0.05 * scale);
  sh.quadraticCurveTo(-0.14 * scale * s, lift + 0.5 * scale, -w * s, lift);
  return sh;
}

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function* buildHead(ctx) {
  const O = HEAD_JOINT;
  const skull = ctx.top(ctx.part('skull', 'skull')).at(O.x, O.y, O.z).explode(0, 0.55, 1, 0.95, 0.05);
  const local = (/** @type {import('three').BufferGeometry} */ g) => g.translate(-O.x, -O.y, -O.z);

  ctx.mesh(skull, local(loftZ(HEAD, { radial: 48, sub: 5, capStart: true, capEnd: true })), 'steel');
  yield;
  // Mũ tối trên đỉnh đầu (mask husky): tấm ốp theo mặt sọ, dừng trước hốc mắt
  ctx.mesh(skull, local(loftZ(HEAD, { radial: 28, sub: 5, a0: Math.PI - 1.05, a1: Math.PI + 1.05, offset: 0.012, z0: 2.7, z1: 3.44 })), 'shell', { doubleSide: true });
  ctx.merge(skull, 'brass', [
    local(seamRing(HEAD, 2.78, 0.02, 0.006)),
    local(seamLong(HEAD, Math.PI, 3.44, 4.06, 0.012, 0.006)), // sống mũi
  ]);
  skull.anchor = new Vector3(0, H(6.14), 3.1).sub(O);
  yield;

  // ── Cảm biến mũi ─────────────────────────────────────────────────────────────────────────────
  const noseC = new Vector3(0, H(5.05), 4.12);
  const nose = skull.add(ctx.part('nose', 'nose')).at(noseC.x - O.x, noseC.y - O.y, noseC.z - O.z).explode(0, 0.15, 1, 0.35, 0.3);
  ctx.mesh(nose, ellipsoid(0.12, 0.095, 0.1, 0, 0, 0, 20, 12), 'carbon');
  nose.anchor = new Vector3(0, 0.05, 0.1);
  yield;

  // ── Mắt (almond, nhìn tới trước, hơi xoè ra ngoài) ───────────────────────────────────────────
  /** @type {import('../../../model/Part.js').Part[]} */
  const eyes = [];
  const zEye = 3.52;
  const phiE = phiWhere(HEAD, zEye, 1, H(5.62));
  for (const s of [1, -1]) {
    const [px, py, pz] = loftPoint(HEAD, zEye, s > 0 ? phiE : Math.PI * 2 - phiE);
    const p = new Vector3(px, py, pz);
    const facing = new Vector3(s * 0.5, 0.06, 0.86).normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), facing);
    const eye = skull.add(ctx.part('optic', s > 0 ? 'optic.l' : 'optic.r'))
      .at(p.x - O.x, p.y - O.y, p.z - O.z).explode(s, 0.2, 0.55, 0.28, 0.18);
    const lens = ellipsoid(0.1, 0.066, 0.06, 0, 0, 0, 20, 12);
    lens.rotateZ(s * 0.22);
    lens.applyQuaternion(q);
    lens.translate(facing.x * -0.012, facing.y * -0.012, facing.z * -0.012);
    ctx.mesh(eye, lens, 'optic');
    const bez = new TorusGeometry(1, 0.1, 8, 36);
    bez.scale(0.112, 0.078, 1);
    bez.rotateZ(s * 0.22);
    bez.applyQuaternion(q);
    bez.translate(facing.x * 0.012, facing.y * 0.012, facing.z * 0.012);
    ctx.mesh(eye, bez, 'brass');
    eye.anchor = facing.clone().multiplyScalar(0.06);
    eyes.push(eye);
    yield;
  }

  // ── Tai dựng ─────────────────────────────────────────────────────────────────────────────────
  /** @type {import('../../../model/Part.js').Part[]} */
  const ears = [];
  const zEar = 3.0;
  const phiEar = phiWhere(HEAD, zEar, 0, 0.3);
  for (const s of [1, -1]) {
    const [bx, by, bz] = loftPoint(HEAD, zEar, s > 0 ? phiEar : Math.PI * 2 - phiEar);
    const ear = skull.add(ctx.part('ear', s > 0 ? 'ear.l' : 'ear.r'))
      .at(bx - O.x, by - O.y, bz - O.z).explode(s * 0.45, 1, -0.1, 0.4, 0.2);
    const lean = (/** @type {import('three').BufferGeometry} */ g) => {
      g.rotateX(-0.2); // ngả ra sau
      g.rotateZ(-s * 0.17); // xoè ra ngoài
      return g;
    };
    const outer = new ExtrudeGeometry(earShape(s, 1, -0.06), { depth: 0.075, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 8 });
    outer.translate(0, 0, -0.0375);
    ctx.mesh(ear, lean(outer), 'shell');
    const inner = new ExtrudeGeometry(earShape(s, 0.64, 0.1), { depth: 0.02, bevelEnabled: false, curveSegments: 8 });
    inner.translate(0, 0, 0.052);
    ctx.mesh(ear, lean(inner), 'pearl');
    // Neo trên mặt trong của tai, xoay đúng như hình học (rotateX rồi rotateZ)
    ear.anchor = new Vector3(s * 0.05, 0.7, 0.05).applyAxisAngle(X_AXIS, -0.2).applyAxisAngle(Z_AXIS, -s * 0.17);
    ears.push(ear);
    yield;
  }

  // ── Hàm dưới ─────────────────────────────────────────────────────────────────────────────────
  const hinge = JAW_HINGE;
  const jaw = skull.add(ctx.part('jaw', 'jaw')).at(hinge.x - O.x, hinge.y - O.y, hinge.z - O.z).explode(0, -0.25, 1, 0.42, 0.25);
  const jl = (/** @type {import('three').BufferGeometry} */ g) => g.translate(-hinge.x, -hinge.y, -hinge.z);
  ctx.mesh(jaw, jl(loftZ(JAW, { radial: 32, sub: 4, capStart: true, capEnd: true })), 'steel');
  ctx.merge(jaw, 'carbon', [
    jl(seamLong(JAW, Math.PI / 2 + 0.95, 3.3, 3.98, 0.013, 0.004)),
    jl(seamLong(JAW, Math.PI * 1.5 - 0.95, 3.3, 3.98, 0.013, 0.004)),
  ]);
  jaw.anchor = new Vector3(0, H(4.62), 3.62).sub(hinge);
  yield;

  return { skull, nose, eyes, ears, jaw };
}
