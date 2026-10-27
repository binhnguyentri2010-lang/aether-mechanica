// @ts-check
// Đuôi "lưỡi liềm" của husky: 7 khâu nối tiếp cong vắt lên lưng, đỉnh (cao 6.4, z −2.0) theo spec.js.
// Mỗi khâu là một part lồng trong khâu trước → quay khâu gốc thì cả đuôi đưa theo; các khâu sau
// quay thêm chút ít (trễ pha) cho cảm giác roi. Ở bind mọi pivot có quay = 0.
import { Vector3, CatmullRomCurve3 } from 'three';
import { rodBetween } from '../../../model/geo/tube.js';
import { H } from '../spec.js';
import { ball } from './shapes.js';

/** Đường cong trục đuôi (z, cao). Gốc nằm trong mông; đỉnh = BODY.tailTip. */
export const TAIL_CURVE = /** @type {[number, number][]} */ ([
  [-2.45, 4.9], [-2.8, 5.25], [-2.97, 5.78], [-2.86, 6.25], [-2.55, 6.5], [-2.2, 6.52], [-2.0, 6.4],
]);
export const TAIL_LINKS = 7;

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function* buildTail(ctx) {
  const curve = new CatmullRomCurve3(TAIL_CURVE.map(([z, h]) => new Vector3(0, H(h), z)), false, 'centripetal');
  const joints = curve.getSpacedPoints(TAIL_LINKS);
  /** @type {import('../../../model/Part.js').Part[]} */
  const links = [];
  for (let i = 0; i < TAIL_LINKS; i++) {
    const a = joints[i];
    const b = joints[i + 1];
    const dir = b.clone().sub(a).normalize();
    const r0 = 0.2 - i * 0.017;
    const r1 = 0.2 - (i + 1) * 0.017;
    const name = 'tail.' + i;
    const part = i === 0
      ? ctx.top(ctx.part('tail', name)).at(a.x, a.y, a.z).explode(0, 0.5, -1, 0.45, 0.15)
      : links[i - 1].add(ctx.part('tail', name)).at(a.x - joints[i - 1].x, a.y - joints[i - 1].y, a.z - joints[i - 1].z)
        .explode(dir.x, dir.y, dir.z, 0.12, 0.2 + i * 0.03);
    const tip = b.clone().sub(a);
    const last = i === TAIL_LINKS - 1;
    // Khâu cuối trắng (chóp đuôi husky); các khâu khác men tối
    ctx.mesh(part, rodBetween(new Vector3(0, 0, 0), tip, r0 * 0.92, 18, last ? r1 * 0.6 : r1 * 0.92), last ? 'pearl' : 'shell');
    const joint = [ball(r0 * 0.98, 0, 0, 0, 16)];
    if (last) joint.push(ball(r1 * 0.62, tip.x, tip.y, tip.z, 14));
    ctx.merge(part, last ? 'pearl' : 'brass', joint);
    part.anchor = tip.clone().multiplyScalar(0.5).add(new Vector3(r0, 0, 0));
    links.push(part);
    yield;
  }
  return { links, joints };
}
