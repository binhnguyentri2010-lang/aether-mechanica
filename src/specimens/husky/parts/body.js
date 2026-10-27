// @ts-check
// Thân husky: khung ngực (chassis — gốc, không nổ), tấm yên lưng, lườn bụng, lõi năng lượng trên xương
// ức, 6 đốt sống lưng, cổ. Trục thân = Z, mặt quay về +Z. Kích thước theo spec.js (cao tính từ sàn).
import {
  Vector3, Quaternion, TorusGeometry, BoxGeometry, Sprite, SpriteMaterial,
  CanvasTexture, AdditiveBlending, SRGBColorSpace, Matrix4,
} from 'three';
import { loftZ } from '../../../model/geo/loft.js';
import { hexHead } from '../../../model/geo/fasteners.js';
import { H } from '../spec.js';
import { ellipsoid, surf, seamRing, seamLong } from './shapes.js';

/**
 * Trạm mặt cắt thân theo (z, đáy, đỉnh, bán rộng, keel): cao tính từ sàn.
 * @param {number} z @param {number} bottom @param {number} top @param {number} rx @param {number} [keel] @param {number} [n]
 * @returns {import('../../../model/geo/loft.js').Station}
 */
export const T = (z, bottom, top, rx, keel = 0.6, n = 2.2) => ({ z, cy: H((bottom + top) / 2), ry: (top - bottom) / 2, rx, keel, n });

/** Thân: đáy ngực 2.4 ở z ≈ 1.2, đỉnh vai ~5.36 (+ tấm yên → 5.4), eo thắt ở z ≈ −0.9, mông tròn. */
export const TORSO = [
  T(-2.62, 4.05, 4.75, 0.28, 0.9, 2),
  T(-2.45, 3.55, 5.0, 0.46, 0.8),
  T(-2.1, 3.2, 5.12, 0.52, 0.7),
  T(-1.6, 3.1, 5.15, 0.52, 0.62),
  T(-0.9, 3.2, 5.1, 0.52, 0.6),
  T(-0.2, 2.85, 5.12, 0.56, 0.58),
  T(0.5, 2.5, 5.22, 0.6, 0.55),
  T(1.2, 2.4, 5.36, 0.6, 0.55),
  T(1.8, 2.5, 5.3, 0.58, 0.58),
  T(2.2, 2.9, 5.05, 0.5, 0.62),
  T(2.45, 3.35, 4.7, 0.38, 0.7),
  T(2.58, 3.75, 4.35, 0.2, 0.8, 2),
];

/** Tấm yên phủ lưng: dải góc quanh đỉnh (π ± SADDLE). */
const SADDLE = 1.1;
const COVER_OFF = 0.035;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,196,128,1)');
  grd.addColorStop(0.2, 'rgba(255,160,80,0.5)');
  grd.addColorStop(0.5, 'rgba(255,130,50,0.1)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function* buildChassis(ctx) {
  // ── Chassis (gốc: mọi part khác tách ra khỏi nó) ─────────────────────────────────────────────
  const chassis = ctx.top(ctx.part('chassis', 'chassis'));
  ctx.mesh(chassis, loftZ(TORSO, { radial: 56, sub: 5, capStart: true, capEnd: true }), 'steel');
  yield; // bước dựng nhỏ (đo thật: cả khối thân trong một bước = 22 ms, vượt ngân sách 6 ms/khung)
  const seams = [];
  for (const z of [-2.2, -1.05, 0.15, 2.05]) seams.push(seamRing(TORSO, z, 0.018, 0.008));
  for (const s of [1, -1]) seams.push(seamLong(TORSO, Math.PI / 2 * (s > 0 ? 1 : 3) + s * 0.22, -2.3, 2.2, 0.014, 0.008));
  ctx.merge(chassis, 'brass', seams);
  yield;
  // Lá thông gió sau vai, hai bên sườn
  const vents = [];
  for (const s of [1, -1])
    for (let i = 0; i < 4; i++) {
      const { p, n } = surf(TORSO, -0.55 + i * 0.22, Math.PI / 2 * (s > 0 ? 1 : 3) - s * 0.12, 0.004);
      const b = new BoxGeometry(0.02, 0.5, 0.07);
      b.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), n));
      b.translate(p.x, p.y, p.z);
      vents.push(b);
    }
  ctx.merge(chassis, 'carbon', vents);
  chassis.anchor = surf(TORSO, 0.1, Math.PI / 2 + 0.05, 0.01).p;
  yield;

  // ── Saddle plate (tấm yên — mảng tối trên lưng husky) ─────────────────────────────────────────
  const cover = ctx.top(ctx.part('cover', 'cover')).explode(0, 1, 0, 1.25, 0.08);
  const z0 = -2.21, z1 = 1.98;
  ctx.mesh(cover, loftZ(TORSO, { radial: 36, sub: 5, a0: Math.PI - SADDLE, a1: Math.PI + SADDLE, offset: COVER_OFF, z0, z1 }), 'shell', { doubleSide: true });
  yield;
  const trim = [
    seamLong(TORSO, Math.PI - SADDLE, z0, z1, 0.016, COVER_OFF + 0.004),
    seamLong(TORSO, Math.PI + SADDLE, z0, z1, 0.016, COVER_OFF + 0.004),
    seamRing(TORSO, z0 + 0.01, 0.016, COVER_OFF + 0.004, Math.PI - SADDLE, Math.PI + SADDLE),
    seamRing(TORSO, z1 - 0.01, 0.016, COVER_OFF + 0.004, Math.PI - SADDLE, Math.PI + SADDLE),
  ];
  ctx.merge(cover, 'brass', trim);
  yield;
  /** @type {{p: Vector3, n: Vector3}[]} */
  const cb = [];
  for (const phi of [Math.PI - SADDLE + 0.07, Math.PI + SADDLE - 0.07])
    for (let i = 0; i < 7; i++) cb.push(surf(TORSO, -2.0 + i * 0.62, phi, COVER_OFF + 0.006));
  ctx.bolts(cover, 'azure', cb, hexHead(0.022, 0.012));
  yield;

  // ── Ventral keel ─────────────────────────────────────────────────────────────────────────────
  const belly = ctx.top(ctx.part('belly', 'belly')).explode(0, -1, 0.1, 0.5, 0.1);
  ctx.mesh(belly, loftZ(TORSO, { radial: 16, sub: 5, a0: -0.62, a1: 0.62, offset: 0.028, z0: -0.19, z1: 2.1 }), 'carbon', { doubleSide: true });
  /** @type {{p: Vector3, n: Vector3}[]} */
  const bb = [];
  for (const phi of [-0.5, 0.5]) for (let i = 0; i < 5; i++) bb.push(surf(TORSO, 0.0 + i * 0.48, phi, 0.034));
  ctx.bolts(belly, 'brass', bb, hexHead(0.018, 0.01));
  yield;

  // ── Power cell trên xương ức (nhìn thấy từ trước và từ ISO) ──────────────────────────────────
  const coreAt = new Vector3(0, H(3.8), 2.46);
  const face = new Vector3(0, -0.32, 1).normalize();
  const core = ctx.top(ctx.part('core', 'core')).at(coreAt.x, coreAt.y, coreAt.z).explode(0, 0.35, 1, 1.05, 0.15);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), face);
  const dome = ellipsoid(0.2, 0.2, 0.1, 0, 0, 0.02, 28, 18);
  dome.applyQuaternion(q);
  ctx.mesh(core, dome, 'amber');
  const bezel = [];
  const ring = new TorusGeometry(0.235, 0.035, 10, 48);
  ring.applyQuaternion(q);
  bezel.push(ring);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const tooth = new BoxGeometry(0.05, 0.05, 0.05);
    tooth.translate(Math.cos(a) * 0.29, Math.sin(a) * 0.29, -0.01);
    tooth.applyQuaternion(q);
    bezel.push(tooth);
  }
  ctx.merge(core, 'brass', bezel);
  core.anchor = face.clone().multiplyScalar(0.12).add(new Vector3(0, 0.2, 0));
  const glowMat = new SpriteMaterial({
    map: glowTexture(), color: 0xffffff, blending: AdditiveBlending, depthWrite: false,
    transparent: true, toneMapped: false, opacity: 0.8,
  });
  const glow = new Sprite(glowMat);
  glow.scale.setScalar(0.95);
  glow.position.copy(face).multiplyScalar(0.12);
  core.pivot.add(glow);
  yield;

  // ── 6 đốt sống lưng trên tấm yên ─────────────────────────────────────────────────────────────
  /** @type {import('../../../model/Part.js').Part[]} */
  const spine = [];
  for (let i = 0; i < 6; i++) {
    const z = 0.72 - i * 0.55;
    const { p } = surf(TORSO, z, Math.PI, COVER_OFF + 0.01);
    const ahead = surf(TORSO, z + 0.05, Math.PI, COVER_OFF + 0.01).p;
    const pitch = Math.atan2(ahead.y - p.y, 0.05); // độ dốc lưng tại đốt này
    const seg = ctx.top(ctx.part('spine', 'spine.' + i)).at(p.x, p.y, p.z).explode(0, 1, 0, 0.55 + i * 0.05, 0.12 + i * 0.03);
    const tilt = new Matrix4().makeRotationX(-pitch);
    const base = ellipsoid(0.2, 0.055, 0.19, 0, 0.02, 0, 20, 10);
    base.applyMatrix4(tilt);
    const key = new BoxGeometry(0.07, 0.07, 0.24);
    key.translate(0, 0.08, 0);
    key.applyMatrix4(tilt);
    ctx.mesh(seg, base, 'brass');
    ctx.mesh(seg, key, 'shell');
    seg.anchor = new Vector3(0, 0.12, 0);
    spine.push(seg);
    yield;
  }

  // ── Cổ (Cervical coupling): loft theo trục riêng nghiêng 39° lên trước ──────────────────────
  const neckBase = new Vector3(0, H(4.55), 1.75);
  const neckTilt = new Matrix4().makeRotationX(-39 * Math.PI / 180);
  const neck = ctx.top(ctx.part('neck', 'neck')).at(neckBase.x, neckBase.y, neckBase.z).explode(0, 0.5, 1, 0.5, 0.05);
  /** @type {import('../../../model/geo/loft.js').Station[]} */
  const NECK = [
    { z: 0, cy: 0, rx: 0.5, ry: 0.64, n: 2.2 },
    { z: 0.4, cy: 0, rx: 0.44, ry: 0.55, n: 2.2 },
    { z: 0.8, cy: 0, rx: 0.38, ry: 0.47, n: 2.2 },
    { z: 1.2, cy: 0, rx: 0.35, ry: 0.43, n: 2.2 },
    { z: 1.5, cy: 0, rx: 0.33, ry: 0.4, n: 2.2 },
  ];
  const ng = loftZ(NECK, { radial: 40, sub: 4 });
  ng.applyMatrix4(neckTilt);
  ctx.mesh(neck, ng, 'steel');
  const collars = [];
  for (const z of [0.5, 0.82, 1.12]) {
    const c = seamRing(NECK, z, 0.032, 0.012);
    c.applyMatrix4(neckTilt);
    collars.push(c);
  }
  ctx.merge(neck, 'brass', collars);
  neck.anchor = new Vector3(0.42, 0, 0.55).applyMatrix4(neckTilt);
  yield;

  return { chassis, cover, belly, core, glow, glowMat, spine, neck };
}

// Dùng lại trong test kích thước (§6)
export { SADDLE, COVER_OFF };
