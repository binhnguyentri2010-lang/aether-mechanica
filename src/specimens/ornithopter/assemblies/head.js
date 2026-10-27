// @ts-check
// Đầu: cranial housing tiện tròn, mắt kép, antenna array, xúc tu cảm biến.
// Antenna chỉ vượt |x| = 0.35 ở z thế giới > 1.6, trước hẳn mép trước forewing (z ≤ 1.14) — plan §6.
import {
  TorusGeometry, SphereGeometry, IcosahedronGeometry, Vector3, Quaternion, CatmullRomCurve3,
  TubeGeometry,
} from 'three';
import { latheZ } from '../../../model/geo/lathe.js';
import { sampleCurve } from '../../../model/geo/curve.js';
import { tubeThrough } from '../../../model/geo/tube.js';

const Z = new Vector3(0, 0, 1);

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function buildHead(ctx) {
  const head = ctx.top(ctx.part('cranial', 'head')).at(0, 0.0, 0.565).explode(0, 0.05, 1, 0.55, 0.05);

  const prof = sampleCurve([
    [0.118, 0.0], [0.155, 0.03], [0.19, 0.1], [0.205, 0.19], [0.2, 0.27], [0.178, 0.34],
    [0.138, 0.4], [0.078, 0.442], [0.0, 0.456],
  ], 0.015);
  ctx.mesh(head, latheZ(prof, 48), 'shell');

  const brass = [];
  const neck = new TorusGeometry(0.128, 0.02, 12, 56);
  neck.translate(0, 0, 0.012);
  brass.push(neck);
  const band = new TorusGeometry(0.196, 0.006, 8, 64);
  band.translate(0, 0, 0.13);
  brass.push(band);
  // Xúc tu cảm biến dưới mặt
  const ivory = [];
  for (const s of [1, -1]) {
    const pts = [new Vector3(s * 0.05, -0.1, 0.35), new Vector3(s * 0.075, -0.165, 0.45), new Vector3(s * 0.062, -0.205, 0.53)];
    ivory.push(tubeThrough(pts, 0.008, { radial: 6 }));
    const tip = new SphereGeometry(0.016, 12, 8);
    tip.translate(pts[2].x, pts[2].y, pts[2].z);
    brass.push(tip);
  }
  ctx.merge(head, 'brass', brass);
  ctx.merge(head, 'ivory', ivory);
  head.anchor = new Vector3(0, 0.2, 0.2);

  // ── Mắt kép ──────────────────────────────────────────────────────────────────────────────────
  /** @type {import('../../../model/Part.js').Part[]} */
  const eyes = [];
  for (const s of [1, -1]) {
    const eye = head.add(ctx.part('optic', 'optic-' + (s > 0 ? 'R' : 'L'))).explode(s, 0.25, 0.4, 0.28, 0.15);
    const c = new Vector3(s * 0.148, 0.035, 0.3);
    const ball = new IcosahedronGeometry(0.082, 2);
    ball.translate(c.x, c.y, c.z);
    ctx.mesh(eye, ball, 'optic');
    const n = new Vector3(s, 0.25, 0.55).normalize();
    const bez = new TorusGeometry(0.07, 0.008, 8, 40);
    bez.applyQuaternion(new Quaternion().setFromUnitVectors(Z, n));
    bez.translate(c.x + n.x * 0.04, c.y + n.y * 0.04, c.z + n.z * 0.04);
    ctx.mesh(eye, bez, 'brass');
    eye.anchor = c.clone().addScaledVector(n, 0.082);
    eyes.push(eye);
  }

  // ── Antenna array ────────────────────────────────────────────────────────────────────────────
  /** @type {import('../../../model/Part.js').Part[]} */
  const antennae = [];
  for (const s of [1, -1]) {
    const ant = head.add(ctx.part('antenna', 'antenna-' + (s > 0 ? 'R' : 'L'))).explode(s * 0.3, 0.45, 1, 0.35, 0.1);
    const ctrl = [
      new Vector3(s * 0.06, 0.165, 0.36), new Vector3(s * 0.13, 0.33, 0.6), new Vector3(s * 0.27, 0.47, 0.96),
      new Vector3(s * 0.43, 0.55, 1.32), new Vector3(s * 0.55, 0.57, 1.6),
    ];
    const curve = new CatmullRomCurve3(ctrl, false, 'centripetal');
    ctx.mesh(ant, new TubeGeometry(curve, 90, 0.0105, 6, false), 'ivory');
    const bb = [];
    const sock = new SphereGeometry(0.028, 12, 9);
    sock.translate(ctrl[0].x, ctrl[0].y, ctrl[0].z);
    bb.push(sock);
    for (let i = 0; i < 13; i++) {
      const t = 0.16 + i * 0.062;
      const p = curve.getPointAt(Math.min(t, 0.97));
      const bead = new SphereGeometry(i % 4 === 3 ? 0.022 : 0.016, 8, 6); // hạt 2–3 px
      bead.translate(p.x, p.y, p.z);
      bb.push(bead);
    }
    const end = curve.getPointAt(1);
    const tip = new SphereGeometry(0.034, 14, 10);
    tip.translate(end.x, end.y, end.z);
    bb.push(tip);
    const ring = new TorusGeometry(0.03, 0.005, 6, 24);
    ring.applyQuaternion(new Quaternion().setFromUnitVectors(Z, curve.getTangentAt(0.99)));
    const rp = curve.getPointAt(0.975);
    ring.translate(rp.x, rp.y, rp.z);
    bb.push(ring);
    ctx.merge(ant, 'brass', bb);
    ant.anchor = curve.getPointAt(0.62);
    antennae.push(ant);
  }

  return { head, eyes, antennae };
}
