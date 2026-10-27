// @ts-check
import {
  CatmullRomCurve3, TubeGeometry, CylinderGeometry, Quaternion, Vector3, BufferGeometry, BufferAttribute,
} from 'three';

const UP = new Vector3(0, 1, 0);

/**
 * Ống chạy qua các điểm (Catmull-Rom centripetal — không gợn vòng ở chỗ gấp).
 * @param {Vector3[]} points
 * @param {number} radius
 * @param {{segments?: number, radial?: number, closed?: boolean}} [o]
 */
export function tubeThrough(points, radius, o = {}) {
  const curve = new CatmullRomCurve3(points, !!o.closed, 'centripetal');
  // Mỗi đoạn ~0.03 unit (3 mm); ống MẢNH (r ≤ 0.012 — gân cánh, viền, chỉ rộng 1–2 px trên màn hình)
  // dùng 0.06: FPS vòng 3 đo thật GPU tỉ lệ với số tam giác (~0.16 ms / 1k trên MX550 bật MSAA), và
  // ống 1–2 px chia đốt 3 mm sinh hàng vạn tam giác nhỏ hơn điểm ảnh. Đốt 6 mm ≈ 9 px — vẫn trơn.
  const step = radius <= 0.012 ? 0.06 : 0.03;
  const seg = o.segments ?? Math.max(8, Math.round(curve.getLength() / step));
  return new TubeGeometry(curve, seg, radius, o.radial ?? 6, !!o.closed);
}

/**
 * Ống quét thẳng dọc một POLYLINE đã đủ dày (không nội suy Catmull-Rom, không tính độ dài cung):
 * khung parallel-transport, vòng kín thì chia đều độ xoắn dư để mối nối khít. Dùng cho viền/đai bám
 * mặt loft (điểm lấy mẫu sẵn 48–64 điểm). Đo thật: một đai quanh thân 1.8 ms (TubeGeometry) → ~0.05 ms.
 * @param {Vector3[]} pts @param {number} radius @param {number} [radial] @param {boolean} [closed]
 */
export function tubeAlong(pts, radius, radial = 6, closed = false) {
  const n = pts.length;
  const rings = closed ? n + 1 : n;
  const at = (/** @type {number} */ i) => pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  const T = [];
  for (let i = 0; i < rings; i++) T.push(new Vector3().subVectors(at(i + 1), at(i - 1)).normalize());
  // Pháp tuyến đầu vuông góc tiếp tuyến đầu, rồi chuyển song song
  const N = [];
  const seed = Math.abs(T[0].y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  N.push(new Vector3().crossVectors(T[0], seed).normalize());
  for (let i = 1; i < rings; i++) {
    const v = N[i - 1].clone().addScaledVector(T[i], -N[i - 1].dot(T[i]));
    N.push(v.lengthSq() > 1e-12 ? v.normalize() : N[i - 1].clone());
  }
  if (closed) {
    // Độ xoắn dư sau một vòng: góc giữa N cuối và N đầu quanh T đầu → trả dần về 0 dọc vòng
    const b0 = new Vector3().crossVectors(T[0], N[0]);
    const twist = Math.atan2(N[rings - 1].dot(b0), N[rings - 1].dot(N[0]));
    for (let i = 1; i < rings; i++) N[i].applyAxisAngle(T[i], (-twist * i) / (rings - 1));
  }
  const cols = radial + 1;
  const pos = new Float32Array(rings * cols * 3);
  const nor = new Float32Array(rings * cols * 3);
  const uv = new Float32Array(rings * cols * 2);
  const B = new Vector3();
  for (let i = 0; i < rings; i++) {
    B.crossVectors(T[i], N[i]);
    const P = at(i);
    for (let j = 0; j < cols; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = N[i].x * c + B.x * s, ny = N[i].y * c + B.y * s, nz = N[i].z * c + B.z * s;
      const o = (i * cols + j) * 3;
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
      pos[o] = P.x + nx * radius; pos[o + 1] = P.y + ny * radius; pos[o + 2] = P.z + nz * radius;
      uv[(i * cols + j) * 2] = i / (rings - 1);
      uv[(i * cols + j) * 2 + 1] = j / radial;
    }
  }
  const idx = [];
  for (let i = 0; i < rings - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c); // (dθ × ds) hướng ra ngoài
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Trụ nối hai điểm.
 * @param {Vector3} a @param {Vector3} b @param {number} r
 * @param {number} [radial] @param {number} [r2] bán kính đầu b (mặc định = r)
 */
export function rodBetween(a, b, r, radial = 12, r2 = r) {
  const len = a.distanceTo(b);
  const g = new CylinderGeometry(r2, r, len, radial, 1);
  const dir = new Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * Trụ theo trục Z (chốt, ổ, tang trống), tâm ở (x, y, zc).
 * @param {number} r @param {number} len @param {number} x @param {number} y @param {number} zc
 * @param {number} [radial]
 */
export function cylZ(r, len, x, y, zc, radial = 24) {
  const g = new CylinderGeometry(r, r, len, radial, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, zc);
  return g;
}
