// @ts-check
// Bộ lập lịch render (plan §18, đợt 3 §8) — BA trạng thái:
//
//  ACTIVE    (~60 fps): có hệ nào đang animate (kéo, damping, spring, tween, intro, chuyển động,
//                        highlight, fade chuyển mẫu, dựng/warm nền).
//  IDLE      (30 fps → 20 fps sau 10 s không thao tác): chỉ còn hiệu ứng nền. reduced-motion → on-demand:
//                        ngủ hẳn tới khi invalidate().
//  SUSPENDED (0 fps):   tab ẩn, canvas khuất khỏi màn hình, mất context. Resume → đặt lại mốc thời gian
//                        (khung đầu dt = 1/60) → không "đuổi" nhiều giây trong một khung.
//
// Hạ chất lượng (chỉ HẠ, không nâng): chỉ xét khoảng cách giữa các khung ACTIVE liền nhau, gom thành
// cửa sổ 2 s; bỏ 5 s đầu và bỏ mọi cửa sổ có chuyển mẫu / biên dịch / warm / tab ẩn (isNoisy) hay khoảng
// hở > 250 ms. p95 > 22 ms trong 3 cửa sổ LIÊN TIẾP → onSlow() một lần (người gọi quyết định bậc:
// DPR −0.25 tới sàn 1.0, rồi chế độ "lite"). Idle ~33/50 ms là cố ý — không bao giờ tính.

export const WINDOW_MS = 2000;
export const WARMUP_MS = 5000;
export const SLOW_P95_MS = 22;
export const SLOW_WINDOWS = 3;

export class Scheduler {
  /**
   * @param {{
   *   frame: (dt: number, now: number) => boolean,
   *   onSlow?: () => void,
   *   isNoisy?: () => boolean,
   * }} opt  frame() trả true nếu còn hệ đang animate (Active)
   */
  constructor(opt) {
    this.frame = opt.frame;
    this.onSlow = opt.onSlow || (() => {});
    this.isNoisy = opt.isNoisy || (() => false);
    this.ambient = true;
    this.paused = false;
    /** Lý do tạm dừng đang có hiệu lực ('hidden' | 'offscreen' | 'context'). @type {Set<string>} */
    this.suspended = new Set();
    this._raf = 0;
    this._last = -1;
    this._busy = true;
    this._invalid = true;
    this._t0 = -1;
    this._lastInteract = -1;
    // Cửa sổ đo (cấp phát một lần, dùng lại)
    this._win = new Float64Array(512);
    this._n = 0;
    this._winMs = 0;
    this._winNoisy = false;
    this._badWindows = 0;
    this.slowEvents = 0;
    this._tick = this._tick.bind(this);
  }

  /** @returns {'active'|'idle'|'suspended'} */
  get state() {
    if (this.paused || this.suspended.size) return 'suspended';
    return this._busy || this._invalid ? 'active' : 'idle';
  }

  /** Nhịp idle hiện tại (fps): 30, còn 20 sau 10 s không thao tác. @param {number} ts */
  idleFps(ts) {
    const ref = this._lastInteract >= 0 ? this._lastInteract : this._t0;
    return ref >= 0 && ts - ref > 10000 ? 20 : 30;
  }

  start() {
    this.paused = false;
    this.invalidate();
  }

  stop() {
    this.paused = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /** Người dùng vừa thao tác (chuột, phím, chạm) → idle về lại 30 fps. */
  interact() {
    this._lastInteract = performance.now();
  }

  /** @param {string} reason */
  suspend(reason) {
    this.suspended.add(reason);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._winNoisy = true; // cửa sổ đo đang dở không còn đáng tin
  }

  /** @param {string} reason */
  resume(reason) {
    if (!this.suspended.delete(reason)) return;
    if (this.suspended.size) return;
    this._last = -1; // khung đầu sau resume: dt = 1/60
    this.invalidate();
  }

  /** Yêu cầu vẽ lại (sự kiện chuột, resize, đổi state...). */
  invalidate() {
    this._invalid = true;
    if (!this._raf && !this.paused && !this.suspended.size) this._raf = requestAnimationFrame(this._tick);
  }

  /** @param {number} ts */
  _tick(ts) {
    this._raf = 0;
    if (this.paused || this.suspended.size) return;
    if (this._t0 < 0) this._t0 = ts;
    if (this._last < 0) this._last = ts - 1000 / 60;
    const since = ts - this._last;
    const idle = !this._busy && !this._invalid;

    if (idle) {
      if (!this.ambient) return; // on-demand: ngủ tới khi invalidate()
      if (since < 1000 / this.idleFps(ts) - 4) {
        this._raf = requestAnimationFrame(this._tick);
        return;
      }
    }

    const dt = Math.min(0.05, Math.max(0, since / 1000));
    const wasBusy = this._busy;
    this._invalid = false;
    this._busy = this.frame(dt, ts);

    if (wasBusy && this._busy) this._measure(since, ts);

    this._last = ts;
    this._raf = requestAnimationFrame(this._tick);
  }

  /** @param {number} interval ms giữa hai khung ACTIVE liền nhau @param {number} ts */
  _measure(interval, ts) {
    if (ts - this._t0 < WARMUP_MS) return;
    if (interval > 250) this._winNoisy = true; // tab vừa quay lại / breakpoint
    if (this.isNoisy()) this._winNoisy = true;
    if (this._n < this._win.length) this._win[this._n++] = interval;
    this._winMs += interval;
    if (this._winMs < WINDOW_MS) return;
    if (this._winNoisy) this._badWindows = 0; // cửa sổ bị loại cắt chuỗi "liên tiếp"
    else if (this._n > 0) {
      const s = this._win.subarray(0, this._n).sort();
      const p95 = s[Math.min(this._n - 1, Math.floor(this._n * 0.95))];
      if (p95 > SLOW_P95_MS) this._badWindows++;
      else this._badWindows = 0;
      if (this._badWindows >= SLOW_WINDOWS) {
        this._badWindows = 0;
        this.slowEvents++;
        this.onSlow();
      }
    }
    this._n = 0;
    this._winMs = 0;
    this._winNoisy = false;
  }
}
