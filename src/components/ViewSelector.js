// @ts-check
// ISO · PLAN · FRONT · PROFILE + ORBIT (tự quay chậm).

export class ViewSelector {
  /** @param {{root: HTMLElement, store: import('../core/store.js').Store}} o */
  constructor(o) {
    const { store } = o;
    /** @type {HTMLButtonElement[]} */
    this.buttons = [...o.root.querySelectorAll('[data-view]')].map((b) => /** @type {HTMLButtonElement} */ (b));
    this.orbit = /** @type {HTMLButtonElement} */ (o.root.querySelector('#orbit'));
    for (const b of this.buttons)
      b.addEventListener('click', () => store.actions.setView(/** @type {any} */ (b.dataset.view)));
    this.orbit.addEventListener('click', () => store.actions.toggleAutoOrbit());
    const sync = () => {
      const st = store.state;
      for (const b of this.buttons) b.setAttribute('aria-pressed', String(b.dataset.view === st.viewPreset && !st.selectedPartId));
      this.orbit.setAttribute('aria-pressed', String(st.autoOrbit));
    };
    store.subscribe((_, ch) => {
      if (ch.viewPreset || ch.viewNonce || ch.selectedPartId || ch.autoOrbit) sync();
    });
    sync();
  }
}
