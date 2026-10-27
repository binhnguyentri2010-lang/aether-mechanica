// @ts-check
// TROT — rig chuyển động của mẫu bốn chân (plan đợt 3 §5–§6). Cùng interface MotionRig với FlightRig:
//   update(dt, want, explodeNow) → boolean   chỉ chạy khi explodeNow < 0.05 (luật store/rig)
//   secondary(dt, amb)                       đầu gật, tai, hàm, đuôi (+ nhịp nghỉ khi amb > 0)
//   pose(phase, amp)                         tư thế TUYỆT ĐỐI theo lời giải giải tích (test tất định)
//   onDeactivate()                           về bind pose, reset pha/biên độ/đồng hồ
//
// Thứ tự ghi mỗi khung (§5): thân (bob/pitch) → IK chân → bàn chân → linkage (piston, qua model) ; phụ
// ghi sau trong secondary(). Mọi góc ghi TUYỆT ĐỐI → không phụ thuộc lịch sử khi (pha, biên độ) như nhau.
// 0 cấp phát mỗi khung: mọi vector/đối tượng tạm cấp sẵn trong constructor.
import { smoothstep, DEG, clamp } from '../core/easing.js';
import { solveIK2, ik2 } from './ik.js';
import { GaitPlanner, footAnalytic, foot, bodyBob, bodyPitch, frac, hermite } from './gait.js';

/**
 * Dữ liệu mẫu vật cần cho rig (mẫu tự cấp qua model.data — motion/ không import specimens/).
 * @typedef {{
 *   spec: {L1: number, L2: number, pole: number, ankle: [number, number], phase: number, flexDeg: number, front: boolean},
 *   actuator: import('../model/Part.js').Part, upper: import('../model/Part.js').Part,
 *   lower: import('../model/Part.js').Part, paw: import('../model/Part.js').Part,
 * }} QuadLeg
 * @typedef {{
 *   gait: import('./gait.js').GaitParams, ground: number, legs: QuadLeg[],
 *   head: {skull: import('../model/Part.js').Part, jaw: import('../model/Part.js').Part, ears: import('../model/Part.js').Part[]},
 *   tail: import('../model/Part.js').Part[], jawMax: number,
 * }} QuadData
 */

export class TrotRig {
  /** @param {import('../model/MechanicalModel.js').MechanicalModel} model */
  constructor(model) {
    this.model = model;
    /** @type {QuadData} */
    this.q = model.data;
    const G = this.q.gait;
    this.G = G;
    this.planner = new GaitPlanner(G, this.q.legs.map((l) => l.spec.phase));
    this.lin = 0; // biên độ tuyến tính 0..1
    this.amp = 0; // = ampE (đã làm mềm) — tên trùng FlightRig cho test/HUD dùng chung
    this.ampE = 0;
    this.phase = 0; // pha chu kỳ [0,1)
    this.cycles = 0; // tổng số chu kỳ đã chạy (không quấn) — test so với ∫f dt
    this.lastStep = 0; // bước pha gần nhất (rad) — cùng nghĩa với FlightRig
    this.idleT = 0;
    this.belt = 0; // quãng băng chuyền đã chạy (unit) — lưới sàn G trượt theo
    this.speed = 0; // tốc độ băng chuyền hiện tại (unit/s)
    /** Đặt lại chân sau khi dừng: null = không, còn lại = {pair, t, from: z[], lift: number[]} */
    /** @type {null | {pair: number, t: number, from: number[], lift: number[]}} */
    this.settle = null;
    this._ik = ik2();
    this._f = foot();
    /** Độ lệch từng chân so với trung tính (dùng cho pose). */
    this._feet = this.q.legs.map(() => foot());
    /** Góc thực đã ghi — test kiểm giới hạn khớp. */
    this.joints = this.q.legs.map(() => ({ root: 0, inner: 0, clamped: false }));
    this.pitch = 0;
    this.bob = 0;
    this.moving = false;
  }

  /**
   * @param {number} dt @param {boolean} want @param {number} explodeNow
   * @returns {boolean} còn đang chuyển động
   */
  update(dt, want, explodeNow) {
    const G = this.G;
    const engage = want && explodeNow < 0.05 && !this.settle;
    if (engage) this.lin = Math.min(1, this.lin + dt / G.rampUp);
    else this.lin = Math.max(0, this.lin - dt / G.rampDown);
    const a = smoothstep(0, 1, this.lin);
    this.ampE = this.amp = a;

    if (a > 0 || engage) {
      const dphi = G.cycleHz * dt;
      this.planner.step(dphi, a);
      this.cycles += dphi;
      this.phase = this.planner.phi;
      this.lastStep = dphi * Math.PI * 2;
      this.speed = (G.D * a * G.cycleHz) / G.duty;
      this.belt += this.speed * dt;
      for (let i = 0; i < this._feet.length; i++) {
        const L = this.planner.legs[i];
        const F = this._feet[i];
        F.z = L.z;
        F.y = L.y;
        F.flex = L.flex;
      }
      this._apply(this.phase, a);
      this.moving = true;
      return true;
    }
    this.lastStep = 0;
    this.speed = 0;
    if (this.moving) {
      // Biên độ vừa về 0 ở khung này → bắt đầu đặt lại chân (hoặc về nghỉ ngay nếu đã trung tính)
      this.moving = false;
      this._beginSettle();
      return true;
    }
    if (this.settle) {
      this._stepSettle(dt);
      return true;
    }
    return false;
  }

  /** Biên độ vừa về 0: nếu còn chân lệch khỏi trung tính → đặt lại từng cặp chéo. */
  _beginSettle() {
    let off = false;
    for (const F of this._feet) if (Math.abs(F.z) > 1e-4 || F.y > 1e-4) off = true;
    if (!off) {
      this._reset();
      return;
    }
    this.settle = {
      pair: 0, t: 0,
      from: this._feet.map((F) => F.z),
      lift: this._feet.map((F) => Math.min(this.G.settleH, 0.35 * Math.abs(F.z) + 0.03)),
    };
  }

  /** @param {number} dt */
  _stepSettle(dt) {
    const S = /** @type {NonNullable<TrotRig['settle']>} */ (this.settle);
    const G = this.G;
    S.t += dt / G.settleS;
    const s = Math.min(1, S.t);
    for (let i = 0; i < this._feet.length; i++) {
      // cặp 0 = pha lệch 0 (FL + HR), cặp 1 = pha lệch 0.5 (FR + HL)
      const pair = this.q.legs[i].spec.phase < 0.25 ? 0 : 1;
      const F = this._feet[i];
      if (pair < S.pair) continue; // cặp trước đã về chỗ
      if (pair > S.pair) continue;
      if (Math.abs(S.from[i]) <= 1e-4) {
        F.z = 0;
        F.y = 0;
        F.flex = 0;
        continue;
      }
      F.z = hermite(S.from[i], 0, 0, 0, s);
      const k = Math.sin(Math.PI * s) ** 2;
      F.y = S.lift[i] * k;
      F.flex = 0.3 * k;
    }
    this._apply(0, 0);
    if (s >= 1) {
      if (S.pair === 0) {
        S.pair = 1;
        S.t = 0;
      } else this._reset();
    }
  }

  /** Về nghỉ tuyệt đối: pha 0, chân trung tính, bind pose. */
  _reset() {
    this.settle = null;
    this.planner.reset();
    this.phase = 0;
    for (const F of this._feet) {
      F.z = 0;
      F.y = 0;
      F.flex = 0;
    }
    this._apply(0, 0);
  }

  /** Tư thế theo LỜI GIẢI GIẢI TÍCH (không trạng thái) — test tất định và so với planner. @param {number} [phase] @param {number} [amp] */
  pose(phase = this.phase, amp = this.ampE) {
    for (let i = 0; i < this._feet.length; i++) footAnalytic(frac(phase + this.q.legs[i].spec.phase), amp, this.G, this._feet[i]);
    this._apply(phase, amp);
    this._secondary(phase, amp, 0);
  }

  /**
   * Ghi thân + chân từ this._feet. @param {number} phase @param {number} a
   */
  _apply(phase, a) {
    const m = this.model;
    const G = this.G;
    const ground = this.q.ground;
    // 1. Thân: nhấp nhô + chúi quanh tâm (cy, cz) → motionRoot.position bù để quay quanh tâm đó
    const rho = bodyPitch(phase, a, G);
    const bob = bodyBob(phase, a, G);
    this.pitch = rho;
    this.bob = bob;
    const [cy, cz] = G.pitchCenter;
    const cr = Math.cos(rho), sr = Math.sin(rho);
    const R = m.motionRoot;
    R.rotation.set(rho, 0, 0);
    // P = (0, bob, 0) + C − Rx(ρ)·C
    R.position.set(0, bob + cy - (cy * cr - cz * sr), cz - (cy * sr + cz * cr));
    const Py = R.position.y, Pz = R.position.z;

    // 2. Chân: đích cổ chân trong W → hệ thân → IK
    for (let i = 0; i < this.q.legs.length; i++) {
      const Lg = this.q.legs[i];
      const sp = Lg.spec;
      const F = this._feet[i];
      const root = Lg.actuator.group.position; // gốc chân trong hệ thân (motionRoot)
      // Cổ chân trung tính: thẳng dưới gốc, cao ankle[0] trên sàn
      const wy = ground + sp.ankle[0] + F.y;
      const wz = root.z + F.z;
      // b = Rx(−ρ)·(w − P)
      const qy = wy - Py, qz = wz - Pz;
      const by = qy * cr + qz * sr;
      const bz = -qy * sr + qz * cr;
      const ik = solveIK2(root.y, root.z, by, bz, sp.L1, sp.L2, sp.pole, this._ik);
      Lg.upper.pivot.rotation.x = -ik.psi1;
      Lg.lower.pivot.rotation.x = -(ik.psi2 - ik.psi1);
      // Bàn chân: góc trong W = +flex (gập ra sau) → trong hệ đoạn dưới: flex − ρ + ψ2
      Lg.paw.pivot.rotation.x = F.flex * sp.flexDeg * DEG - rho + ik.psi2;
      const J = this.joints[i];
      J.root = ik.psi1;
      J.inner = ik.inner;
      J.clamped = ik.clamped;
    }
    // 3. Linkage (piston) — chủ là mẫu vật
    m.updateLinkages();
  }

  /**
   * Chuyển động phụ: đầu gật, hàm, tai, đuôi. Nhịp TROT theo pha; nhịp NGHỈ (đuôi đưa chậm, tai giật)
   * chỉ khi amb > 0 (reduced-motion → 0). Ghi tuyệt đối.
   * @param {number} dt @param {number} [amb]
   */
  secondary(dt, amb = 0) {
    this.idleT += dt * amb;
    this._secondary(this.phase, this.ampE, amb);
  }

  /** @param {number} phi @param {number} a @param {number} amb */
  _secondary(phi, a, amb) {
    const q = this.q;
    const w = 4 * Math.PI * phi; // 2f
    const idle = amb * (1 - a);
    const t = this.idleT;
    q.head.skull.pivot.rotation.x = a * 2.2 * DEG * Math.sin(w - 0.6);
    q.head.jaw.pivot.rotation.x = clamp(a * (0.3 + 0.2 * Math.sin(w + 1.1)) * q.jawMax + idle * 0.08 * q.jawMax * (1 + Math.sin(t * 1.3)), 0, q.jawMax);
    q.head.ears.forEach((e, i) => {
      e.pivot.rotation.x = a * 4 * DEG * Math.sin(w + 0.8 + i * 0.4) + idle * 2.5 * DEG * Math.max(0, Math.sin(t * 0.9 + i * 2.1)) ** 8;
    });
    const n = q.tail.length;
    q.tail.forEach((l, i) => {
      const k = (i + 1) / n;
      l.pivot.rotation.y = (a * 9 * DEG * (0.6 + 0.4 * k)) * Math.sin(2 * Math.PI * phi - i * 0.35) + idle * 5 * DEG * k * Math.sin(t * 2.1 - i * 0.45);
      l.pivot.rotation.x = a * 2 * DEG * Math.sin(w - i * 0.3);
    });
  }

  /** Rời mẫu: về bind pose, reset mọi trạng thái. */
  onDeactivate() {
    this.lin = 0;
    this.amp = this.ampE = 0;
    this.cycles = 0;
    this.lastStep = 0;
    this.idleT = 0;
    this.belt = 0;
    this.speed = 0;
    this.moving = false;
    this._reset();
    this._secondary(0, 0, 0);
  }
}
