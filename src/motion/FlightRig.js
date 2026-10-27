// @ts-check
// TAKE FLIGHT (plan §16).
//
// • Pha TÍCH PHÂN theo thời gian: φ += 2π·f·dt. Viết sin(2π·f(t)·t) sẽ làm pha nhảy cóc khi f đang
//   tăng → cánh giật loạn trong 1.2s đầu.
// • Sóng bất đối xứng bằng hàm uốn pha trơn ψ = φ + 0.347·(1 − cos φ):
//   ψ(0.8π) = π  → đập xuống chiếm 40% chu kỳ, nâng lên 60%; đạo hàm 1 + 0.347·sin φ > 0 và liên tục.
// • Forewing và hindwing cùng phía dùng CÙNG một pha vỗ chính; hai chốt nằm trên một đường thẳng
//   nên khoảng cách giữa hai cánh được bảo toàn. Feathering khác nhau giữa hai cánh → có test quét.
// • HUD đọc ANGLE/RATE từ chính các hằng số ở đây: sửa chuyển động là chữ tự đổi theo.
import { DEG, smoothstep } from '../core/easing.js';

export const STROKE_UP_DEG = 60;
export const STROKE_DOWN_DEG = 52;
export const STROKE_DEG = STROKE_UP_DEG + STROKE_DOWN_DEG; // 112°
export const RATE_HZ = 2.8;
export const RAMP_S = 1.2;
export const STOP_S = 0.6;
export const FEATHER_FORE_DEG = 12;
export const FEATHER_HIND_DEG = 8;
const WARP = 0.2 * Math.PI / (1 - Math.cos(0.8 * Math.PI)); // ≈ 0.347

const MID = ((STROKE_UP_DEG - STROKE_DOWN_DEG) / 2) * DEG;
const HALF = (STROKE_DEG / 2) * DEG;
const TAU = Math.PI * 2;

/** @param {number} phi pha [0, 2π) → pha đã uốn */
export const warpPhase = (phi) => phi + WARP * (1 - Math.cos(phi));

/**
 * Góc vỗ chính (radian) tại pha phi với biên độ chuẩn hoá amp ∈ [0,1].
 * @param {number} phi @param {number} amp
 */
export const flapAngle = (phi, amp) => amp * (MID + HALF * Math.cos(warpPhase(phi)));

/** @param {number} phi @param {number} amp @param {'fore'|'hind'} which */
export const featherAngle = (phi, amp, which) =>
  which === 'fore'
    ? amp * FEATHER_FORE_DEG * DEG * Math.sin(warpPhase(phi))
    : amp * FEATHER_HIND_DEG * DEG * Math.sin(warpPhase(phi) - 0.35);

/**
 * Interface MotionRig (chung cho FlightRig và TrotRig sau này):
 *   update(dt, want, explodeNow) → boolean   chỉ chuyển động khi explodeNow < 0.05
 *   secondary(dt)                            chuyển động phụ (chỉ DOF của rig)
 *   pose(phase, amp)                         đặt tư thế TUYỆT ĐỐI theo pha/biên độ — không cộng dồn
 *   onDeactivate()                           về tư thế chuẩn, reset pha/biên độ/đồng hồ
 *   ampE, lastStep, phase
 */
export class FlightRig {
  /** @param {import('../model/MechanicalModel.js').MechanicalModel} model */
  constructor(model) {
    this.model = model;
    this.phase = 0;
    this.freq = 0;
    this.amp = 0; // tuyến tính 0..1
    this.ampE = 0; // đã làm mềm
    this.gearAngle = 0;
    this.lastStep = 0; // độ lớn bước pha gần nhất (cho test tính liên tục)
  }

  /**
   * @param {number} dt @param {boolean} wantFlight @param {number} explodeNow
   * @returns {boolean} còn đang chuyển động
   */
  update(dt, wantFlight, explodeNow) {
    const engage = wantFlight && explodeNow < 0.05;
    if (engage) this.amp = Math.min(1, this.amp + dt / RAMP_S);
    else this.amp = Math.max(0, this.amp - dt / STOP_S);
    this.ampE = smoothstep(0, 1, this.amp);

    // Tần số: tăng cùng biên độ khi cất cánh; khi dừng giữ nguyên để cánh chậm dần theo biên độ
    if (engage) this.freq = RATE_HZ * Math.max(this.ampE, 0.15);
    else if (this.amp === 0) this.freq = 0;

    const step = TAU * this.freq * dt;
    this.lastStep = step;
    this.phase = (this.phase + step) % TAU;
    this.pose();
    return this.amp > 0 || engage;
  }

  /** Đặt tư thế theo pha/biên độ hiện tại (cũng dùng cho test quét va chạm). */
  pose(phase = this.phase, ampE = this.ampE) {
    const m = this.model;
    const theta = flapAngle(phase, ampE);
    for (const w of m.data.wings) {
      w.module.pivot.rotation.set(0, 0, w.s * theta);
      w.feather.quaternion.setFromAxisAngle(w.fAxis, w.s * featherAngle(phase, ampE, w.which));
      // Bánh răng đồng trục quay cùng cánh; bánh con ăn khớp quay ngược theo tỉ số răng
      w.pinion.pivot.rotation.z = w.pinion.userData.phase - (26 / 11) * w.s * theta;
    }
    m.updateLinkages();
    // Thân nhấp nhô và chúi nhẹ ở 2× tần số vỗ
    m.motionRoot.position.y = ampE * 0.045 * Math.sin(2 * phase + 0.6);
    m.motionRoot.rotation.x = ampE * 2.2 * DEG * Math.sin(2 * phase);
  }

  /** Chuyển động phụ luôn chạy (bánh răng lưng, kim đồng hồ). @param {number} dt */
  secondary(dt) {
    const m = this.model;
    this.gearAngle += dt * this.ampE * 5.5;
    const [g0, g1, g2] = m.data.thorax.train;
    g0.pivot.rotation.y = this.gearAngle;
    g1.pivot.rotation.y = Math.PI / 12 - this.gearAngle * (22 / 12);
    g2.pivot.rotation.y = Math.PI / 12 - this.gearAngle * (22 / 12);
    m.data.thorax.needle.rotation.y = 1.1 - this.ampE * 2.1 - this.ampE * 0.06 * Math.sin(this.phase);
  }

  /** Rời mẫu (chuyển sang mẫu khác): về tư thế chuẩn, reset mọi trạng thái của rig. */
  onDeactivate() {
    this.phase = 0;
    this.freq = 0;
    this.amp = 0;
    this.ampE = 0;
    this.gearAngle = 0;
    this.lastStep = 0;
    this.pose(0, 0);
    this.secondary(0);
  }
}
