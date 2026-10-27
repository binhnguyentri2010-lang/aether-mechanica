// @ts-check
// Toán TROT thuần (plan đợt 3 §6), không phụ thuộc mẫu vật cụ thể — thông số truyền vào (GaitParams).
//
// Pha tính theo CHU KỲ (0..1). Mỗi chân có pha lệch `off`; pha chân sLeg = frac(φ + off):
//   stance  sLeg ∈ [0, β):   đế ĐỨNG YÊN trên băng chuyền G → trong W lùi đều với v = D·a·f/β
//   swing   sLeg ∈ [β, 1):   Hermite bậc ba từ điểm nhấc tới điểm đặt (+D·a/2), vận tốc hai đầu =
//                            vận tốc băng chuyền (C1: không giật lúc nhấc/đặt), cao y = h·a·sin²(πs)
// Toạ độ trả về là ĐỘ LỆCH so với vị trí trung tính của cổ chân (z dọc thân, y theo phương đứng).
import { DEG } from '../core/easing.js';

/**
 * @typedef {{
 *   cycleHz: number, duty: number, D: number, h: number, bob: number, pitchDeg: number,
 *   rampUp: number, rampDown: number, pitchCenter: [number, number], settleS: number, settleH: number,
 * }} GaitParams
 * @typedef {{z: number, y: number, flex: number, swing: boolean}} Foot  flex: 0..1 (phần của góc gập tối đa)
 */

/** @param {number} x */
export const frac = (x) => x - Math.floor(x);

/** Hermite bậc ba trên [0,1]. @param {number} p0 @param {number} p1 @param {number} m0 @param {number} m1 @param {number} s */
export function hermite(p0, p1, m0, m1, s) {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
}

/** Tiếp tuyến Hermite của swing (đơn vị z / đơn vị s) = −v·T_swing = −D·a·(1−β)/β. @param {number} a @param {GaitParams} G */
export const swingTangent = (a, G) => (-G.D * a * (1 - G.duty)) / G.duty;

/** @returns {Foot} */
export const foot = () => ({ z: 0, y: 0, flex: 0, swing: false });

/**
 * Lời giải GIẢI TÍCH của một chân ở trạng thái ổn định (a, f không đổi).
 * @param {number} sLeg pha chân [0,1) @param {number} a biên độ 0..1 @param {GaitParams} G @param {Foot} out
 */
export function footAnalytic(sLeg, a, G, out) {
  const b = G.duty;
  if (sLeg < b) {
    out.z = (G.D * a) / 2 - G.D * a * (sLeg / b);
    out.y = 0;
    out.flex = 0;
    out.swing = false;
  } else {
    const s = (sLeg - b) / (1 - b);
    const m = swingTangent(a, G);
    out.z = hermite((-G.D * a) / 2, (G.D * a) / 2, m, m, s);
    const k = Math.sin(Math.PI * s) ** 2;
    out.y = G.h * a * k;
    out.flex = a * k;
    out.swing = true;
  }
  return out;
}

/** Nhấp nhô thân: tần số 2f, THẤP NHẤT giữa stance (φ = β/2 và β/2 + 0.5). @param {number} phi @param {number} a @param {GaitParams} G */
export const bodyBob = (phi, a, G) => -G.bob * a * Math.cos(4 * Math.PI * (phi - G.duty / 2));
/** Chúi thân ± pitchDeg, tần số 2f (rad). @param {number} phi @param {number} a @param {GaitParams} G */
export const bodyPitch = (phi, a, G) => G.pitchDeg * DEG * a * Math.sin(4 * Math.PI * (phi - G.duty / 2));

/**
 * Bộ lập kế hoạch CÓ TRẠNG THÁI: đúng lời giải giải tích khi a, f không đổi, nhưng khi a thay đổi
 * (tăng/giảm tốc) đế trong stance vẫn đứng yên trên băng chuyền — không trượt.
 *   stance: z = zTouch − (D/β)·A, A = ∫ a dφ kể từ lúc chạm đất  (quãng băng chuyền đã chạy)
 *   swing:  Hermite(zLift → D·a/2), tiếp tuyến theo a hiện tại
 */
export class GaitPlanner {
  /** @param {GaitParams} G @param {number[]} offsets pha lệch từng chân */
  constructor(G, offsets) {
    this.G = G;
    this.legs = offsets.map((off) => ({ off, stance: true, zTouch: 0, A: 0, zLift: 0, ...foot() }));
    this.phi = 0;
  }

  /** Về trạng thái nghỉ (mọi chân ở trung tính, đang stance). */
  reset() {
    this.phi = 0;
    for (const L of this.legs) {
      L.stance = true;
      L.zTouch = 0;
      L.A = 0;
      L.zLift = 0;
      L.z = 0;
      L.y = 0;
      L.flex = 0;
      L.swing = false;
    }
  }

  /** Tiến pha thêm dphi (chu kỳ, < 0.5) với biên độ a. @param {number} dphi @param {number} a */
  step(dphi, a) {
    const G = this.G;
    const b = G.duty;
    const p0 = this.phi;
    const p1 = p0 + dphi;
    for (const L of this.legs) {
      const s0 = frac(p0 + L.off);
      const s1raw = s0 + dphi; // có thể > 1 khi vượt mốc chạm đất
      if (L.stance) {
        if (s0 < b && s1raw >= b) {
          // Nhấc chân giữa bước này: cộng phần stance còn lại rồi chốt điểm nhấc
          L.A += a * (b - s0);
          L.zLift = L.zTouch - (G.D / b) * L.A;
          L.stance = false;
        } else {
          L.A += a * dphi;
        }
      } else if (s1raw >= 1) {
        // Chạm đất giữa bước này: điểm đặt = D·a/2, phần sau chạm tính vào stance mới
        L.stance = true;
        L.zTouch = (G.D * a) / 2;
        L.A = a * (s1raw - 1);
      }
      const s1 = s1raw >= 1 ? s1raw - 1 : s1raw;
      if (L.stance) {
        L.z = L.zTouch - (G.D / b) * L.A;
        L.y = 0;
        L.flex = 0;
        L.swing = false;
      } else {
        const s = (s1 - b) / (1 - b);
        const m = swingTangent(a, G);
        L.z = hermite(L.zLift, (G.D * a) / 2, m, m, s);
        const k = Math.sin(Math.PI * s) ** 2;
        L.y = G.h * a * k;
        L.flex = a * k;
        L.swing = true;
      }
    }
    this.phi = frac(p1);
  }
}
