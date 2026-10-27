// @ts-check
// Thorax: vỏ tiện tròn có cửa sổ lưng, nắp kiểm tra, tấm bụng, bộ điều khiển bay, cụm bánh răng lưng.
// Trục thân = Z. Mọi thứ nằm trong |x| < 0.33 (ngoài vùng quét của cánh — plan §6).
import {
  TorusGeometry, BoxGeometry, CircleGeometry, CylinderGeometry, ExtrudeGeometry, Shape, Vector3, Group,
} from 'three';
import { latheZ } from '../../../model/geo/lathe.js';
import { sampleCurve } from '../../../model/geo/curve.js';
import { tubeThrough } from '../../../model/geo/tube.js';
import { gearGeometry } from '../../../model/geo/gear.js';
import { hexHead, ringOfBolts } from '../../../model/geo/fasteners.js';

/** Bề rộng cửa sổ lưng (radian). Nắp phủ |x| ≤ ~0.24, chừa chỗ cho servo trên hai vai. */
export const WINDOW = 1.35;

/** Profile vỏ [r, z]. */
export const HULL = sampleCurve([
  [0.15, -0.56], [0.25, -0.52], [0.31, -0.45], [0.338, -0.34], [0.346, -0.2], [0.348, 0],
  [0.346, 0.2], [0.336, 0.34], [0.31, 0.44], [0.25, 0.51], [0.15, 0.56],
], 0.02);

/** @param {number} z */
export function hullRadius(z) {
  for (let i = 1; i < HULL.length; i++) {
    if (HULL[i][1] >= z) {
      const [r0, z0] = HULL[i - 1];
      const [r1, z1] = HULL[i];
      return r0 + ((r1 - r0) * (z - z0)) / (z1 - z0 || 1);
    }
  }
  return HULL[HULL.length - 1][0];
}

/** @param {number} z0 @param {number} z1 @param {number} dr @returns {[number, number][]} */
function hullSlice(z0, z1, dr) {
  /** @type {[number, number][]} */
  const out = [[hullRadius(z0) + dr, z0]];
  for (const [r, z] of HULL) if (z > z0 && z < z1) out.push([r + dr, z]);
  out.push([hullRadius(z1) + dr, z1]);
  return out;
}

/** Điểm trên mặt vỏ tại góc phi (0 = đáy, π = đỉnh). @param {number} phi @param {number} z @param {number} dr */
const onHull = (phi, z, dr = 0) => {
  const r = hullRadius(z) + dr;
  return new Vector3(Math.sin(phi) * r, -Math.cos(phi) * r, z);
};

/** Viền chạy dọc thân tại góc phi. @param {number} phi @param {number} z0 @param {number} z1 @param {number} dr */
const seam = (phi, z0, z1, dr) => {
  const pts = [];
  for (let i = 0; i <= 24; i++) pts.push(onHull(phi, z0 + ((z1 - z0) * i) / 24, dr));
  return pts;
};

/**
 * @param {import('../../../model/MechanicalModel.js').BuildContext} ctx
 */
export function buildThorax(ctx) {
  const W = WINDOW;

  // ── Central housing (không nổ: là gốc để mọi thứ khác tách ra) ─────────────────────────────
  const housing = ctx.top(ctx.part('housing', 'housing'));
  ctx.mesh(housing, latheZ(HULL, 64, Math.PI + W / 2, Math.PI * 2 - W), 'shell', { doubleSide: true });

  const brass = [];
  for (const phi of [Math.PI - W / 2, Math.PI + W / 2]) brass.push(tubeThrough(seam(phi, -0.54, 0.54, 0.003), 0.007));
  for (const z of [-0.46, 0, 0.46]) {
    const t = new TorusGeometry(hullRadius(z) + 0.004, 0.0075, 6, 72, Math.PI * 2 - W);
    t.rotateZ(Math.PI / 2 + W / 2);
    t.translate(0, 0, z);
    brass.push(t);
  }
  for (const [z, dir] of [[0.56, 1], [-0.56, -1]]) {
    const t = new TorusGeometry(0.15, 0.012, 10, 48);
    t.translate(0, 0, z);
    brass.push(t);
  }
  ctx.merge(housing, 'brass', brass);

  const steel = [];
  for (const [z, dir] of [[0.557, 1], [-0.557, -1]]) {
    const d = new CircleGeometry(0.15, 40);
    if (dir < 0) d.rotateY(Math.PI);
    d.translate(0, 0, z);
    steel.push(d);
  }
  ctx.merge(housing, 'shell', steel);

  // Lá thông gió trên hai hông dưới
  const vents = [];
  for (const s of [1, -1])
    for (const phi of [0.86, 0.98, 1.1]) {
      const p = s * phi;
      const b = new BoxGeometry(0.012, 0.02, 0.42);
      b.rotateZ(Math.atan2(-Math.cos(p), Math.sin(p)));
      const c = onHull(p, 0, 0.004);
      b.translate(c.x, c.y, 0);
      vents.push(b);
    }
  ctx.merge(housing, 'carbon', vents);

  const skipWindow = (/** @type {number} */ phi) => Math.abs(phi - Math.PI) < W / 2 + 0.08;
  const bolts = [...ringOfBolts(16, hullRadius(-0.52), -0.52, skipWindow), ...ringOfBolts(16, hullRadius(0.52), 0.52, skipWindow)];
  ctx.bolts(housing, 'azure', bolts, hexHead(0.011, 0.007));
  housing.anchor = onHull(-1.3, -0.22, 0.01);

  // ── Inspection cover (nắp lưng) ──────────────────────────────────────────────────────────────
  const cover = ctx.top(ctx.part('cover', 'cover')).explode(0, 1, 0, 0.9, 0.1);
  ctx.mesh(cover, latheZ(hullSlice(-0.5, 0.5, 0.012), 40, Math.PI - W / 2 - 0.05, W + 0.1), 'plate', { doubleSide: true });
  const trim = [];
  for (const phi of [Math.PI - W / 2 - 0.05, Math.PI + W / 2 + 0.05]) trim.push(tubeThrough(seam(phi, -0.5, 0.5, 0.013), 0.006));
  for (const z of [-0.3, 0.3]) {
    const t = new TorusGeometry(hullRadius(z) + 0.02, 0.006, 8, 40, W + 0.1);
    t.rotateZ(Math.PI / 2 - (W + 0.1) / 2);
    t.translate(0, 0, z);
    trim.push(t);
  }
  ctx.merge(cover, 'brass', trim);
  /** @type {{p: Vector3, n: Vector3}[]} */
  const cb = [];
  for (const phi of [Math.PI - W / 2 + 0.06, Math.PI + W / 2 - 0.06])
    for (let i = 0; i < 6; i++) {
      const z = -0.42 + i * 0.168;
      const p = onHull(phi, z, 0.014);
      cb.push({ p, n: new Vector3(p.x, p.y, 0).normalize() });
    }
  ctx.bolts(cover, 'azure', cb, hexHead(0.009, 0.006));

  // ── Ventral plate ────────────────────────────────────────────────────────────────────────────
  const belly = ctx.top(ctx.part('belly', 'belly')).explode(0, -1, 0, 0.7, 0.1);
  ctx.mesh(belly, latheZ(hullSlice(-0.42, 0.42, 0.009), 32, Math.PI * 2 - 0.6, 1.2), 'carbon', { doubleSide: true });
  /** @type {{p: Vector3, n: Vector3}[]} */
  const bb = [];
  for (const phi of [-0.52, 0.52])
    for (let i = 0; i < 5; i++) {
      const p = onHull(phi, -0.32 + i * 0.16, 0.011);
      bb.push({ p, n: new Vector3(p.x, p.y, 0).normalize() });
    }
  ctx.bolts(belly, 'brass', bb, hexHead(0.009, 0.006));

  // ── Flight control unit ──────────────────────────────────────────────────────────────────────
  const fcu = ctx.top(ctx.part('fcu', 'fcu')).at(0, hullRadius(0.2) + 0.014, 0.2).explode(0, 1, 0.15, 1.25, 0.1);
  const rr = new Shape();
  const hw = 0.08, hd = 0.1, cr = 0.026;
  rr.moveTo(-hw + cr, -hd);
  rr.lineTo(hw - cr, -hd); rr.quadraticCurveTo(hw, -hd, hw, -hd + cr);
  rr.lineTo(hw, hd - cr); rr.quadraticCurveTo(hw, hd, hw - cr, hd);
  rr.lineTo(-hw + cr, hd); rr.quadraticCurveTo(-hw, hd, -hw, hd - cr);
  rr.lineTo(-hw, -hd + cr); rr.quadraticCurveTo(-hw, -hd, -hw + cr, -hd);
  const box = new ExtrudeGeometry(rr, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 });
  box.rotateX(-Math.PI / 2);
  ctx.mesh(fcu, box, 'brass');
  const top = 0.056;
  const face = new CylinderGeometry(0.056, 0.056, 0.006, 48);
  face.translate(0, top + 0.003, 0.012);
  ctx.mesh(fcu, face, 'pearl');
  const az = [];
  const bez = new TorusGeometry(0.058, 0.006, 8, 48);
  bez.rotateX(Math.PI / 2);
  bez.translate(0, top + 0.006, 0.012);
  az.push(bez);
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const long = i % 5 === 0;
    const t = new BoxGeometry(0.0026, 0.002, long ? 0.013 : 0.007);
    t.translate(0, 0, 0.044 - (long ? 0.003 : 0));
    t.rotateY(a);
    t.translate(0, top + 0.0065, 0.012);
    az.push(t);
  }
  for (const x of [-0.05, 0.05]) {
    const k = new CylinderGeometry(0.011, 0.011, 0.018, 16);
    k.translate(x, top - 0.004, -0.078);
    az.push(k);
  }
  ctx.merge(fcu, 'azure', az);
  const needle = new Group();
  needle.position.set(0, top + 0.008, 0.012);
  fcu.pivot.add(needle);
  const nb = new BoxGeometry(0.0035, 0.002, 0.042);
  nb.translate(0, 0, 0.017);
  ctx.mesh(fcu, nb, 'copper', { parent: needle });
  fcu.anchor = new Vector3(0, top + 0.006, 0.012);

  // ── Dorsal gear train (trục Y) ───────────────────────────────────────────────────────────────
  const zg = -0.24;
  const yTop = hullRadius(zg) + 0.012;
  /** @type {import('../../../model/Part.js').Part[]} */
  const train = [];
  const specs = [
    { x: 0, teeth: 22, R: 0.08, y: 0.03, spokes: 5, ex: [0, 1, 0], d: 0.7 },
    { x: 0.113, teeth: 12, R: 0.045, y: 0.036, spokes: 0, ex: [1, 1.1, 0], d: 0.75 },
    { x: -0.113, teeth: 12, R: 0.045, y: 0.036, spokes: 0, ex: [-1, 1.1, 0], d: 0.75 },
  ];
  specs.forEach((g, i) => {
    const p = ctx.top(ctx.part('gears', 'dorsal-gear-' + i)).at(g.x, yTop, zg)
      .explode(g.ex[0], g.ex[1], g.ex[2], g.d, 0.25 + i * 0.03);
    const geo = gearGeometry({ teeth: g.teeth, radius: g.R, thickness: 0.014, spokes: g.spokes });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, g.y, 0);
    ctx.mesh(p, geo, 'brass');
    const axle = new CylinderGeometry(0.008, 0.008, g.y + 0.02, 12);
    axle.translate(0, (g.y + 0.02) / 2 - 0.004, 0);
    const cap = new CylinderGeometry(0.014, 0.014, 0.006, 6);
    cap.translate(0, g.y + 0.012, 0);
    ctx.merge(p, 'azure', [axle, cap]);
    if (i > 0) p.pivot.rotation.y = Math.PI / g.teeth; // răng cài vào nhau
    p.userData = { teeth: g.teeth, dir: i === 0 ? 1 : -1 };
    train.push(p);
  });

  return { housing, cover, belly, fcu, needle, train };
}
