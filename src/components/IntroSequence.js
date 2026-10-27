// @ts-check
// Chuỗi xuất hiện lúc load (plan §17):
//   0ms khung vẽ ra → 150ms blueprint → 400ms model hiện dần từ bóng tối + scale 0.96→1
//   → 900ms leader vẽ ra (so le 40ms) → 1300ms nhãn hiện. reduced-motion → hiện thẳng trạng thái cuối.
import { clamp, easeOutCubic } from '../core/easing.js';

const STEPS = /** @type {[number, string][]} */ ([
  [0, 'in-frame'], [0.15, 'in-bp'], [0.2, 'in-hud'], [0.4, 'in-model'], [0.9, 'in-leaders'], [1.3, 'in-labels'],
]);

export class IntroSequence {
  /** @param {{app: HTMLElement, reduced: boolean}} o */
  constructor(o) {
    this.app = o.app;
    this.t = o.reduced ? 10 : 0;
    this.done = false;
    this.applied = new Set();
    this.modelK = 0;
    this.bpK = 0;
    this._apply();
  }

  _apply() {
    for (const [at, cls] of STEPS)
      if (this.t >= at && !this.applied.has(cls)) {
        this.applied.add(cls);
        this.app.classList.add(cls);
      }
    this.modelK = easeOutCubic(clamp((this.t - 0.4) / 1.1));
    this.bpK = easeOutCubic(clamp((this.t - 0.15) / 0.9));
  }

  /** @param {number} dt @returns {boolean} đang chạy */
  update(dt) {
    if (this.done) return false;
    this.t += dt;
    this._apply();
    if (this.t >= 1.9) {
      this.done = true;
      this.app.classList.remove('is-intro');
      this.app.classList.add('is-ready');
    }
    return !this.done;
  }
}
