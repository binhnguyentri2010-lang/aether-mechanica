// @ts-check
// Ống có SỐ ĐỈNH CỐ ĐỊNH, cập nhật hình dạng ngay trong buffer cũ (plan §10): 0 cấp phát mỗi khung.
// Đường tâm là Bézier bậc ba A → A+sag → B+sag → B (dây cáp võng). Khung dọc ống dùng
// parallel transport nên không bị xoắn giật khi hai đầu dịch chuyển.
import { BufferGeometry, BufferAttribute, Vector3 } from 'three';

const _t = new Vector3();
const _n = new Vector3();
const _b = new Vector3();
const _tmp = new Vector3();
const _c1 = new Vector3();
const _c2 = new Vector3();

export class DynamicTube {
  /** @param {number} segments @param {number} radial @param {number} radius */
  constructor(segments = 40, radial = 8, radius = 0.012) {
    this.segments = segments;
    this.radial = radial;
    this.radius = radius;
    const rings = segments + 1;
    const vcount = rings * (radial + 1);
    this.pos = new Float32Array(vcount * 3);
    this.nor = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const idx = new Uint16Array(segments * radial * 6);
    let k = 0;
    for (let i = 0; i < segments; i++)
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = (i + 1) * (radial + 1) + j;
        idx[k++] = a; idx[k++] = b; idx[k++] = a + 1;
        idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1;
      }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j <= radial; j++) {
        uv[(i * (radial + 1) + j) * 2] = i / segments;
        uv[(i * (radial + 1) + j) * 2 + 1] = j / radial;
      }
    this.geometry = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.norAttr = new BufferAttribute(this.nor, 3);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.norAttr);
    this.geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    this.geometry.setIndex(new BufferAttribute(idx, 1));
    // Điểm tâm cấp sẵn
    this.centers = Array.from({ length: rings }, () => new Vector3());
    this.tangents = Array.from({ length: rings }, () => new Vector3());
  }

  /**
   * @param {Vector3} A @param {Vector3} B @param {number} sag độ võng theo −Y
   */
  update(A, B, sag) {
    const n = this.segments;
    _c1.copy(A); _c1.y -= sag;
    _c2.copy(B); _c2.y -= sag;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s = 1 - t;
      const w0 = s * s * s, w1 = 3 * s * s * t, w2 = 3 * s * t * t, w3 = t * t * t;
      this.centers[i].set(
        A.x * w0 + _c1.x * w1 + _c2.x * w2 + B.x * w3,
        A.y * w0 + _c1.y * w1 + _c2.y * w2 + B.y * w3,
        A.z * w0 + _c1.z * w1 + _c2.z * w2 + B.z * w3,
      );
      // đạo hàm
      const d0 = 3 * s * s, d1 = 6 * s * t, d2 = 3 * t * t;
      this.tangents[i].set(
        (_c1.x - A.x) * d0 + (_c2.x - _c1.x) * d1 + (B.x - _c2.x) * d2,
        (_c1.y - A.y) * d0 + (_c2.y - _c1.y) * d1 + (B.y - _c2.y) * d2,
        (_c1.z - A.z) * d0 + (_c2.z - _c1.z) * d1 + (B.z - _c2.z) * d2,
      );
      if (this.tangents[i].lengthSq() < 1e-12) this.tangents[i].set(0, 0, 1);
      this.tangents[i].normalize();
    }

    // Pháp tuyến ban đầu: vuông góc với tiếp tuyến đầu
    _t.copy(this.tangents[0]);
    _tmp.set(0, 1, 0);
    if (Math.abs(_t.dot(_tmp)) > 0.9) _tmp.set(1, 0, 0);
    _n.crossVectors(_t, _tmp).normalize();

    const R = this.radial;
    for (let i = 0; i <= n; i++) {
      if (i > 0) {
        // parallel transport: chiếu pháp tuyến cũ lên mặt phẳng vuông góc tiếp tuyến mới
        _t.copy(this.tangents[i]);
        _n.addScaledVector(_t, -_n.dot(_t));
        if (_n.lengthSq() < 1e-10) _n.set(_t.y, -_t.x, 0);
        _n.normalize();
      }
      _b.crossVectors(this.tangents[i], _n);
      const c = this.centers[i];
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = _n.x * ca + _b.x * sa;
        const ny = _n.y * ca + _b.y * sa;
        const nz = _n.z * ca + _b.z * sa;
        const o = (i * (R + 1) + j) * 3;
        this.nor[o] = nx; this.nor[o + 1] = ny; this.nor[o + 2] = nz;
        this.pos[o] = c.x + nx * this.radius;
        this.pos[o + 1] = c.y + ny * this.radius;
        this.pos[o + 2] = c.z + nz * this.radius;
      }
    }
    this.posAttr.needsUpdate = true;
    this.norAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
