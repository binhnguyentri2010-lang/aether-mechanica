// @ts-check
// ASSEMBLED ⇄ EXPLODED (slider thật + hai nhãn) và nút chuyển động (chữ do mẫu vật cấp:
// "Take Flight" cho bướm…). Chỉ gọi action của store — luật "đang chuyển động mà nổ thì dừng" nằm
// trong store, không nằm ở đây.

export class ExplodedControls {
  /**
   * @param {{root: HTMLElement, store: import('../core/store.js').Store}} o
   */
  constructor(o) {
    const { store } = o;
    this.store = store;
    this.slider = /** @type {HTMLInputElement} */ (o.root.querySelector('#explode'));
    this.readout = /** @type {HTMLOutputElement} */ (o.root.querySelector('#explode-val'));
    this.motionBtn = /** @type {HTMLButtonElement} */ (o.root.querySelector('#flight'));
    this.lastPct = -1;
    /** @type {{start: string, stop: string, status: string}} */
    this.labels = { start: this.motionBtn.textContent || '', stop: '', status: '' };

    const s = this.slider;
    const commit = () => store.actions.setExplode(Number(s.value) / 1000, { dragging: false });
    s.addEventListener('pointerdown', () => store.actions.setExplode(Number(s.value) / 1000, { dragging: true }));
    s.addEventListener('input', () => store.actions.setExplode(Number(s.value) / 1000, { dragging: true }));
    s.addEventListener('change', commit);
    s.addEventListener('pointerup', commit);
    s.addEventListener('blur', commit);

    for (const b of o.root.querySelectorAll('[data-explode]'))
      b.addEventListener('click', () => store.actions.setExplode(Number(/** @type {HTMLElement} */ (b).dataset.explode)));

    this.motionBtn.addEventListener('click', () => store.actions.toggleMotion());

    store.subscribe((st, ch) => {
      if (ch.explodeTarget && !st.isDraggingExplode) s.value = String(Math.round(st.explodeTarget * 1000));
      if (ch.mode) this._syncButton();
    });
  }

  /** @param {{start: string, stop: string, status: string}} labels */
  setLabels(labels) {
    this.labels = labels;
    this._syncButton();
  }

  _syncButton() {
    const on = this.store.state.mode === 'motion';
    const txt = on ? this.labels.stop : this.labels.start;
    if (this.motionBtn.textContent !== txt) this.motionBtn.textContent = txt;
    this.motionBtn.setAttribute('aria-pressed', String(on));
    this.motionBtn.classList.toggle('on', on);
  }

  /** Readout theo giá trị explode ĐANG hiển thị (không phải target). @param {number} e */
  update(e) {
    const pct = Math.round(e * 100);
    if (pct !== this.lastPct) {
      this.lastPct = pct;
      this.readout.textContent = String(pct).padStart(3, '0') + '%';
    }
  }
}
