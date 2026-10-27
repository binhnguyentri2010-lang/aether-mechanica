// @ts-check
// Articulated spine: 8 đốt thon dần trên khớp cầu + caudal stabilizer.
// Explode kiểu accordion về −Z. Mọi đốt nằm trong |x| < 0.2 (ngoài vùng quét cánh).
import {
  TorusGeometry, SphereGeometry, BoxGeometry, ConeGeometry, ExtrudeGeometry, Shape, Vector3,
  CylinderGeometry,
} from 'three';
import { latheZ } from '../../../model/geo/lathe.js';
import { sampleCurve } from '../../../model/geo/curve.js';

// step/tailExtra đã rút từ 0.17/0.55 sau khi xem thật: spine văng quá xa làm camera phải lùi
// tới zoom 0.64 và cả cỗ máy trông nhỏ ở trạng thái EXPLODED.
export const SPINE = { count: 8, z0: -0.76, pitch: 0.235, step: 0.1, tailExtra: 0.35 };

/** @param {number} i */
export const segY = (i) => -0.008 * i - 0.002 * i * i;
/** @param {number} i */
export const segR = (i) => 0.19 - i * 0.016;

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function buildSpine(ctx) {
  /** @type {import('../../../model/Part.js').Part[]} */
  const segs = [];
  for (let i = 0; i < SPINE.count; i++) {
    const r = segR(i);
    const z = SPINE.z0 - i * SPINE.pitch;
    const p = ctx.top(ctx.part('spine', 'spine-' + i)).at(0, segY(i), z)
      .explode(0, -0.04, -1, SPINE.step * (i + 1), 0.05 * i);
    const prof = sampleCurve([
      [r * 0.6, -0.1], [r * 0.9, -0.088], [r, -0.045], [r, 0.03], [r * 0.93, 0.076], [r * 0.7, 0.1],
    ], 0.012);
    ctx.mesh(p, latheZ(prof, 40), 'steel');
    const brass = [];
    const band = new TorusGeometry(r * 1.004, 0.0055, 4, 40);
    band.translate(0, 0, -0.02);
    brass.push(band);
    const ball = new SphereGeometry(Math.max(0.05, r * 0.5), 20, 14);
    ball.translate(0, 0, 0.113);
    brass.push(ball);
    ctx.merge(p, 'brass', brass);
    const plate = new BoxGeometry(0.03, 0.012, 0.12);
    plate.translate(0, r * 0.985, -0.005);
    ctx.mesh(p, plate, 'carbon');
    const bolts = [];
    for (const s of [1, -1]) {
      const b = new CylinderGeometry(0.01, 0.01, 0.008, 6);
      b.rotateZ(Math.PI / 2);
      b.translate(s * (r + 0.002), 0, 0.01);
      bolts.push(b);
    }
    ctx.merge(p, 'azure', bolts);
    if (i === 3) p.anchor = new Vector3(-r * 0.97, r * 0.25, 0);
    segs.push(p);
  }

  // ── Caudal stabilizer ────────────────────────────────────────────────────────────────────────
  const last = SPINE.count - 1;
  const zc = SPINE.z0 - last * SPINE.pitch - 0.15;
  const tail = ctx.top(ctx.part('caudal', 'caudal')).at(0, segY(last) - 0.01, zc)
    .explode(0, -0.04, -1, SPINE.step * SPINE.count + SPINE.tailExtra, 0.35);
  const cone = new ConeGeometry(0.062, 0.44, 28);
  cone.rotateX(-Math.PI / 2);
  cone.translate(0, 0, -0.22);
  ctx.mesh(tail, cone, 'carbon');
  const br = [];
  const col = new TorusGeometry(0.064, 0.009, 8, 32);
  br.push(col);
  const ball = new SphereGeometry(0.042, 16, 12);
  ball.translate(0, 0, 0.045);
  br.push(ball);
  ctx.merge(tail, 'brass', br);
  const fins = [];
  const fs = new Shape();
  fs.moveTo(0.0, -0.04);
  fs.lineTo(0.17, -0.2);
  fs.lineTo(0.16, -0.33);
  fs.lineTo(0.0, -0.24);
  fs.closePath();
  for (const a of [0.96, Math.PI - 0.96]) {
    const f = new ExtrudeGeometry(fs, { depth: 0.008, bevelEnabled: false });
    f.translate(0, 0, -0.004);
    f.rotateX(Math.PI / 2); // hình nằm trong mặt XZ, y của shape → z thế giới
    f.rotateZ(a);
    fins.push(f);
  }
  ctx.merge(tail, 'steel', fins);
  tail.anchor = new Vector3(0, 0, -0.36);

  return { segs, tail };
}
