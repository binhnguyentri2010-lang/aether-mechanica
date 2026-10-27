// @ts-check
// Mặt LOFT dọc trục Z: nối các mặt cắt siêu elip (superellipse) — thân, đầu, cổ của mẫu vật hữu cơ.
// Tham số của mặt cắt nội suy Catmull-Rom giữa các trạm → đường viền trơn, không gãy khúc.
//
// Góc mặt cắt giống latheZ: phi = 0 ở ĐÁY (−Y), π/2 ở +X, π ở ĐỈNH (+Y), 3π/2 ở −X.
import { BufferGeometry, BufferAttribute } from 'three';

/**
 * @typedef {{
 *   z: number, cy: number, rx: number, ry: number,
 *   n?: number, keel?: number, cx?: number,
 * }} Station
 *   z: vị trí dọc trục · cy: tâm theo Y · rx, ry: bán trục · n: số mũ siêu elip (2 = elip, lớn hơn = vuông
 *   hơn) · keel: bề ngang ở ĐÁY so với giữa (1 = không thu, 0.6 = đáy hẹp như lườn ngực) · cx: tâm theo X
 */

/** Catmull-Rom đều trên 4 giá trị. @param {number} a @param {number} b @param {number} c @param {number} d @param {number} t */
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

/** sign(u)·|u|^(2/n) @param {number} u @param {number} n */
const se = (u, n) => Math.sign(u) * Math.pow(Math.abs(u), 2 / n);

/**
 * @param {Station[]} st theo z tăng dần (≥ 2 trạm)
 * @param {{radial?: number, sub?: number, a0?: number, a1?: number, capStart?: boolean, capEnd?: boolean, offset?: number, z0?: number, z1?: number}} [o]
 *   radial: số đoạn quanh mặt cắt · sub: số đoạn giữa hai trạm · a0..a1: dải góc (mặc định cả vòng) — để cắt tấm
 *   ốp · offset: nới bán trục ra ngoài (tấm ốp nằm ngoài vỏ) · capStart/capEnd: bịt hai đầu (chỉ khi cả vòng)
 *   · z0..z1: chỉ giữ phần giữa hai mặt z này (nội suy vẫn dùng TOÀN BỘ trạm → tấm ốp bám đúng vỏ)
 */
export function loftZ(st, o = {}) {
  const radial = o.radial ?? 40;
  const sub = o.sub ?? 6;
  const a0 = o.a0 ?? 0;
  const a1 = o.a1 ?? Math.PI * 2;
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-9;
  const off = o.offset ?? 0;

  // Mặt cắt nội suy
  /** @type {{z: number, cy: number, rx: number, ry: number, n: number, keel: number, cx: number}[]} */
  let rings = [];
  const val = (/** @type {number} */ i, /** @type {keyof Station} */ k, /** @type {number} */ def) => {
    const s = st[Math.max(0, Math.min(st.length - 1, i))];
    const v = s[k];
    return v === undefined ? def : /** @type {number} */ (v);
  };
  for (let i = 0; i < st.length - 1; i++) {
    const last = i === st.length - 2;
    for (let k = 0; k <= (last ? sub : sub - 1); k++) {
      const t = k / sub;
      /** @param {keyof Station} key @param {number} def */
      const f = (key, def) => cr(val(i - 1, key, def), val(i, key, def), val(i + 1, key, def), val(i + 2, key, def), t);
      rings.push({
        z: st[i].z + (st[i + 1].z - st[i].z) * t,
        cy: f('cy', 0), rx: f('rx', 0) + off, ry: f('ry', 0) + off,
        n: f('n', 2), keel: f('keel', 1), cx: f('cx', 0),
      });
    }
  }
  if (o.z0 !== undefined || o.z1 !== undefined) {
    const z0 = o.z0 ?? -Infinity;
    const z1 = o.z1 ?? Infinity;
    rings = rings.filter((r) => r.z >= z0 - 1e-9 && r.z <= z1 + 1e-9);
  }

  const cols = radial + 1;
  const nR = rings.length;
  const capVerts = full ? (o.capStart ? cols + 1 : 0) + (o.capEnd ? cols + 1 : 0) : 0;
  const vCount = nR * cols + capVerts;
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  /** @type {number[]} */
  const idx = [];

  /** Điểm trên mặt cắt r tại góc phi → ghi vào pos[v]. */
  const put = (/** @type {number} */ v, /** @type {typeof rings[0]} */ r, /** @type {number} */ phi) => {
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    // nửa dưới (c > 0 → y < tâm) thu hẹp theo keel
    const w = 1 - (1 - r.keel) * Math.pow(Math.max(0, c), 1.5);
    pos[v * 3] = r.cx + r.rx * w * se(s, r.n);
    pos[v * 3 + 1] = r.cy - r.ry * se(c, r.n);
    pos[v * 3 + 2] = r.z;
  };

  for (let i = 0; i < nR; i++)
    for (let j = 0; j < cols; j++) {
      const v = i * cols + j;
      put(v, rings[i], a0 + ((a1 - a0) * j) / radial);
      uv[v * 2] = j / radial;
      uv[v * 2 + 1] = i / (nR - 1);
    }
  for (let i = 0; i < nR - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c); // pháp tuyến hướng RA NGOÀI (dphi × dz)
    }

  let v = nR * cols;
  /** @param {number} ri @param {boolean} start */
  const cap = (ri, start) => {
    const r = rings[ri];
    const c0 = v;
    pos[c0 * 3] = r.cx;
    pos[c0 * 3 + 1] = r.cy;
    pos[c0 * 3 + 2] = r.z;
    for (let j = 0; j < cols; j++) put(c0 + 1 + j, r, a0 + ((a1 - a0) * j) / radial);
    for (let j = 0; j < radial; j++) {
      if (start) idx.push(c0, c0 + 2 + j, c0 + 1 + j);
      else idx.push(c0, c0 + 1 + j, c0 + 2 + j);
    }
    v += cols + 1;
  };
  if (full && o.capStart) cap(0, true);
  if (full && o.capEnd) cap(nR - 1, false);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Đường nối (cột đầu = cột cuối khi đủ vòng): lấy trung bình pháp tuyến để không lộ vệt
  if (full) {
    const n = /** @type {BufferAttribute} */ (g.attributes.normal);
    for (let i = 0; i < nR; i++) {
      const p = i * cols;
      const q = p + radial;
      const x = n.getX(p) + n.getX(q), y = n.getY(p) + n.getY(q), z = n.getZ(p) + n.getZ(q);
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(p, x / l, y / l, z / l);
      n.setXYZ(q, x / l, y / l, z / l);
    }
  }
  return g;
}

/**
 * Điểm trên mặt loft (không dựng lưới): dùng để đặt bulông, viền, tấm ốp đúng bề mặt.
 * @param {Station[]} st @param {number} z @param {number} phi @param {number} [off]
 * @returns {[number, number, number]}
 */
export function loftPoint(st, z, phi, off = 0) {
  let i = 0;
  while (i < st.length - 2 && st[i + 1].z < z) i++;
  const t = Math.max(0, Math.min(1, (z - st[i].z) / (st[i + 1].z - st[i].z || 1)));
  const at = (/** @type {number} */ k) => st[Math.max(0, Math.min(st.length - 1, k))];
  /** @param {keyof Station} key @param {number} def */
  const f = (key, def) => {
    const g = (/** @type {number} */ k) => {
      const v = at(k)[key];
      return v === undefined ? def : /** @type {number} */ (v);
    };
    return cr(g(i - 1), g(i), g(i + 1), g(i + 2), t);
  };
  const rx = f('rx', 0) + off, ry = f('ry', 0) + off, n = f('n', 2), keel = f('keel', 1);
  const s = Math.sin(phi), c = Math.cos(phi);
  const w = 1 - (1 - keel) * Math.pow(Math.max(0, c), 1.5);
  return [f('cx', 0) + rx * w * se(s, n), f('cy', 0) - ry * se(c, n), z];
}
