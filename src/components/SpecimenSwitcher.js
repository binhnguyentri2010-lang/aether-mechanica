// @ts-check
// Nút chọn mẫu vật (plan đợt 3 §3/§5). Dựng từ danh sách do registry cấp — không gắn cứng ID trong HTML.
// Chỉ gọi store.actions.requestSpecimen(); mọi luật chuyển (huỷ, gen, khoá thao tác) nằm trong store.
// Nút được nhấn = ý định hiện tại (mẫu đang chờ nếu có, không thì mẫu đang xem). Mẫu chưa sẵn sàng
// → nút hiện "Preparing…" (aria-busy), cảnh KHÔNG fade cho tới khi mẫu dựng + warm xong.

export class SpecimenSwitcher {
  /**
   * @param {{
   *   root: HTMLElement, store: import('../core/store.js').Store,
   *   items: {id: string, no: string, short: string}[],
   *   onRequest: (id: string) => void,
   * }} o
   */
  constructor(o) {
    this.store = o.store;
    /** @type {Map<string, {btn: HTMLButtonElement, name: HTMLElement, short: string}>} */
    this.buttons = new Map();
    for (const it of o.items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.specimen = it.id;
      const no = document.createElement('b');
      no.textContent = it.no;
      const name = document.createElement('span');
      name.textContent = it.short;
      btn.append(no, name);
      btn.addEventListener('click', () => o.onRequest(it.id));
      o.root.appendChild(btn);
      this.buttons.set(it.id, { btn, name, short: it.short });
    }
    this.store.subscribe((st, ch) => {
      if (ch.specimen || ch.pendingSpecimen || ch.specimenPhase) this.sync();
    });
    this.sync();
  }

  sync() {
    const st = this.store.state;
    const intent = st.pendingSpecimen ?? st.specimen;
    for (const [id, b] of this.buttons) {
      b.btn.setAttribute('aria-pressed', String(id === intent));
      const preparing = st.specimenPhase === 'preparing' && st.pendingSpecimen === id;
      b.btn.setAttribute('aria-busy', String(preparing));
      b.btn.classList.toggle('preparing', preparing);
      const txt = preparing ? 'Preparing…' : b.short;
      if (b.name.textContent !== txt) b.name.textContent = txt;
    }
  }
}
