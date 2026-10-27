// @ts-check
// Hình khối nhỏ dùng chung cho các part của husky. Mọi hàm trả BufferGeometry ĐÃ đặt đúng chỗ
// (trong hệ toạ độ của part gọi nó) để gộp bằng ctx.merge.
import {
  LatheGeometry, Vector2, Vector3, SphereGeometry, TorusGeometry, CylinderGeometry, ConeGeometry,
  Quaternion, Shape, ExtrudeGeometry,
} from 'three';
import { loftPoint } from '../../../model/geo/loft.js';
import { tubeAlong } from '../../../model/geo/tube.js';

const Y = new Vector3(0, 1, 0);

/**
 * Tiện tròn quanh trục Y cho các đoạn chi (chạy XUỐNG theo −Y). profile [[r, y], ...] với y GIẢM dần.
 * sx: ép bề ngang (X) để mặt cắt thành elip dẹt theo chiều trước–sau.
 * @param {[number, number][]} profile @param {number} [seg] @param {number} [sx]
 */
export function latheY(profile, seg = 20, sx = 1) {
  // LatheGeometry cần y TĂNG dần để pháp tuyến hướng ra ngoài
  const pts = profile.slice().reverse().map(([r, y]) => new Vector2(r, y));
  const g = new LatheGeometry(pts, seg);
  if (sx !== 1) g.scale(sx, 1, 1);
  return g;
}

/** Elipxoit. @param {number} rx @param {number} ry @param {number} rz @param {number} x @param {number} y @param {number} z @param {number} [ws] @param {number} [hs] */
export function ellipsoid(rx, ry, rz, x, y, z, ws = 20, hs = 14) {
  const g = new SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

/** Quả cầu khớp. @param {number} r @param {number} x @param {number} y @param {number} z @param {number} [ws] */
export function ball(r, x, y, z, ws = 18) {
  const g = new SphereGeometry(r, ws, Math.max(8, Math.round(ws * 0.66)));
  g.translate(x, y, z);
  return g;
}

/** Vòng xuyến nằm ngang (mặt phẳng XZ) ở cao độ y — đai quanh đoạn chi. @param {number} r @param {number} tube @param {number} y @param {number} [sx] */
export function hoop(r, tube, y, sx = 1) {
  const g = new TorusGeometry(r, tube, 8, 32);
  g.rotateX(Math.PI / 2);
  if (sx !== 1) g.scale(sx, 1, 1);
  g.translate(0, y, 0);
  return g;
}

/** Trụ theo trục X (tang trống khớp vai/hông), tâm (x, y, z). @param {number} r @param {number} len @param {number} x @param {number} y @param {number} z @param {number} [radial] */
export function drumX(r, len, x, y, z, radial = 32) {
  const g = new CylinderGeometry(r, r, len, radial, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Móng: nón nhỏ chĩa theo hướng dir từ điểm p. @param {Vector3} p @param {Vector3} dir @param {number} r @param {number} len */
export function claw(p, dir, r, len) {
  const g = new ConeGeometry(r, len, 8, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(Y, dir.clone().normalize()));
  g.translate(p.x, p.y, p.z);
  return g;
}

/**
 * Tấm phẳng có bo góc từ đa giác 2D (u, v), đùn dày `depth` theo pháp tuyến. Tấm nằm trong mặt phẳng YZ
 * (u → Z, v → Y), đặt ở x. Dùng cho tấm bả vai, tấm chậu, tai.
 * @param {[number, number][]} poly @param {number} depth @param {number} x
 * @param {{bevel?: number, round?: number}} [o]
 */
export function plateYZ(poly, depth, x, o = {}) {
  const s = new Shape();
  const rr = o.round ?? 0;
  if (rr > 0) {
    // bo tròn mỗi đỉnh bằng một đường cong bậc hai
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const a = poly[(i + n - 1) % n];
      const b = poly[(i + 1) % n];
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const ka = Math.min(rr, la / 2) / la;
      const kb = Math.min(rr, lb / 2) / lb;
      const p0 = [p[0] + (a[0] - p[0]) * ka, p[1] + (a[1] - p[1]) * ka];
      const p1 = [p[0] + (b[0] - p[0]) * kb, p[1] + (b[1] - p[1]) * kb];
      if (i === 0) s.moveTo(p0[0], p0[1]);
      else s.lineTo(p0[0], p0[1]);
      s.quadraticCurveTo(p[0], p[1], p1[0], p1[1]);
    }
    s.closePath();
  } else {
    s.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) s.lineTo(poly[i][0], poly[i][1]);
    s.closePath();
  }
  const bev = o.bevel ?? Math.min(0.02, depth * 0.35);
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 6 });
  // Shape nằm trong XY (u = x, v = y), đùn theo +Z. Xoay −90° quanh Y (phép quay thật, không đảo
  // chiều quấn): (x, y, z) → (−z, y, x) → u thành Z, đùn thành −X. Rồi dời để tâm bề dày ở x.
  g.rotateY(-Math.PI / 2);
  g.translate(x + depth / 2, 0, 0);
  return g;
}

/**
 * Điểm + pháp tuyến ngoài trên mặt loft (sai phân hữu hạn) — để đặt bulông, mắt, viền đúng bề mặt.
 * @param {import('../../../model/geo/loft.js').Station[]} st @param {number} z @param {number} phi @param {number} [off]
 */
export function surf(st, z, phi, off = 0) {
  const e = 1e-3;
  const p = new Vector3(...loftPoint(st, z, phi, off));
  const a = new Vector3(...loftPoint(st, z, phi + e, off)).sub(new Vector3(...loftPoint(st, z, phi - e, off)));
  const b = new Vector3(...loftPoint(st, z + e, phi, off)).sub(new Vector3(...loftPoint(st, z - e, phi, off)));
  const n = a.cross(b).normalize(); // dphi × dz = pháp tuyến ra ngoài (xem loft.js)
  return { p, n };
}

/** Đường viền kín quanh mặt cắt loft tại z (đai trang trí). @param {import('../../../model/geo/loft.js').Station[]} st @param {number} z @param {number} r @param {number} [off] @param {number} [a0] @param {number} [a1] */
export function seamRing(st, z, r, off = 0.01, a0 = 0, a1 = Math.PI * 2) {
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-9;
  const n = full ? 72 : Math.max(8, Math.round((72 * (a1 - a0)) / (Math.PI * 2)));
  const pts = [];
  for (let i = 0; i < (full ? n : n + 1); i++) pts.push(new Vector3(...loftPoint(st, z, a0 + ((a1 - a0) * i) / n, off)));
  return tubeAlong(pts, r, 6, full);
}

/** Đường viền dọc thân theo góc phi, từ z0 tới z1. @param {import('../../../model/geo/loft.js').Station[]} st @param {number} phi @param {number} z0 @param {number} z1 @param {number} r @param {number} [off] */
export function seamLong(st, phi, z0, z1, r, off = 0.01) {
  const n = Math.max(8, Math.round(Math.abs(z1 - z0) / 0.06));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(new Vector3(...loftPoint(st, z0 + ((z1 - z0) * i) / n, phi, off)));
  return tubeAlong(pts, r, 6);
}
