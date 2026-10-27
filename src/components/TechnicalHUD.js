// @ts-check
// HUD: chủ đề (Azure & Gold / Obsidian), chip vật liệu (hover → sáng part cùng vật liệu),
// trạng thái, số đo camera sống, gợi ý thao tác.

/** Tên chip theo chủ đề: cùng một nhóm vai trò vật liệu, tên gọi đổi theo bảng màu. */
const CHIP_NAMES = {
  azure: { azure: 'Azure Enamel', gold: 'Gold', pearl: 'Pearl' },
  obsidian: { azure: 'Azure Steel', gold: 'Bronze', pearl: 'Ivory' },
};

export class TechnicalHUD {
  /**
   * @param {{root: HTMLElement, store: import('../core/store.js').Store, coarse: boolean}} o
   */
  constructor(o) {
    const { root, store } = o;
    this.store = store;
    this.root = root;
    this.status = /** @type {HTMLElement} */ (root.querySelector('#status'));
    this.statusText = /** @type {HTMLElement} */ (this.status.querySelector('span'));
    this.readout = /** @type {HTMLElement} */ (root.querySelector('#readout'));
    this.lastStatus = '';
    this.lastRead = '';
    this.nextRead = 0;
    /** Chữ trạng thái khi chuyển động — do mẫu vật cấp ("In flight"…). */
    this.motionText = 'In motion';

    for (const chip of root.querySelectorAll('[data-mat]')) {
      const key = /** @type {HTMLElement} */ (chip).dataset.mat || null;
      chip.addEventListener('pointerenter', () => store.actions.setHoveredMaterial(key));
      chip.addEventListener('pointerleave', () => store.actions.setHoveredMaterial(null));
      chip.addEventListener('focus', () => store.actions.setHoveredMaterial(key));
      chip.addEventListener('blur', () => store.actions.setHoveredMaterial(null));
      // Trên cảm ứng: chạm để bật/tắt
      chip.addEventListener('click', () => {
        const cur = store.state.hoveredMaterial;
        store.actions.setHoveredMaterial(cur === key ? null : key);
      });
    }
    for (const b of root.querySelectorAll('[data-theme-btn]'))
      b.addEventListener('click', () => store.actions.setTheme(/** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.themeBtn)));
    root.classList.toggle('is-touch', o.coarse);
    this.syncTheme(store.state.theme);
  }

  /** @param {'azure'|'obsidian'} theme */
  syncTheme(theme) {
    for (const b of this.root.querySelectorAll('[data-theme-btn]'))
      b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.themeBtn === theme));
    const names = CHIP_NAMES[theme];
    for (const s of this.root.querySelectorAll('[data-label]'))
      s.textContent = names[/** @type {'azure'|'gold'|'pearl'} */ (/** @type {HTMLElement} */ (s).dataset.label)];
  }

  /** @param {string} text */
  setMotionText(text) {
    this.motionText = text;
    this.lastStatus = ''; // buộc ghi lại chữ ở lần update sau
  }

  /**
   * @param {number} now ms @param {number} e @param {number} motionAmp
   * @param {{az: number, el: number, dist: number, fov: number}} cam
   */
  update(now, e, motionAmp, cam) {
    let st;
    if (motionAmp > 0.02 || this.store.state.mode === 'motion') st = 'motion';
    else if (e > 0.005) st = 'exp:' + Math.round(e * 100);
    else st = 'rest';
    if (st !== this.lastStatus) {
      this.lastStatus = st;
      this.status.dataset.state = st.startsWith('exp') ? 'exploded' : st;
      this.statusText.textContent = st === 'motion' ? this.motionText : st === 'rest' ? 'At rest' : `Exploded ${st.slice(4)}%`;
    }
    if (now < this.nextRead) return;
    this.nextRead = now + 100; // 10 Hz là đủ cho mắt, đỡ ghi DOM
    const txt = `AZ ${cam.az.toFixed(1).padStart(5, '0')}°  ·  EL ${cam.el.toFixed(1).padStart(4, '0')}°  ·  DIST ${cam.dist.toFixed(2)} M  ·  FOV ${Math.round(cam.fov)}°`;
    if (txt !== this.lastRead) {
      this.lastRead = txt;
      this.readout.textContent = txt;
    }
  }
}
