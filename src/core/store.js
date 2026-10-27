// @ts-check
// NGUỒN SỰ THẬT DUY NHẤT cho mode và luật chuyển trạng thái (plan §4 đợt 1, §3 đợt 3).
//
// Store chỉ giữ trạng thái RỜI RẠC + target. Giá trị animate liên tục (explode hiện tại, biên độ
// chuyển động, tween camera, alpha của cú fade) nằm trong các hệ animate và được đọc trong vòng render,
// nên store chỉ phát sự kiện khi trạng thái rời rạc đổi, không phát mỗi khung.
//
// Component KHÔNG gọi thẳng component khác. Ví dụ kéo slider khi đang chuyển động: ExplodedControls
// chỉ gọi setExplode(); chính store nhận ra đang chuyển động và dừng trước.
//
// Chuyển mẫu vật là STATE MACHINE trong store (đợt 3, §3):
//   specimen         mẫu đang ở trong scene — UI / picker / catalog / nhãn CHỈ đọc trường này
//   pendingSpecimen  mẫu được yêu cầu
//   specimenPhase    'idle' | 'preparing' | 'fadingOut' | 'fadingIn'
//   specimenGen      tăng mỗi lần có yêu cầu mới; commit mang gen cũ bị bỏ qua
// requestSpecimen() chỉ đặt pending. Chỉ commitSpecimen(gen) — gọi tại alpha = 0 — mới đổi `specimen`,
// cùng lúc với mọi thứ đi kèm, trong MỘT lần set() (nguyên tử).

import { clamp } from './easing.js';

/**
 * @typedef {'idle'|'preparing'|'fadingOut'|'fadingIn'} SpecimenPhase
 * @typedef {{
 *   mode: 'inspection'|'motion',
 *   introDone: boolean,
 *   explodeTarget: number,
 *   isDraggingExplode: boolean,
 *   viewPreset: 'iso'|'plan'|'front'|'profile',
 *   viewNonce: number,
 *   cameraTweening: boolean,
 *   selectedPartId: string|null,
 *   hoveredPartId: string|null,
 *   hoveredMaterial: string|null,
 *   autoOrbit: boolean,
 *   reducedMotion: boolean,
 *   viewportClass: 'desktop'|'tablet'|'mobile'|'phone-landscape',
 *   theme: 'azure'|'obsidian',
 *   specimen: string,
 *   pendingSpecimen: string|null,
 *   specimenPhase: SpecimenPhase,
 *   specimenGen: number,
 * }} State
 */

/** @typedef {(state: State, changed: Partial<Record<keyof State, true>>) => void} Listener */

/**
 * @param {Partial<State>} [init]
 * @param {{specimenIds?: string[]}} [opt] danh sách ID lấy từ registry (nguồn duy nhất)
 */
export function createStore(init = {}, opt = {}) {
  const ids = opt.specimenIds || [init.specimen || 'ornithopter'];
  /** @type {State} */
  const state = {
    mode: 'inspection',
    introDone: false,
    explodeTarget: 0,
    isDraggingExplode: false,
    viewPreset: 'iso',
    viewNonce: 0,
    cameraTweening: false,
    selectedPartId: null,
    hoveredPartId: null,
    hoveredMaterial: null,
    autoOrbit: false,
    reducedMotion: false,
    viewportClass: 'desktop',
    theme: 'azure',
    specimen: ids[0],
    pendingSpecimen: null,
    specimenPhase: 'idle',
    specimenGen: 0,
    ...init,
  };

  /** @type {Set<Listener>} */
  const listeners = new Set();

  /** @param {Partial<State>} patch */
  function set(patch) {
    /** @type {Partial<Record<keyof State, true>>} */
    const changed = {};
    let any = false;
    for (const k of /** @type {(keyof State)[]} */ (Object.keys(patch))) {
      if (state[k] !== patch[k]) {
        /** @type {any} */ (state)[k] = patch[k];
        changed[k] = true;
        any = true;
      }
    }
    if (any) for (const fn of listeners) fn(state, changed);
  }

  /** Đang chuyển mẫu → các thao tác làm đổi cảnh bị bỏ qua (kể cả phím giữ lâu). */
  const busySwitching = () => state.specimenPhase !== 'idle';

  const actions = {
    /**
     * Luật: đang chuyển động mà người dùng nổ model → dừng trước rồi mới nổ.
     * @param {number} v @param {{dragging?: boolean}} [o]
     */
    setExplode(v, o = {}) {
      if (busySwitching()) return;
      v = clamp(v);
      /** @type {Partial<State>} */
      const p = { explodeTarget: v };
      if (state.mode === 'motion' && v > 0) p.mode = 'inspection';
      if (o.dragging !== undefined) p.isDraggingExplode = o.dragging;
      set(p);
    },

    /** Luật: đang nổ → lắp lại trước (rig chỉ chuyển động khi explode hiện tại < 0.05). */
    startMotion() {
      if (busySwitching()) return;
      set({ mode: 'motion', explodeTarget: 0, selectedPartId: null, isDraggingExplode: false });
    },

    stopMotion() {
      if (state.mode === 'motion') set({ mode: 'inspection' });
    },

    toggleMotion() {
      if (state.mode === 'motion') actions.stopMotion();
      else actions.startMotion();
    },

    /** Luật: đang chuyển động mà chọn part → dừng rồi focus; chọn part → tắt auto-orbit. @param {string} id */
    selectPart(id) {
      if (busySwitching()) return;
      /** @type {Partial<State>} */
      const p = { selectedPartId: id, autoOrbit: false };
      if (state.mode === 'motion') p.mode = 'inspection';
      set(p);
    },

    clearSelection() {
      set({ selectedPartId: null });
    },

    /** Luật: đổi preset → bỏ selection, tắt auto-orbit. viewNonce để bấm lại cùng preset vẫn tween. @param {State['viewPreset']} name */
    setView(name) {
      if (busySwitching()) return;
      set({ viewPreset: name, viewNonce: state.viewNonce + 1, selectedPartId: null, autoOrbit: false });
    },

    resetCamera() {
      actions.setView('iso');
    },

    /** @param {string|null} id */
    setHoveredPart(id) {
      set({ hoveredPartId: id });
    },

    /** @param {string|null} m */
    setHoveredMaterial(m) {
      set({ hoveredMaterial: m });
    },

    toggleAutoOrbit() {
      set({ autoOrbit: !state.autoOrbit });
    },

    /** @param {boolean} b */
    setCameraTweening(b) {
      set({ cameraTweening: b });
    },

    /** @param {State['viewportClass']} c */
    setViewportClass(c) {
      set({ viewportClass: c });
    },

    /** @param {boolean} b */
    setReducedMotion(b) {
      set({ reducedMotion: b });
    },

    finishIntro() {
      set({ introDone: true });
    },

    /** Chủ đề: "Azure & Gold" (nền kem) hoặc "Obsidian" (nền đen). @param {State['theme']} t */
    setTheme(t) {
      set({ theme: t });
    },

    // ── Chuyển mẫu vật (state machine) ─────────────────────────────────────────────────────────

    /**
     * Chỉ ĐẶT YÊU CẦU. `ready` do bên quản lý mẫu cho biết (mẫu đã dựng + warm GPU chưa).
     * Chọn lại mẫu đang active khi đang fade ra → huỷ, sáng lại.
     * @param {string} id @param {boolean} ready
     */
    requestSpecimen(id, ready) {
      if (!ids.includes(id)) return;
      const ph = state.specimenPhase;
      if (id === state.specimen) {
        if (ph === 'preparing' || ph === 'fadingOut')
          set({ pendingSpecimen: null, specimenGen: state.specimenGen + 1, specimenPhase: ph === 'fadingOut' ? 'fadingIn' : 'idle' });
        return;
      }
      if (id === state.pendingSpecimen) return; // lặp phím / bấm lại cùng nút: không tạo gen mới
      set({
        pendingSpecimen: id,
        specimenGen: state.specimenGen + 1,
        specimenPhase: ready ? 'fadingOut' : 'preparing',
      });
    },

    /** Mẫu đang chờ đã sẵn sàng → bắt đầu fade ra. Gen cũ bị bỏ qua. @param {number} gen */
    specimenReady(gen) {
      if (gen !== state.specimenGen || state.specimenPhase !== 'preparing') return false;
      set({ specimenPhase: 'fadingOut' });
      return true;
    },

    /**
     * Commit NGUYÊN TỬ tại alpha = 0: đổi mẫu cùng mọi thứ đi kèm trong một set().
     * Trả về false (không làm gì) nếu gen cũ hoặc không ở pha fadingOut.
     * @param {number} gen
     */
    commitSpecimen(gen) {
      if (gen !== state.specimenGen || state.specimenPhase !== 'fadingOut' || !state.pendingSpecimen) return false;
      set({
        specimen: state.pendingSpecimen,
        pendingSpecimen: null,
        specimenPhase: 'fadingIn',
        mode: 'inspection',
        selectedPartId: null,
        hoveredPartId: null,
        autoOrbit: false,
        isDraggingExplode: false,
        viewPreset: 'iso',
        viewNonce: state.viewNonce + 1,
        // explodeTarget GIỮ NGUYÊN: so sánh hai mẫu ở cùng mức nổ
      });
      return true;
    },

    /** Fade vào xong. @param {number} gen */
    finishSpecimenFade(gen) {
      if (gen !== state.specimenGen || state.specimenPhase !== 'fadingIn') return;
      set({ specimenPhase: 'idle' });
    },
  };

  return {
    /** @returns {Readonly<State>} */
    get state() {
      return state;
    },
    actions,
    /** @param {Listener} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} Store */
