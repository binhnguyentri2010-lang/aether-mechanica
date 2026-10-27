// @ts-check
// GAITSPEC của husky (plan đợt 3 §6) — NGUỒN SỐ DUY NHẤT cho hình thể, chân và nhịp TROT.
// Mọi "cao" là KHOẢNG CÁCH TÍNH TỪ SÀN (unit = 10 cm); đổi sang toạ độ root bằng H(h) = GROUND_Y + h.
// Hình học (parts/*), rig (motion/TrotRig) và test đều đọc từ đây — sửa một số là mọi nơi đổi theo.
import { GROUND_Y } from '../../core/stage.js';

/** Cao tính từ sàn → y trong toạ độ root. @param {number} h */
export const H = (h) => GROUND_Y + h;

/** Mốc hình thể ở bind pose. */
export const BODY = {
  withers: 5.4, // đỉnh vai
  back: 5.2, // lưng
  chestBottom: 2.4, // đáy ngực
  earTop: 7.0,
  headTop: 6.1,
  nose: { h: 5.0, z: 4.2 },
  tailTip: { h: 6.4, z: -2.0 },
  width: 1.7, // bề ngang lớn nhất (kể cả tấm vai/hông)
};

/**
 * Chân. ankle = vị trí cổ chân (trước) / khớp hock (sau) SO VỚI ĐIỂM ĐẾ (sole), [dy, dz].
 * pole: −1 khuỷu ra sau (−Z), +1 gối ra trước (+Z). limits: góc gốc so với bind (độ), góc trong ở khớp giữa (độ).
 * @typedef {{
 *   id: 'FL'|'FR'|'HL'|'HR', front: boolean, side: 1|-1, x: number, rootH: number, rootZ: number,
 *   L1: number, L2: number, pole: 1|-1, ankle: [number, number], phase: number, flexDeg: number,
 *   limits: {root: [number, number], inner: [number, number]},
 * }} LegSpec
 */

const FRONT = { x: 0.72, rootH: 3.75, rootZ: 1.55, L1: 1.75, L2: 1.65, pole: /** @type {-1} */ (-1), ankle: /** @type {[number, number]} */ ([0.62, -0.08]), flexDeg: 40, limits: { root: /** @type {[number, number]} */ ([-40, 40]), inner: /** @type {[number, number]} */ ([95, 175]) } };
const HIND = { x: 0.66, rootH: 4.0, rootZ: -1.8, L1: 1.8, L2: 1.85, pole: /** @type {1} */ (1), ankle: /** @type {[number, number]} */ ([1.0, -0.18]), flexDeg: 30, limits: { root: /** @type {[number, number]} */ ([-40, 40]), inner: /** @type {[number, number]} */ ([80, 165]) } };

// Trái = +X: mẫu quay mặt về +Z, trục Y hướng lên → bên trái con vật nằm phía +X.
// Pha TROT: cặp chéo cùng pha — FL = HR = 0, FR = HL = 0.5.
/** @type {LegSpec[]} */
export const LEGS = [
  { id: 'FL', front: true, side: 1, ...FRONT, phase: 0 },
  { id: 'FR', front: true, side: -1, ...FRONT, phase: 0.5 },
  { id: 'HL', front: false, side: 1, ...HIND, phase: 0.5 },
  { id: 'HR', front: false, side: -1, ...HIND, phase: 0 },
];

/** Nhịp TROT. */
export const GAIT = {
  cycleHz: 2.2,
  duty: 0.55, // β ≥ 0.5 → luôn ≥ 2 chân chạm đất, không có khung "bay"
  D: 1.4, // quãng đế đi trong một stance
  h: 0.35, // độ nhấc chân khi swing
  bob: 0.05, // nhấp nhô thân, tần số 2f, thấp nhất giữa stance
  pitchDeg: 1.5, // chúi thân ±, tần số 2f
  rampUp: 1.0,
  rampDown: 0.8,
  /** Tâm chúi thân (toạ độ root): giữa thân. */
  pitchCenter: /** @type {[number, number]} */ ([H(3.85), 0]),
  /** Bước "đặt lại chân" sau khi dừng: thời gian mỗi cặp chéo, độ nhấc tối đa. */
  settleS: 0.18,
  settleH: 0.14,
};

/** Tốc độ băng chuyền = D·f/β (unit/s) — HUD đọc STRIDE/SPEED từ đây. */
export const BELT_SPEED = (GAIT.D * GAIT.cycleHz) / GAIT.duty;
/** Quãng đi mỗi chu kỳ = D/β (unit). */
export const STRIDE = GAIT.D / GAIT.duty;
