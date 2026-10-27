// @ts-check
import {
  CylinderGeometry, InstancedMesh, Matrix4, Quaternion, Vector3,
} from 'three';

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);

/** Đầu bulông lục giác, trục Y, đáy ở y = 0. */
export function hexHead(r = 0.012, h = 0.008) {
  const g = new CylinderGeometry(r, r, h, 6, 1);
  g.translate(0, h / 2, 0);
  return g;
}

/**
 * Nhiều bulông trong một draw call.
 * @param {import('three').BufferGeometry} geo
 * @param {import('three').Material} mat
 * @param {{p: Vector3, n: Vector3}[]} list vị trí + pháp tuyến bề mặt
 */
export function boltInstances(geo, mat, list) {
  const mesh = new InstancedMesh(geo, mat, list.length);
  list.forEach(({ p, n }, i) => {
    _q.setFromUnitVectors(UP, n.clone().normalize());
    _m.compose(p, _q, _s);
    mesh.setMatrixAt(i, _m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Vành bulông quanh trục Z tại mặt trụ bán kính r, vị trí z; bỏ các góc nằm trong khoảng `skip`.
 * @param {number} count @param {number} r @param {number} z
 * @param {(phi: number) => boolean} [skip] phi = 0 ở đáy (−Y), π ở đỉnh
 */
export function ringOfBolts(count, r, z, skip = () => false) {
  /** @type {{p: Vector3, n: Vector3}[]} */
  const out = [];
  for (let i = 0; i < count; i++) {
    const phi = (i / count) * Math.PI * 2 + Math.PI / count;
    if (skip(phi)) continue;
    const x = Math.sin(phi);
    const y = -Math.cos(phi);
    out.push({ p: new Vector3(x * r, y * r, z), n: new Vector3(x, y, 0) });
  }
  return out;
}
