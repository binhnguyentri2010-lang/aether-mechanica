// @ts-check
// Gộp nhiều BufferGeometry (đã đặt đúng vị trí bằng applyMatrix4/translate) thành một, để giảm
// draw call. Chỉ gộp trong CÙNG một part (plan §6): explode và highlight làm việc theo part.
//
// Copy NGUYÊN KHỐI typed array (TypedArray.set) thay vì từng đỉnh qua getX/getY/getZ: đo thật, gộp 6
// ống viền (~8k đỉnh) từ 8.5 ms còn < 1 ms — quan trọng khi dựng nền theo lát 6 ms/khung (đợt 3 §4).
// Kết quả từng byte y hệt cách cũ (cùng thứ tự, cùng giá trị).
import { BufferGeometry, BufferAttribute } from 'three';

/**
 * Chép một thuộc tính (itemSize k) vào mảng đích tại vị trí đỉnh vo.
 * @param {any} attr @param {Float32Array} dst @param {number} vo @param {number} k
 */
function copyAttr(attr, dst, vo, k) {
  if (!attr.isInterleavedBufferAttribute && attr.itemSize === k && attr.array instanceof Float32Array && !attr.normalized) {
    dst.set(attr.array.subarray(0, attr.count * k), vo * k);
    return;
  }
  // Đường chậm (thuộc tính xen kẽ/chuẩn hoá — hiện không có trong app, giữ để an toàn)
  for (let i = 0; i < attr.count; i++) {
    dst[(vo + i) * k] = attr.getX(i);
    dst[(vo + i) * k + 1] = attr.getY(i);
    if (k > 2) dst[(vo + i) * k + 2] = attr.getZ(i);
  }
}

/** @param {BufferGeometry[]} geos */
export function mergeGeometries(geos) {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);

  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    copyAttr(p, pos, vo, 3);
    copyAttr(g.attributes.normal, nor, vo, 3);
    if (g.attributes.uv) copyAttr(g.attributes.uv, uv, vo, 2);
    if (g.index) {
      const src = g.index.array;
      const n = g.index.count;
      for (let i = 0; i < n; i++) idx[io + i] = src[i] + vo;
      io += n;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
      io += p.count;
    }
    vo += p.count;
    g.dispose();
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setIndex(new BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
