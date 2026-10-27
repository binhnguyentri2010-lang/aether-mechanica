// @ts-check
// Bộ vật liệu PBR với HAI BẢNG MÀU (plan §7 + chủ đề theo ảnh tham chiếu):
//   azure    — "Azure & Gold": khung vàng, màng tím oải hương, men xanh, sứ trắng (nền sáng)
//   obsidian — thép oxy hoá, đồng thau cũ, khung ngà, màng khói tối (nền đen)
// Mỗi part lấy BẢN SAO vật liệu. Đổi chủ đề = áp bảng màu mới lên từng bản sao rồi để
// MaterialState chụp lại giá trị gốc → trạng thái hover/focus vẫn tính từ gốc, không nhân dồn.
import {
  MeshStandardMaterial, MeshPhysicalMaterial, CanvasTexture, RepeatWrapping, DoubleSide,
  NoColorSpace,
} from 'three';

/** Roughness map procedural: vệt xước mảnh kiểu kim loại chải — làm kim loại hết "bóng nhựa". */
function brushedTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.fillStyle = 'rgb(232,232,232)';
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const y = rnd() * 256;
    const v = 200 + Math.floor(rnd() * 55);
    g.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.4})`;
    g.lineWidth = rnd() < 0.85 ? 0.6 : 1.4;
    g.beginPath();
    const x0 = rnd() * 256;
    g.moveTo(x0 - 40, y);
    g.lineTo(x0 + 40 + rnd() * 160, y + (rnd() - 0.5) * 1.2);
    g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = NoColorSpace;
  return tex;
}

/**
 * Vai trò vật liệu (không phải tên kim loại): cùng một vai trò đổi màu theo chủ đề.
 * @typedef {'steel'|'shell'|'plate'|'silver'|'brass'|'copper'|'azure'|'carbon'|'ivory'|'membrane'|'amber'|'optic'|'pearl'} MatKey
 * @typedef {'azure'|'obsidian'} Theme
 * @typedef {{c: number, m: number, r: number, env: number, cc?: number, ccr?: number, ir?: number, e?: number, ei?: number, op?: number, rough?: boolean}} Spec
 */

/** @type {Record<Theme, Record<MatKey, Spec>>} */
export const PALETTES = {
  azure: {
    // Vùng lớn (vỏ, bụng, đốt sống) KHÔNG dùng clearcoat: đo thật, clearcoat toàn cảnh làm khung
    // tăng từ ~6 lên ~11.6 ms. Độ bóng men lấy bằng roughness thấp + env cao.
    steel: { c: 0xe9e4da, m: 0.05, r: 0.26, env: 1.0 }, // sứ trắng
    shell: { c: 0x2c4fb8, m: 0.2, r: 0.2, env: 1.1 }, // men azure
    plate: { c: 0xd2a94f, m: 1, r: 0.3, env: 1.0, rough: true }, // vàng satin
    silver: { c: 0xdcb866, m: 1, r: 0.26, env: 1.0 }, // spar vàng sáng
    brass: { c: 0xe0bb62, m: 1, r: 0.28, env: 1.0, rough: true }, // chi tiết vàng
    copper: { c: 0xd49a78, m: 1, r: 0.32, env: 0.95 }, // vàng hồng
    azure: { c: 0x3358c9, m: 0.2, r: 0.2, env: 0.9, cc: 1, ccr: 0.08 },
    carbon: { c: 0x1d2d63, m: 0.25, r: 0.24, env: 0.9 }, // sơn mài navy
    ivory: { c: 0xd9b660, m: 1, r: 0.27, env: 1.0, e: 0x1a1406, ei: 1 }, // khung cánh vàng
    // tím oải hương: ít phản chiếu (env thấp, nhám hơn) để đèn không làm bạc màu thành kem
    membrane: { c: 0x8f98e8, m: 0, r: 0.55, env: 0.3, op: 0.62, e: 0x2c3274, ei: 1 },
    amber: { c: 0xffd08a, m: 0, r: 0.3, env: 0.4, e: 0xffb85c, ei: 1.1 },
    optic: { c: 0x1f3fa6, m: 0.3, r: 0.12, env: 1.1, cc: 1, ccr: 0.05, ir: 0.6 },
    pearl: { c: 0xf2f0ec, m: 0.1, r: 0.2, env: 1.0, cc: 1, ccr: 0.1, ir: 1 },
  },
  obsidian: {
    steel: { c: 0x2a2624, m: 0.85, r: 0.5, env: 0.95, rough: true },
    shell: { c: 0x2a2624, m: 0.85, r: 0.5, env: 0.95, rough: true },
    plate: { c: 0x2f2a26, m: 0.85, r: 0.46, env: 0.95, rough: true },
    silver: { c: 0xb9b2a6, m: 0.9, r: 0.38, env: 0.55, rough: true },
    brass: { c: 0xa8834a, m: 1, r: 0.42, env: 0.6, rough: true },
    copper: { c: 0x9a5b3c, m: 1, r: 0.45, env: 0.55, rough: true },
    azure: { c: 0x3b4852, m: 0.9, r: 0.35, env: 0.6, rough: true },
    carbon: { c: 0x18181a, m: 0.2, r: 0.28, env: 0.5 },
    ivory: { c: 0xe8e0cf, m: 0.1, r: 0.6, env: 0.35, e: 0x14120e, ei: 1 },
    membrane: { c: 0x1a1512, m: 0.25, r: 0.3, env: 0.9, op: 0.5 }, // khói tối như ảnh Obsidian
    amber: { c: 0xffb35c, m: 0, r: 0.3, env: 0.3, e: 0xff9a3c, ei: 1.6 },
    optic: { c: 0x17120f, m: 0.35, r: 0.14, env: 0.9, cc: 1, ccr: 0.08 },
    pearl: { c: 0xe8e0cf, m: 0.1, r: 0.3, env: 0.6, cc: 0.6, ccr: 0.2 },
  },
};

/** Vai trò cần shader Physical (clearcoat/iridescence) — chỉ chi tiết NHỎ, tốn ít pixel. */
const PHYSICAL = new Set(['azure', 'optic', 'pearl']);

/** @param {Theme} theme */
export function createMaterialLibrary(theme) {
  const rough = brushedTexture();

  /**
   * Áp bảng màu lên một vật liệu (khi tạo và khi đổi chủ đề).
   * @param {any} m @param {MatKey} key @param {Theme} th
   */
  function applyPalette(m, key, th) {
    const p = PALETTES[th][key];
    m.color.setHex(p.c);
    m.metalness = p.m;
    m.roughness = p.r;
    m.envMapIntensity = p.env;
    m.roughnessMap = p.rough ? rough : null;
    if (m.isMeshPhysicalMaterial) {
      m.clearcoat = p.cc ?? 0;
      m.clearcoatRoughness = p.ccr ?? 0.2;
      m.iridescence = p.ir ?? 0;
      m.iridescenceIOR = 1.6;
    }
    if (m.emissive) {
      m.emissive.setHex(p.e ?? 0x000000);
      m.emissiveIntensity = p.ei ?? 1;
    }
    if (key === 'membrane') m.opacity = p.op ?? 0.5;
    m.needsUpdate = true; // đổi clearcoat/iridescence/roughnessMap cần biên dịch lại shader
  }

  /** @param {MatKey} key */
  function makeBase(key) {
    // Màng hai mặt trong suốt: three mặc định vẽ HAI lượt (mặt sau rồi mặt trước). Màng mỏng
    // không cần → forceSinglePass: một lượt, giảm một nửa chi phí tô phần diện tích lớn nhất.
    const opts = key === 'membrane'
      ? { transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true }
      : {};
    const m = PHYSICAL.has(key) ? new MeshPhysicalMaterial(opts) : new MeshStandardMaterial(opts);
    if (key === 'optic') m.flatShading = true;
    m.userData.matKey = key;
    applyPalette(m, key, theme);
    return m;
  }

  /** @type {Record<string, any>} */
  const base = {};
  for (const key of /** @type {MatKey[]} */ (Object.keys(PALETTES.azure))) base[key] = makeBase(key);

  const lib = {
    base,
    /** Chủ đề hiện hành — vật liệu tạo sau (mẫu dựng muộn) lấy đúng chủ đề này. */
    theme,
    applyPalette,
    /** @param {Theme} th */
    setTheme(th) {
      lib.theme = th;
      for (const key of /** @type {MatKey[]} */ (Object.keys(base))) applyPalette(base[key], key, th);
    },
    /**
     * @param {MatKey} key
     * @param {{doubleSide?: boolean}} [o]
     */
    make(key, o = {}) {
      const m = base[key].clone();
      m.userData.matKey = key;
      if (o.doubleSide) m.side = DoubleSide;
      return m;
    },
  };
  return lib;
}

/** @typedef {ReturnType<typeof createMaterialLibrary>} MaterialLibrary */
