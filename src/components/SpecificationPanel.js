// @ts-check
// SPECIFICATION. Bốn ô số liệu do MẪU VẬT cấp (SpecimenDef.specFields) — số đo lấy từ hình học,
// số chuyển động lấy từ hằng số của rig, không gõ tay ở đây. Component không import mẫu nào.

export class SpecificationPanel {
  /**
   * @param {{root: HTMLElement, onToggle: () => void}} o
   */
  constructor(o) {
    const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (o.root.querySelector(s));
    this.title = $('.spec-title');
    this.desc = $('.spec-desc');
    this.labels = [0, 1, 2, 3].map((i) => $('#spec-l' + i));
    this.cells = [0, 1, 2, 3].map((i) => $('#spec-v' + i));
    /** @type {import('../model/MechanicalModel.js').SpecimenDef|null} */ this.def = null;
    /** @type {import('../model/MechanicalModel.js').MechanicalModel|null} */ this.model = null;
    /** @type {'azure'|'obsidian'} */ this.theme = 'azure';

    const toggle = /** @type {HTMLButtonElement} */ (o.root.querySelector('.spec-toggle'));
    toggle.addEventListener('click', () => {
      const open = o.root.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      /** @type {HTMLElement} */ (toggle.querySelector('span')).textContent = open ? '−' : '+';
      o.onToggle();
    });
  }

  /**
   * @param {import('../model/MechanicalModel.js').SpecimenDef} def
   * @param {import('../model/MechanicalModel.js').MechanicalModel} model
   */
  setSpecimen(def, model) {
    this.def = def;
    this.model = model;
    this._render();
  }

  /** @param {'azure'|'obsidian'} theme */
  setTheme(theme) {
    this.theme = theme;
    this._render();
  }

  _render() {
    const def = this.def;
    if (!def || !this.model) return;
    setText(this.title, def.title);
    setText(this.desc, def.desc[this.theme]);
    const fields = def.specFields(this.model, this.theme);
    for (let i = 0; i < 4; i++) {
      setText(this.labels[i], fields[i] ? fields[i].label : '');
      setText(this.cells[i], fields[i] ? fields[i].value : '—');
    }
  }
}

/** Chỉ ghi DOM khi chữ đổi. @param {HTMLElement} el @param {string} s */
function setText(el, s) {
  if (el.textContent !== s) el.textContent = s;
}
