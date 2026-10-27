// @ts-check
// Bốn chân husky. Mỗi chân là một CHUỖI part lồng nhau, mỗi part một bậc tự do quay quanh X:
//
//   actuator (tấm vai/hông + tang trống, gắn cứng vào thân)
//    └ upper   (humerus/thigh)   pivot.rotation.x = −ψ1            gốc tại khớp vai/hông
//       └ lower (forearm/shank)  pivot.rotation.x = −(ψ2 − ψ1)      gốc tại khuỷu/gối (0, −L1, 0)
//          └ paw                 pivot.rotation.x = flex − ρ + ψ2    gốc tại cổ chân/hock (0, −L2, 0)
//
// ψ theo quy ước motion/ik.js. Tư thế BIND dựng bằng CHÍNH hàm IK mà TrotRig dùng (đích trung tính:
// cổ chân thẳng dưới khớp gốc) → hình học và chuyển động không thể lệch nhau.
// Hình học chi dựng dọc −Y trong hệ riêng; bàn chân dựng ở hệ "thẳng theo W" (đế song song sàn).
import { Vector3, LatheGeometry, Vector2, Group, CylinderGeometry, SphereGeometry } from 'three';
import { loftZ } from '../../../model/geo/loft.js';
import { rodBetween } from '../../../model/geo/tube.js';
import { solveIK2, ik2 } from '../../../motion/ik.js';
import { H, LEGS } from '../spec.js';
import { TORSO } from './body.js';
import { latheY, ellipsoid, ball, hoop, drumX, claw, seamLong, seamRing } from './shapes.js';

/** Góc bind của một chân. @param {import('../spec.js').LegSpec} leg */
export function bindAngles(leg) {
  return solveIK2(H(leg.rootH), leg.rootZ, H(leg.ankle[0]), leg.rootZ, leg.L1, leg.L2, leg.pole, ik2());
}

/** Rx(a)·v (quay quanh X) — đổi hướng nổ từ hệ W sang hệ đã quay của part cha. @param {number} a @param {number} x @param {number} y @param {number} z */
const rx = (a, x, y, z) => new Vector3(x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a));

/**
 * Piston vắt qua khớp giữa: xi-lanh gắn vào đoạn trên tại P1, cần gắn vào đoạn dưới tại P2; mỗi khung
 * solvePiston() quay hai nửa hướng vào nhau (0 cấp phát). Hành trình hợp lệ [min, max] (test §6).
 * @param {import('../../../model/MechanicalModel.js').BuildContext} ctx
 * @param {import('../../../model/Part.js').Part} upper @param {import('../../../model/Part.js').Part} lower
 * @param {Vector3} P1 hệ upper.pivot @param {Vector3} P2 hệ lower.pivot
 */
function buildPiston(ctx, upper, lower, P1, P2) {
  const barrel = new Group();
  barrel.position.copy(P1);
  upper.pivot.add(barrel);
  const rod = new Group();
  rod.position.copy(P2);
  lower.pivot.add(rod);
  const pis = { barrel, rod, P1, P2, Lb: 0, Lr: 0, min: 0, max: 0, span: 0, span0: 0 };
  solvePiston(pis, lower);
  const s0 = pis.span;
  pis.span0 = s0;
  pis.Lb = 0.62 * s0;
  pis.Lr = 0.62 * s0;
  pis.min = pis.Lr + 0.03; // đầu cần không được thò ra khỏi gốc xi-lanh
  pis.max = pis.Lb + pis.Lr - 0.06; // còn ≥ 0.06 lồng trong xi-lanh
  const bg = new CylinderGeometry(0.07, 0.07, pis.Lb, 16, 1);
  bg.translate(0, pis.Lb / 2, 0);
  const cap = new CylinderGeometry(0.09, 0.09, 0.05, 16, 1);
  cap.translate(0, 0.025, 0);
  const eye1 = new SphereGeometry(0.075, 12, 8);
  ctx.merge(upper, 'brass', [bg, cap, eye1], { parent: barrel });
  const rg = new CylinderGeometry(0.04, 0.04, pis.Lr, 12, 1);
  rg.translate(0, pis.Lr / 2, 0);
  const eye2 = new SphereGeometry(0.062, 12, 8);
  ctx.merge(lower, 'silver', [rg, eye2], { parent: rod });
  return pis;
}

/**
 * Giải piston theo tư thế hiện tại (chủ DOF "linkage", plan §5). Chỉ quay quanh X: P1, P2 cùng x = 0.
 * @param {{barrel: Group, rod: Group, P1: Vector3, P2: Vector3, span: number}} pis @param {import('../../../model/Part.js').Part} lower
 */
export function solvePiston(pis, lower) {
  const th = lower.pivot.rotation.x;
  const c = Math.cos(th), s = Math.sin(th);
  const L = lower.group.position;
  const { P1, P2 } = pis;
  // P2 trong hệ upper: L + Rx(th)·P2
  const y2 = L.y + P2.y * c - P2.z * s;
  const z2 = L.z + P2.y * s + P2.z * c;
  const dy = y2 - P1.y, dz = z2 - P1.z;
  pis.barrel.rotation.x = Math.atan2(dz, dy);
  // P1 trong hệ lower: Rx(−th)·(P1 − L)
  const qy = P1.y - L.y, qz = P1.z - L.z;
  const y1 = qy * c + qz * s, z1 = -qy * s + qz * c;
  pis.rod.rotation.x = Math.atan2(z1 - P2.z, y1 - P2.y);
  pis.span = Math.hypot(dy, dz);
}

/** Bàn chân trước: đế tại (0, −0.62, +0.08) so với cổ chân. Điểm thấp nhất đúng bằng đế. */
function frontPaw() {
  const Y = -0.62;
  const steel = [
    rodBetween(new Vector3(0, -0.02, 0), new Vector3(0, -0.4, 0.06), 0.11, 14, 0.125),
    ellipsoid(0.23, 0.13, 0.29, 0, -0.475, 0.13),
  ];
  const brass = [ball(0.135, 0, 0, 0, 16)];
  const carbon = [ellipsoid(0.16, 0.03, 0.14, 0, Y + 0.03, 0.07, 18, 8)];
  for (let k = 0; k < 4; k++) {
    const x = (k - 1.5) * 0.11;
    const z = 0.33 + (k === 1 || k === 2 ? 0.04 : 0);
    steel.push(ellipsoid(0.068, 0.075, 0.085, x, Y + 0.075, z, 14, 10));
    carbon.push(ellipsoid(0.05, 0.022, 0.052, x, Y + 0.022, z, 12, 6));
    brass.push(claw(new Vector3(x, Y + 0.055, z + 0.08), new Vector3(0, -0.5, 1), 0.025, 0.08));
  }
  return { steel, brass, carbon };
}

/** Bàn chân sau (gồm xương bàn từ hock): đế tại (0, −1.0, +0.18) so với hock. */
function hindPaw() {
  const Y = -1.0;
  const steel = [
    rodBetween(new Vector3(0, -0.04, 0), new Vector3(0, -0.8, 0.12), 0.12, 14, 0.125),
    ellipsoid(0.23, 0.13, 0.29, 0, -0.865, 0.24),
  ];
  const brass = [ball(0.145, 0, 0, 0, 16), ellipsoid(0.085, 0.12, 0.085, 0, 0.02, -0.12, 12, 8)];
  const carbon = [ellipsoid(0.16, 0.03, 0.14, 0, Y + 0.03, 0.18, 18, 8)];
  for (let k = 0; k < 4; k++) {
    const x = (k - 1.5) * 0.11;
    const z = 0.44 + (k === 1 || k === 2 ? 0.04 : 0);
    steel.push(ellipsoid(0.068, 0.075, 0.085, x, Y + 0.075, z, 14, 10));
    carbon.push(ellipsoid(0.05, 0.022, 0.052, x, Y + 0.022, z, 12, 6));
    brass.push(claw(new Vector3(x, Y + 0.055, z + 0.08), new Vector3(0, -0.5, 1), 0.025, 0.08));
  }
  return { steel, brass, carbon };
}

/**
 * Dải z của tấm ốp vai/hông — chọn TRÙNG vòng lưới loft của TORSO (sub = 5): trạm 0.5→1.2 bước 0.14
 * (…1.06, 1.2), 1.2→1.8 bước 0.12 (…1.68); −2.45→−2.1 bước 0.07 (−2.24…), −1.6→−0.9 bước 0.14 (−1.46).
 */
const FLANK = { front: /** @type {[number, number]} */ ([1.06, 1.68]), hind: /** @type {[number, number]} */ ([-2.24, -1.46]) };

/** Dải góc của tấm ốp vai/hông (phía +X hoặc −X, từ ngang hông lên gần lưng). @param {number} s */
const flankArc = (s) => (s > 0 ? [Math.PI / 2 + 0.02, Math.PI / 2 + 0.78] : [Math.PI * 1.5 - 0.78, Math.PI * 1.5 - 0.02]);

/** Tấm ốp bên hông/vai trên mặt thân (bám đúng vỏ). @param {number} s @param {number} z0 @param {number} z1 @param {Vector3} origin */
function flankPlate(s, z0, z1, origin) {
  const [a0, a1] = flankArc(s);
  const g = loftZ(TORSO, { radial: 12, sub: 5, a0, a1, offset: 0.06, z0, z1 });
  g.translate(-origin.x, -origin.y, -origin.z);
  return g;
}

/** Viền vàng quanh tấm ốp (4 cạnh) — gộp vào mesh vàng của actuator. @param {number} s @param {number} z0 @param {number} z1 @param {Vector3} origin */
function flankTrim(s, z0, z1, origin) {
  const [a0, a1] = flankArc(s);
  // z0, z1 TRÙNG vòng lưới của loft (xem FLANK) → viền nằm đúng trên cạnh tấm
  const out = [
    seamLong(TORSO, a0, z0, z1, 0.016, 0.066), seamLong(TORSO, a1, z0, z1, 0.016, 0.066),
    seamRing(TORSO, z0, 0.016, 0.066, a0, a1), seamRing(TORSO, z1, 0.016, 0.066, a0, a1),
  ];
  for (const g of out) g.translate(-origin.x, -origin.y, -origin.z);
  return out;
}

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function* buildLegs(ctx) {
  /**
   * @type {{
   *   spec: import('../spec.js').LegSpec, actuator: import('../../../model/Part.js').Part,
   *   upper: import('../../../model/Part.js').Part, lower: import('../../../model/Part.js').Part,
   *   paw: import('../../../model/Part.js').Part, piston: ReturnType<typeof buildPiston>,
   *   bind: {psi1: number, psi2: number}, root: Vector3,
   * }[]}
   */
  const legs = [];
  for (const L of LEGS) {
    const s = L.side;
    const tag = L.id.toLowerCase();
    const root = new Vector3(s * L.x, H(L.rootH), L.rootZ);
    const b = bindAngles(L);
    const side = s > 0 ? 'l' : 'r';

    // ── Actuator: tấm ốp + tang trống ở khớp gốc ───────────────────────────────────────────────
    const act = ctx.top(ctx.part(L.front ? 'shoulder' : 'hip', (L.front ? 'shoulder.' : 'hip.') + side))
      .at(root.x, root.y, root.z).explode(s, 0.15, 0, 0.55, 0.1);
    const dr = L.front ? { r: 0.24, x0: 0.6, x1: 0.83 } : { r: 0.28, x0: 0.57, x1: 0.82 };
    const dc = (dr.x0 + dr.x1) / 2 - L.x;
    ctx.mesh(act, drumX(dr.r, dr.x1 - dr.x0, s * dc, 0, 0, 36), 'plate');
    const capX = dr.x1 + 0.0125 - L.x;
    const capParts = [drumX(dr.r * 0.58, 0.025, s * capX, 0, 0, 28)];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      capParts.push(drumX(0.022, 0.03, s * (dr.x1 - L.x), Math.cos(a) * dr.r * 0.78, Math.sin(a) * dr.r * 0.78, 6));
    }
    const [fz0, fz1] = L.front ? FLANK.front : FLANK.hind;
    ctx.merge(act, 'brass', [...capParts, ...flankTrim(s, fz0, fz1, root)]);
    ctx.mesh(act, flankPlate(s, fz0, fz1, root), 'shell', { doubleSide: true });
    act.anchor = new Vector3(s * (capX + 0.01), 0, 0);
    yield;

    // ── Đoạn trên ──────────────────────────────────────────────────────────────────────────────
    const upper = act.add(ctx.part(L.front ? 'humerus' : 'thigh', (L.front ? 'humerus.' : 'thigh.') + tag)).explode(s, 0, 0, 0.42, 0.15);
    upper.pivot.rotation.x = -b.psi1;
    if (L.front) {
      ctx.mesh(upper, latheY([[0.19, 0.12], [0.21, 0.02], [0.21, -0.22], [0.19, -0.6], [0.165, -1.2], [0.15, -1.55], [0.155, -1.72]], 22, 0.8), 'steel');
      ctx.merge(upper, 'brass', [hoop(0.205, 0.02, -0.3, 0.8), hoop(0.155, 0.018, -1.45, 0.8)]);
      upper.anchor = new Vector3(s * 0.12, -0.8, 0.1);
    } else {
      const prof = /** @type {[number, number][]} */ ([[0.22, 0.14], [0.25, 0.02], [0.25, -0.3], [0.22, -0.8], [0.19, -1.3], [0.17, -1.65], [0.17, -1.82]]);
      ctx.mesh(upper, latheY(prof, 22, 0.8), 'steel');
      // Tấm ốp mặt ngoài đùi (mảng lông tối)
      const pts = prof.slice(1, 5).reverse().map(([r, y]) => new Vector2(r * 1.06, y));
      const plate = new LatheGeometry(pts, 10, s > 0 ? Math.PI / 2 - 0.85 : Math.PI * 1.5 - 0.85, 1.7);
      plate.scale(0.8, 1, 1);
      ctx.mesh(upper, plate, 'shell', { doubleSide: true });
      ctx.merge(upper, 'brass', [hoop(0.255, 0.022, -0.08, 0.8), hoop(0.175, 0.018, -1.6, 0.8)]);
      upper.anchor = new Vector3(s * 0.17, -0.7, 0.05);
    }
    yield;

    // ── Đoạn dưới ──────────────────────────────────────────────────────────────────────────────
    const lower = upper.add(ctx.part(L.front ? 'forearm' : 'shank', (L.front ? 'forearm.' : 'shank.') + tag))
      .at(0, -L.L1, 0).explode(s, 0, 0, 0.36, 0.2);
    lower.pivot.rotation.x = -(b.psi2 - b.psi1);
    if (L.front) {
      ctx.mesh(lower, latheY([[0.15, 0.05], [0.15, -0.18], [0.13, -0.8], [0.12, -1.4], [0.125, -1.6], [0.125, -1.7]], 18, 0.9), 'steel');
      ctx.merge(lower, 'brass', [ball(0.185, 0, 0, 0, 20), hoop(0.125, 0.016, -1.52, 0.9)]);
      lower.anchor = new Vector3(s * 0.09, -0.85, 0.06);
    } else {
      ctx.mesh(lower, latheY([[0.16, 0.05], [0.15, -0.25], [0.125, -1.0], [0.115, -1.6], [0.115, -1.9]], 18, 0.9), 'steel');
      ctx.merge(lower, 'brass', [ball(0.2, 0, 0, 0, 20), hoop(0.117, 0.016, -1.72, 0.9)]);
      lower.anchor = new Vector3(s * 0.09, -0.95, -0.04);
    }

    // ── Piston vắt qua khuỷu (phía TRƯỚC — trong góc khuỷu) / gối (phía SAU — trong góc gối) ─────
    const piston = L.front
      ? buildPiston(ctx, upper, lower, new Vector3(0, -0.45, 0.25), new Vector3(0, -0.42, 0.19))
      : buildPiston(ctx, upper, lower, new Vector3(0, -0.5, -0.27), new Vector3(0, -0.5, -0.19));
    yield;

    // ── Bàn chân (hệ thẳng theo W ở bind: θ = ψ2) ─────────────────────────────────────────────
    const pdir = rx(b.psi2, s * 0.35, 0, L.front ? 0.6 : -0.6);
    const paw = lower.add(ctx.part('paw', 'paw.' + tag)).at(0, -L.L2, 0).explode(pdir.x, pdir.y, pdir.z, 0.45, 0.25);
    paw.pivot.rotation.x = b.psi2;
    const pg = L.front ? frontPaw() : hindPaw();
    ctx.merge(paw, 'steel', pg.steel);
    ctx.merge(paw, 'brass', pg.brass);
    ctx.merge(paw, 'carbon', pg.carbon);
    paw.anchor = L.front ? new Vector3(s * 0.1, -0.5, 0.33) : new Vector3(s * 0.1, -0.88, 0.44);
    yield;

    legs.push({ spec: L, actuator: act, upper, lower, paw, piston, bind: { psi1: b.psi1, psi2: b.psi2 }, root });
  }
  return legs;
}
