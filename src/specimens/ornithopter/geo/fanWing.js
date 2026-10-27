// @ts-check
// Cánh kiểu "Papilio" theo ảnh tham chiếu: quạt nan toả từ gốc, mép ngoài lượn sóng (scallop),
// mặt cánh cong như cái chén, forewing tam giác lớn, hindwing có đuôi én.
//
// Toạ độ mặt cánh: u = khoảng cách ra ngoài tính từ ĐƯỜNG CHỐT HINGE (x = ±0.35), v = z thế giới,
// y = độ cong (camber). Cánh được chia thành các "múi" giữa hai nan liền kề; mỗi múi là một mặt
// Coons đơn giản:  P(t, w) = lerp(A(t), B(t), w) + t³ · (M(w) − lerp(A(1), B(1), w))
//   A, B = hai nan (t: 0 ở gốc → 1 ở mép), M = đoạn mép lượn sóng giữa hai đầu nan.
// Nhờ vậy màng có lưới đỉnh bên trong → cong thật, không phải vài tam giác phẳng khổng lồ.
//
// Ràng buộc an toàn (plan §6/§16): forewing chỉ nằm ở z > −0.06, hindwing ở z < −0.2. Hai vùng z
// RỜI NHAU; vỗ cánh là quay quanh trục song song Z (giữ nguyên z) nên không thể chạm nhau;
// feathering kéo mép sau VỀ PHÍA spar (xa cánh kia). Test quét 48 pha xác nhận bằng số.

/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3  [u, v, y] */

/**
 * root = [gốc đầu, gốc cuối]: các nan xuất phát trải đều trên đoạn gốc này (nan 0 ở đầu, nan
 * cuối ở cuối) → gốc cánh rộng như mẫu, không thắt thành một "cuống" nhọn.
 * @typedef {{
 *   root: [P2, P2],
 *   ribs: {to: P2, bow: number}[],
 *   scallop: number[],
 *   camber: number,
 *   carpalT: number,
 *   crossT: number[],
 *   maxU: number|null,
 *   sprockets: {rib: number, R: number, teeth: number}[],
 * }} FanDef
 */

/** @type {FanDef} */
export const FORE_FAN = {
  root: [[0.03, 0.37], [0.03, 0.1]],
  // từ mép trước (spar) → mép sau; đầu nan nằm trên mép ngoài. Forewing thon, đỉnh nhọn chếch
  // ra trước như mẫu "Azure & Gold"; mép ngoài gần như trơn.
  ribs: [
    { to: [2.5, 1.12], bow: 0.05 },
    { to: [2.78, 0.94], bow: 0.035 },
    { to: [2.7, 0.64], bow: 0.02 },
    { to: [2.48, 0.38], bow: 0.0 },
    { to: [2.16, 0.16], bow: -0.01 },
    { to: [1.78, 0.0], bow: 0.035 }, // mép sau: hơi lõm VÀO trong (xa hindwing)
  ],
  scallop: [0.05, 0.06, 0.07, 0.07, 0.05],
  camber: 0.14,
  carpalT: 0.46,
  crossT: [0.76],
  maxU: 2.75, // sải cánh = 2 × (0.35 + 2.75) = 6.2 unit = 62 cm
  sprockets: [{ rib: 1, R: 0.1, teeth: 20 }, { rib: 4, R: 0.08, teeth: 16 }],
};

/** @type {FanDef} */
export const HIND_FAN = {
  root: [[0.03, -0.1], [0.03, -0.37]],
  // Hindwing tròn, mép ngoài nhiều thuỳ lượn sóng rõ, đuôi én phía sau
  ribs: [
    { to: [1.9, -0.38], bow: -0.02 }, // mép trước (costal) — hơi lõm, tránh xa forewing
    { to: [2.12, -0.66], bow: -0.02 },
    { to: [2.05, -1.0], bow: -0.02 },
    { to: [1.76, -1.3], bow: -0.02 },
    { to: [1.38, -1.52], bow: -0.015 },
    { to: [1.12, -1.66], bow: -0.01 },
    { to: [0.98, -2.2], bow: 0.0 }, // đuôi én
    { to: [0.8, -1.72], bow: 0.01 },
    { to: [0.46, -1.16], bow: 0.03 }, // mép trong
  ],
  scallop: [0.16, 0.17, 0.17, 0.16, 0.08, 0.035, 0.035, 0.06],
  camber: 0.1,
  carpalT: 0.5,
  crossT: [0.78],
  maxU: null,
  sprockets: [{ rib: 2, R: 0.09, teeth: 18 }, { rib: 5, R: 0.065, teeth: 14 }],
};

/** Bézier bậc hai. @param {P2} a @param {P2} c @param {P2} b @param {number} t @returns {P2} */
const quad = (a, c, b, t) => {
  const s = 1 - t;
  return [s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]];
};
/** Đạo hàm Bézier bậc hai. @param {P2} a @param {P2} c @param {P2} b @param {number} t @returns {P2} */
const dquad = (a, c, b, t) => [
  2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]),
  2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]),
];

/**
 * Dựng cánh quạt từ định nghĩa.
 * @param {FanDef} def
 */
export function buildFan(def) {
  // Chuẩn hoá bề ngang để mút cánh đúng maxU (kể cả phần lồi của scallop)
  let k = 1;
  const [RA, RB] = def.root;
  /** @type {P2} */
  const R0 = [(RA[0] + RB[0]) / 2, (RA[1] + RB[1]) / 2]; // tâm gốc: hướng "ra ngoài" của mép lượn
  /** @param {P2} p @returns {P2} */
  const S = (p) => [p[0] * k, p[1]];
  const last = def.ribs.length - 1;

  const ctrlRib = () =>
    def.ribs.map((r, i) => {
      const f = i / last;
      const a = S([RA[0] + (RB[0] - RA[0]) * f, RA[1] + (RB[1] - RA[1]) * f]);
      const b = S(r.to);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      /** @type {P2} */
      const c = [(a[0] + b[0]) / 2 - (dy / L) * r.bow * L, (a[1] + b[1]) / 2 + (dx / L) * r.bow * L];
      return { a, c, b };
    });
  const ctrlMargin = (/** @type {ReturnType<typeof ctrlRib>} */ ribs) =>
    def.scallop.map((sc, i) => {
      const a = ribs[i].b;
      const b = ribs[i + 1].b;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      let nx = -dy / L, ny = dx / L;
      const root = S(R0);
      if (nx * (mx - root[0]) + ny * (my - root[1]) < 0) { nx = -nx; ny = -ny; }
      /** @type {P2} */
      const c = [mx + nx * sc * L * 2, my + ny * sc * L * 2]; // ×2: đỉnh Bézier bậc hai lồi ra ½ khoảng
      return { a, c, b };
    });

  let ribs = ctrlRib();
  let margins = ctrlMargin(ribs);
  if (def.maxU) {
    let mu = 0;
    for (const m of margins) for (let i = 0; i <= 40; i++) mu = Math.max(mu, quad(m.a, m.c, m.b, i / 40)[0]);
    k = def.maxU / mu;
    ribs = ctrlRib();
    margins = ctrlMargin(ribs);
  }
  const n = margins.length; // số múi

  /** Điểm trên nan i tại t. @param {number} i @param {number} t */
  const rib = (i, t) => quad(ribs[i].a, ribs[i].c, ribs[i].b, t);
  /** Điểm trên mép múi i tại w. @param {number} i @param {number} w */
  const margin = (i, w) => quad(margins[i].a, margins[i].c, margins[i].b, w);

  /** Độ cong: chén hở lên, cao nhất ở giữa quạt, gần mép. @param {number} t @param {number} W */
  const camber = (t, W) => def.camber * Math.pow(t, 1.6) * Math.sin(Math.PI * W);

  /**
   * Điểm (u, v, y) của múi i tại (t, w).
   * @param {number} i @param {number} t @param {number} w @returns {P3}
   */
  const patch = (i, t, w) => {
    const A = rib(i, t), B = rib(i + 1, t);
    const A1 = rib(i, 1), B1 = rib(i + 1, 1);
    const M = margin(i, w);
    const k3 = t * t * t;
    const u = A[0] + (B[0] - A[0]) * w + k3 * (M[0] - (A1[0] + (B1[0] - A1[0]) * w));
    const v = A[1] + (B[1] - A[1]) * w + k3 * (M[1] - (A1[1] + (B1[1] - A1[1]) * w));
    return [u, v, camber(t, (i + w) / n)];
  };

  /** Nan i từ t0 tới t1 (nan 0 = spar). @param {number} i @param {number} t0 @param {number} t1 @param {number} [steps] */
  const ribLine = (i, t0, t1, steps = 24) => {
    /** @type {P3[]} */
    const out = [];
    for (let s = 0; s <= steps; s++) {
      const t = t0 + ((t1 - t0) * s) / steps;
      const p = rib(i, t);
      out.push([p[0], p[1], camber(t, i / n)]);
    }
    return out;
  };

  /** Đường đồng mức t (gân ngang / mép cắt carpal) chạy qua mọi múi. @param {number} t */
  const isoT = (t, per = 8) => {
    /** @type {P3[]} */
    const out = [];
    for (let i = 0; i < n; i++) for (let s = i ? 1 : 0; s <= per; s++) out.push(patch(i, t, s / per));
    return out;
  };

  /** Mép ngoài của múi i. @param {number} i */
  const marginLine = (i, steps = 14) => {
    /** @type {P3[]} */
    const out = [];
    for (let s = 0; s <= steps; s++) out.push(patch(i, 1, s / steps));
    return out;
  };

  /** Gân phụ giữa múi (đồng mức w). @param {number} i @param {number} w @param {number} t0 @param {number} t1 */
  const subVein = (i, w, t0, t1, steps = 16) => {
    /** @type {P3[]} */
    const out = [];
    for (let s = 0; s <= steps; s++) out.push(patch(i, t0 + ((t1 - t0) * s) / steps, w));
    return out;
  };

  // Khớp carpal trên spar (nan 0, camber = 0 ở đó) và hướng spar tại đó
  const tc = def.carpalT;
  const C = rib(0, tc);
  const dC = dquad(ribs[0].a, ribs[0].c, ribs[0].b, tc);
  const dl = Math.hypot(dC[0], dC[1]) || 1;
  /** @type {P2} */
  const d = [dC[0] / dl, dC[1] / dl];

  return { def, n, k, rib, margin, patch, ribLine, isoT, marginLine, subVein, camber, C, d, tc, ribCount: ribs.length };
}

/** @typedef {ReturnType<typeof buildFan>} Fan */
