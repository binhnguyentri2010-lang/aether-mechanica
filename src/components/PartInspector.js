// @ts-check
// Panel thông tin nhỏ khi click một bộ phận. Không phải card: chỉ một đường kẻ mảnh và góc.
// Catalog do mẫu vật cấp qua setSpecimen() — component không import mẫu nào.

export class PartInspector {
  /** @param {{root: HTMLElement, onClose: () => void}} o */
  constructor(o) {
    this.root = o.root;
    this.root.innerHTML = `
      <p class="micro insp-head"><span class="insp-no"></span><span class="insp-count"></span></p>
      <h3 class="insp-name"></h3>
      <p class="insp-desc"></p>
      <dl class="insp-table">
        <div class="insp-inst-row"><dt>Instance</dt><dd class="insp-inst"></dd></div>
        <div><dt>Material</dt><dd class="insp-mat"></dd></div>
        <div><dt>Quantity</dt><dd class="insp-qty"></dd></div>
      </dl>
      <button type="button" class="insp-close micro">Esc — release</button>`;
    /** @param {string} s */
    const q = (s) => /** @type {HTMLElement} */ (this.root.querySelector(s));
    this.el = {
      no: q('.insp-no'), count: q('.insp-count'), name: q('.insp-name'), desc: q('.insp-desc'), mat: q('.insp-mat'), qty: q('.insp-qty'),
      inst: q('.insp-inst'), instRow: q('.insp-inst-row'),
    };
    /** Chữ mô tả instance được bấm (plan §7: "Front-left paw") — do mẫu vật cấp. @type {(name: string) => string|null} */
    this.instanceLabel = () => null;
    q('.insp-close').addEventListener('click', o.onClose);
    /** @type {'azure'|'obsidian'} */
    this.theme = 'azure';
    /** @type {import('../model/Part.js').Part|null} */
    this.part = null;
    /** @type {Record<string, import('../model/types.js').CatalogEntry>} */
    this.byId = {};
    this.total = 0;
  }

  /** @param {import('../model/MechanicalModel.js').SpecimenDef} def */
  setSpecimen(def) {
    this.byId = def.byId;
    this.total = def.catalog.filter((c) => c.no !== '—').length;
    this.instanceLabel = def.instanceLabel || (() => null);
    this.show(null);
  }

  /** @param {'azure'|'obsidian'} theme */
  setTheme(theme) {
    this.theme = theme;
    if (this.part) this.show(this.part);
  }

  /** @param {import('../model/Part.js').Part|null} part */
  show(part) {
    this.part = part;
    const c = part ? this.byId[part.kind] : null;
    if (!c) {
      this.root.classList.remove('open');
      this.root.setAttribute('aria-hidden', 'true');
      return;
    }
    this.el.no.textContent = c.no === '—' ? 'Component' : `Component ${c.no}`;
    this.el.count.textContent = c.no === '—' ? '' : ` / ${this.total}`;
    this.el.name.textContent = c.name;
    this.el.desc.textContent = c.desc;
    this.el.mat.textContent = c.mat[this.theme];
    this.el.qty.textContent = c.qty;
    const inst = /** @type {any} */ (part).name ? this.instanceLabel(/** @type {any} */ (part).name) : null;
    this.el.inst.textContent = inst || '';
    this.el.instRow.hidden = !inst;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
  }
}
