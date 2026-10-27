// @ts-check
// Power coupling giữa thorax và spine + hai dây cáp đồng động (plan §10: buffer cấp sẵn, 0 cấp phát).
import { TorusGeometry, Vector3, Mesh } from 'three';
import { latheZ } from '../../../model/geo/lathe.js';
import { sampleCurve } from '../../../model/geo/curve.js';
import { DynamicTube } from '../../../model/geo/dynamicTube.js';
import { SPINE, segY } from './spine.js';

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function buildCoupling(ctx) {
  const c = ctx.top(ctx.part('coupling', 'coupling')).at(0, -0.01, -0.61).explode(0, -0.35, -1, 0.3, 0.15);
  const prof = sampleCurve([
    [0.13, -0.045], [0.165, -0.036], [0.172, -0.016], [0.165, 0], [0.172, 0.016], [0.165, 0.036], [0.13, 0.045],
  ], 0.006);
  ctx.mesh(c, latheZ(prof, 48), 'copper', { doubleSide: true });
  const rings = [];
  for (const z of [-0.028, 0.028]) {
    const t = new TorusGeometry(0.173, 0.004, 4, 48);
    t.translate(0, 0, z);
    rings.push(t);
  }
  ctx.merge(c, 'brass', rings);
  c.anchor = new Vector3(0.12, 0.12, 0);

  /** Cáp nối từ bụng thorax tới đốt spine số 1. */
  const cables = [1, -1].map((s) => {
    const tube = new DynamicTube(36, 8, 0.012);
    const mesh = new Mesh(tube.geometry, ctx.material('copper', c));
    mesh.frustumCulled = false;
    mesh.userData.dynamic = true; // geometry ghi lại tại chỗ khi explode đổi → không gom vào lô vẽ
    ctx.adopt(c, mesh, ctx.motionRoot);
    return {
      tube,
      a: new Vector3(s * 0.1, -0.24, -0.4), // trên housing (không nổ)
      bLocal: new Vector3(s * 0.07, -0.13, 0.03), // trong đốt spine 1
    };
  });

  return { coupling: c, cables };
}

const _A = new Vector3();
const _B = new Vector3();

/**
 * Cập nhật hai dây cáp theo vị trí hiện tại của đốt spine 1 (gọi khi explode đổi).
 * @param {ReturnType<typeof buildCoupling>} cp @param {import('../../../model/Part.js').Part} seg1
 */
export function updateCables(cp, seg1) {
  for (const cb of cp.cables) {
    _A.copy(cb.a);
    _B.copy(seg1.group.position).add(cb.bLocal);
    cb.tube.update(_A, _B, 0.1);
  }
}

export { SPINE, segY };
