// @ts-check
// 3 cặp chân gập sát thân: mọi điểm |x| ≤ 0.33 để cánh đập xuống −52° không va (plan §6).
import { SphereGeometry, Vector3 } from 'three';
import { tubeThrough } from '../../../model/geo/tube.js';

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function buildLegs(ctx) {
  const legs = ctx.top(ctx.part('legs', 'legs')).at(0, -0.22, 0).explode(0, -1, 0, 0.85, 0.1);
  const steel = [];
  const brass = [];
  const pairs = [
    { z: 0.28, knee: 0.1, foot: 0.3 },
    { z: 0.02, knee: 0.02, foot: 0.06 },
    { z: -0.26, knee: -0.08, foot: -0.24 },
  ];
  for (const s of [1, -1])
    for (const L of pairs) {
      const hip = new Vector3(s * 0.12, 0, L.z);
      const knee = new Vector3(s * 0.26, -0.2, L.z + L.knee);
      const ankle = new Vector3(s * 0.3, -0.44, L.z + L.foot * 0.6);
      const foot = new Vector3(s * 0.285, -0.52, L.z + L.foot);
      steel.push(tubeThrough([hip, knee], 0.016, { radial: 8, segments: 6 }));
      steel.push(tubeThrough([knee, ankle], 0.011, { radial: 8, segments: 6 }));
      steel.push(tubeThrough([ankle, foot], 0.008, { radial: 6, segments: 4 }));
      for (const [p, r] of /** @type {[Vector3, number][]} */ ([[hip, 0.028], [knee, 0.021], [ankle, 0.015], [foot, 0.013]])) {
        const b = new SphereGeometry(r, 10, 7); // khớp r ≤ 0.028 (~4 px): 10×7 là đủ tròn
        b.translate(p.x, p.y, p.z);
        brass.push(b);
      }
    }
  ctx.merge(legs, 'plate', steel);
  ctx.merge(legs, 'brass', brass);
  return { legs };
}
