// @ts-check
// Spring tới hạn (critically damped). Dùng nghiệm giải tích cho từng bước nên ổn định với
// mọi dt — không bị nổ khi một khung kéo dài (tab vừa quay lại, máy yếu).

export class Spring {
  /** @param {number} value @param {number} [stiffness] */
  constructor(value, stiffness = 90) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
  }

  /** @param {number} dt giây */
  step(dt) {
    if (this.settled) return this.value;
    const w = Math.sqrt(this.stiffness);
    const x0 = this.value - this.target;
    const v0 = this.velocity;
    const e = Math.exp(-w * dt);
    const x = (x0 + (v0 + w * x0) * dt) * e;
    const v = (v0 - w * (v0 + w * x0) * dt) * e;
    this.value = this.target + x;
    this.velocity = v;
    if (Math.abs(x) < 2e-4 && Math.abs(v) < 2e-3) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.value;
  }

  get settled() {
    return this.value === this.target && this.velocity === 0;
  }

  /** @param {number} v */
  snap(v) {
    this.value = this.target = v;
    this.velocity = 0;
  }
}
