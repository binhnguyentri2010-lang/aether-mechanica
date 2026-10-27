// @ts-check
// AETHER MECHANICA — bootstrap. Nối store ↔ components, giữ "mẫu vật đang xem", chạy vòng render.
//
// Chuyển mẫu (plan đợt 3 §3): store giữ state machine; ở đây chỉ chạy độ sáng fade và COMMIT
// NGUYÊN TỬ tại alpha = 0: (1) rời mẫu cũ → (2) gắn mẫu mới vào mọi component → (3) store.commit
// → (4) căn khung đúng một lần → (5) fade vào. Không khung nào có UI/picker của mẫu B khi cảnh còn A.
import { Raycaster, Vector2, CanvasTexture } from 'three';
import { createStore } from './core/store.js';
import { Spring } from './core/spring.js';
import { Scheduler } from './core/scheduler.js';
import { viewportClass, prefersReducedMotion, isCoarsePointer } from './core/device.js';
import { GROUND_Y, SHADOW_Y } from './core/stage.js';
import { createMaterialLibrary } from './model/materials.js';
import { MaterialState } from './model/materialState.js';
import { MechanicalScene } from './components/MechanicalScene.js';
import { CameraControls } from './components/CameraControls.js';
import { BlueprintOverlay } from './components/BlueprintOverlay.js';
import { AnnotationLayer } from './components/Annotation.js';
import { ExplodedControls } from './components/ExplodedControls.js';
import { ViewSelector } from './components/ViewSelector.js';
import { TechnicalHUD } from './components/TechnicalHUD.js';
import { SpecificationPanel } from './components/SpecificationPanel.js';
import { PartInspector } from './components/PartInspector.js';
import { IntroSequence } from './components/IntroSequence.js';
import { SpecimenManager } from './components/SpecimenManager.js';
import { SpecimenSwitcher } from './components/SpecimenSwitcher.js';
// Nơi DUY NHẤT biết danh sách mẫu vật (tools/check_boundaries.py kiểm)
import { REGISTRY, SPECIMEN_IDS, DEFAULT_SPECIMEN } from './specimens/index.js';

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const app = $('app');
const canvas = /** @type {HTMLCanvasElement} */ ($('gl'));
const params = new URLSearchParams(location.search);
// ?still: tắt hẳn chuyển động (golden) · ?fullmotion: BỎ QUA prefers-reduced-motion của máy (test nhánh
// fade trên máy bật "giảm chuyển động" — Windows tắt animation effects cũng bật cờ này)
const reduced = params.has('still') || (prefersReducedMotion() && !params.has('fullmotion'));
const coarse = isCoarsePointer();
/** Thời lượng fade khi chuyển mẫu (s). */
const FADE_OUT = 0.25;
const FADE_IN = 0.35;

// ── Chủ đề: ?theme=… > lựa chọn đã nhớ (chỉ là tiện ích, có thể trống) > mặc định Azure & Gold ──
/** @returns {'azure'|'obsidian'} */
function initialTheme() {
  const q = params.get('theme');
  if (q === 'azure' || q === 'obsidian') return q;
  try {
    const saved = localStorage.getItem('am-theme');
    if (saved === 'azure' || saved === 'obsidian') return saved;
  } catch { /* chế độ riêng tư / bị chặn lưu trữ */ }
  return 'azure';
}
const theme0 = initialTheme();
// data-finish, KHÔNG phải data-theme: Artifact tự gắn data-theme="light/dark" lên thẻ gốc
document.documentElement.dataset.finish = theme0;

// ── Lõi ────────────────────────────────────────────────────────────────────────────────────────
// ?specimen=<id> mở thẳng một mẫu vật (liên kết sâu, test); id lạ → mẫu mặc định
const qSpecimen = params.get('specimen');
const specimen0 = qSpecimen && SPECIMEN_IDS.includes(qSpecimen) ? qSpecimen : DEFAULT_SPECIMEN;
const store = createStore({ reducedMotion: reduced, theme: theme0, specimen: specimen0 }, { specimenIds: SPECIMEN_IDS });
const lib = createMaterialLibrary(theme0);
const ms = new MaterialState();
// ?aa=0 tắt MSAA (đo hiệu năng) · ?dpr=1 ép DPR cố định (ảnh golden không phụ thuộc màn hình)
const forcedDpr = Number(params.get('dpr'));
const view = new MechanicalScene(canvas, {
  ...(params.get('aa') === '0' ? { antialias: false } : {}),
  ...(forcedDpr >= 0.5 && forcedDpr <= 3 ? { dpr: forcedDpr } : {}),
});
// ?noparallel: bỏ compileAsync, luôn warm-up bằng render (test nhánh không có KHR_parallel_shader_compile)
// ?nobatch: vẽ từng mesh riêng như trước — CHỈ để đo A/B lợi ích của vẽ theo lô (tests/profile.html)
const manager = new SpecimenManager({ registry: REGISTRY, lib, ms, view, noParallel: params.has('noparallel'), batchDraw: !params.has('nobatch') });
/** Mẫu đang ở trong cảnh — UI / picker / nhãn / spec CHỈ đọc biến này (đổi duy nhất ở commitSwitch). */
let cur = manager.buildNow(specimen0);
let def = cur.def;
const explode = new Spring(0, 90);
/** Độ sáng của cú chuyển mẫu (1 = hiện đủ). */
let fade = 1;

/** @returns {import('./model/MechanicalModel.js').MechanicalModel} */
const model = () => /** @type {any} */ (cur.model);

// ── Bố cục: viewport, vùng an toàn, khối HUD ───────────────────────────────────────────────────
/** @type {{x: number, y: number, W: number, H: number, safe: {x0: number, y0: number, x1: number, y1: number}, cls: 'desktop'|'tablet'|'mobile'|'phone-landscape', hud: DOMRect[]}} */
const layout = { x: 0, y: 0, W: 1, H: 1, safe: { x0: 0, y0: 0, x1: 1, y1: 1 }, cls: 'desktop', hud: [] };

function measureLayout() {
  const r = app.getBoundingClientRect();
  layout.x = r.left; // gốc canvas trong viewport (Artifact đệm safe-area phía trên → khác 0 trên iPhone)
  layout.y = r.top;
  layout.W = Math.max(1, r.width);
  layout.H = Math.max(1, r.height);
  layout.cls = viewportClass(layout.W, layout.H);
  app.dataset.vp = layout.cls;
  const rects = [...app.querySelectorAll('[data-hud], .inspector.open')]
    .map((el) => {
      const b = el.getBoundingClientRect();
      // .hud trượt vào bằng translateY lúc intro, và getBoundingClientRect TÍNH CẢ transform → trước đây
      // vùng an toàn (và khung camera) lệch tới 4 px tuỳ lúc đo. Vị trí NGHỈ của mọi .hud có dịch Y = 0
      // (hud-bc chỉ canh giữa theo X) → trừ đúng phần dịch Y đang chạy để luôn đo ở vị trí nghỉ.
      let ty = 0;
      if (el.classList.contains('hud')) {
        const t = getComputedStyle(el).transform;
        if (t && t !== 'none') ty = new DOMMatrixReadOnly(t).m42;
      }
      return new DOMRect(b.left - r.left, b.top - r.top - ty, b.width, b.height);
    })
    .filter((b) => b.width > 0 && b.height > 0);
  layout.hud = rects;
  // Vùng an toàn cho MODEL: chỉ các khối HUD chắn dải giữa màn hình mới ép chiều cao. Khối ở
  // hai góc (spec, legend) không chạm model nằm giữa; nhãn vẫn né chúng nhờ kiểm tra va chạm HUD.
  const small = layout.cls === 'mobile' || layout.cls === 'phone-landscape';
  const bandL = layout.W * (small ? 0.05 : 0.27);
  const bandR = layout.W * (small ? 0.95 : 0.73);
  let top = layout.H * (small ? 0.02 : 0.07);
  let bottom = layout.H * (small ? 0.98 : 0.93);
  for (const b of rects) {
    if (b.right < bandL || b.left > bandR) continue;
    if (b.top < layout.H * 0.35 && b.bottom > top) top = b.bottom;
    if (b.bottom > layout.H * 0.65 && b.top < bottom) bottom = b.top;
  }
  const pad = small ? 10 : 24;
  // Làm tròn về pixel nguyên: đáy/đỉnh khối HUD là số đo chữ, lệch 0.01–0.03 px theo devicePixelRatio của máy
  // (đo thật ở DPR 1 / 1.25 / 1.5: 114.4375 / 114.45 / 114.4375) → khung camera dịch theo → ảnh golden (không
  // khử răng cưa) lệch hàng trăm ô ở nét mảnh, lúc khớp lúc không tuỳ khung trình duyệt đang ở DPR nào.
  layout.safe = { x0: pad, x1: layout.W - pad, y0: Math.round(top + 10), y1: Math.round(bottom - 10) };
}

// ── Components ─────────────────────────────────────────────────────────────────────────────────
measureLayout();
view.resize(layout.W, layout.H);
const cam = new CameraControls({
  camera: view.camera, dom: canvas, model: model(), getLayout: () => layout,
  onTweenChange: (b) => store.actions.setCameraTweening(b),
  views: def.views, scale: def.cameraScale,
});
const blueprint = new BlueprintOverlay({
  scene: view.scene, svg: /** @type {any} */ ($('bp')), center: /** @type {any} */ (model().center0), floorY: GROUND_Y,
  fig: def.fig,
});
const annotations = new AnnotationLayer({
  svg: /** @type {any} */ ($('leaders')), host: $('labels'), model: model(), camera: view.camera, getLayout: () => layout,
  onHover: (name) => store.actions.setHoveredPart(name),
  onSelect: (name) => store.actions.selectPart(name),
  picker: /** @type {any} */ (cur.picker), catalog: def.catalog, occluders: def.occluders,
});
const explodedControls = new ExplodedControls({ root: app, store });
explodedControls.setLabels(def.labels);
new ViewSelector({ root: app, store });
const hud = new TechnicalHUD({ root: app, store, coarse });
hud.setMotionText(def.labels.status);
const spec = new SpecificationPanel({ root: $('spec'), onToggle: () => relayout() });
spec.setSpecimen(def, model());
const inspector = new PartInspector({ root: $('inspector'), onClose: () => store.actions.clearSelection() });
inspector.setSpecimen(def);
const intro = new IntroSequence({ app, reduced });

/** Yêu cầu chuyển sang mẫu id (nút, phím S). Mẫu chưa dựng → dựng ngay, ưu tiên hơn dựng nền. @param {string} id */
function requestSpecimen(id) {
  if (!SPECIMEN_IDS.includes(id)) return;
  manager.prepare(id);
  store.actions.requestSpecimen(id, manager.get(id).state === 'ready');
  scheduler.invalidate();
}
new SpecimenSwitcher({
  root: $('specimens'), store,
  items: SPECIMEN_IDS.map((id) => ({ id, no: REGISTRY[id].no, short: REGISTRY[id].short })),
  onRequest: requestSpecimen,
});

/** Chữ HUD theo mẫu vật (chỉ ghi khi khác → DOM không đổi thừa). */
function applySpecimenText() {
  const put = (/** @type {Element|null} */ el, /** @type {string} */ s) => {
    if (el && el.textContent !== s) el.textContent = s;
  };
  put(app.querySelector('.hud-tl .micro:not(.sub)'), def.study);
  put(app.querySelector('.hud-tl .micro.sub'), def.concept);
  put(app.querySelector('.status .asm'), `Assembly ${def.no}`);
  put(app.querySelector('.keys'), `1–4 View · E Explode · F ${def.labels.key} · S Specimen · T Theme · R Reset`);
  const aria = `Three-dimensional model of the ${def.title.toLowerCase()}. Drag to orbit, scroll or pinch to zoom.`;
  if (canvas.getAttribute('aria-label') !== aria) canvas.setAttribute('aria-label', aria);
}
applySpecimenText();

/** Áp chủ đề cho mọi lớp không thuộc vật liệu model. @param {'azure'|'obsidian'} th */
function applyTheme(th) {
  document.documentElement.dataset.finish = th;
  view.setTheme(th);
  blueprint.setTheme(th);
  // Đường dóng của MỌI mẫu đã dựng (mẫu ẩn cũng phải đúng màu khi được chuyển sang)
  for (const r of manager.records.values()) if (r.model && r.model.ready) r.model.traceMat.color.setHex(th === 'azure' ? 0x3a332b : 0xe8e0cf);
  hud.syncTheme(th);
  annotations.setTheme(th);
  spec.setTheme(th);
  inspector.setTheme(th);
}
applyTheme(theme0);
view.placeShadow(/** @type {any} */ (model().center0), SHADOW_Y, def.shadow.w, def.shadow.d);
blueprint.setBelt(def.belt ? 0 : null);

/** @param {string|null} name */
const kindOf = (name) => (name ? model().partByName(name)?.kind ?? null : null);

store.subscribe((st, ch) => {
  if (ch.theme) {
    ms.setTheme(st.theme, lib);
    applyTheme(st.theme);
    try {
      localStorage.setItem('am-theme', st.theme);
    } catch { /* không lưu được thì thôi — chỉ là tiện ích */ }
  }
  // Commit chuyển mẫu cũng tăng viewNonce: về ISO NGAY (cảnh đang tối), không tween
  if (ch.viewNonce) cam.goTo(st.viewPreset, !!ch.specimen);
  else if (ch.selectedPartId) {
    const p = st.selectedPartId ? model().partByName(st.selectedPartId) : null;
    if (p) cam.focusOn(p);
    else cam.clearFocus();
  }
  if (ch.selectedPartId) {
    const p = st.selectedPartId ? model().partByName(st.selectedPartId) : null;
    inspector.show(p);
    app.classList.toggle('has-focus', !!p);
    // Panel inspector thành một khối HUD mà nhãn phải né
    measureLayout();
  }
  ms.setFocus(kindOf(st.selectedPartId));
  ms.setHover(kindOf(st.hoveredPartId));
  ms.setHoverMaterial(st.hoveredMaterial);
  annotations.setHighlight(kindOf(st.hoveredPartId) || kindOf(st.selectedPartId), kindOf(st.selectedPartId));
  annotations.markDirty();
  if (ch.mode) app.classList.toggle('is-flying', st.mode === 'motion');
  if (ch.specimenPhase) app.classList.toggle('is-switching', st.specimenPhase === 'fadingOut');
  scheduler.invalidate();
});

/**
 * COMMIT NGUYÊN TỬ tại alpha = 0 (plan §3). Gọi từ frame() — đúng một lần cho mỗi cú chuyển.
 */
function commitSwitch() {
  const st = store.state;
  const gen = st.specimenGen;
  const next = st.pendingSpecimen ? manager.get(st.pendingSpecimen) : null;
  if (!next || next.state !== 'ready' || !next.model) return; // fadingOut chỉ xảy ra khi đã ready — phòng hờ
  // 1. Rời mẫu cũ: về bind pose, rig/đồng hồ/băng chuyền reset, ẩn
  cur.rig.onDeactivate();
  model().root.visible = false;
  // 2. Gắn mẫu mới vào MỌI thứ đọc "mẫu đang xem"
  cur = next;
  def = next.def;
  const m = model();
  m.root.visible = true;
  ms.setActiveOwner(def.id);
  m.applyExplode(explode.value); // explodeTarget giữ nguyên qua cú chuyển
  cam.setModel(m, def.views, def.cameraScale);
  blueprint.setCenter(/** @type {any} */ (m.center0));
  blueprint.setFig(def.fig);
  blueprint.setBelt(def.belt ? 0 : null);
  view.placeShadow(/** @type {any} */ (m.center0), SHADOW_Y, def.shadow.w, def.shadow.d);
  annotations.setModel(m, def.catalog, def.occluders, /** @type {any} */ (cur.picker));
  inspector.setSpecimen(def);
  spec.setSpecimen(def, m);
  explodedControls.setLabels(def.labels);
  hud.setMotionText(def.labels.status);
  applySpecimenText();
  applyTheme(st.theme);
  // 3. Store — một lần set() duy nhất: specimen, mode, selection, autoOrbit, preset ISO, phase
  store.actions.commitSpecimen(gen);
  // 4. Căn khung đúng một lần với model mới (đo lại HUD vì chữ đã đổi)
  relayout();
}

// ── Chọn / hover bằng raycast (lọc bằng hộp bao trước — xem core/pick.js) ────────────────────────
const ray = new Raycaster();
const ndc = new Vector2();
let hoverPending = false;
let hoverX = 0;
let hoverY = 0;
/** @param {number} x @param {number} y */
function pick(x, y) {
  ndc.set((x / layout.W) * 2 - 1, -(y / layout.H) * 2 + 1);
  ray.setFromCamera(ndc, view.camera);
  const hit = /** @type {any} */ (cur.picker).first(ray.ray);
  return hit ? /** @type {import('./model/Part.js').Part} */ (hit.object.userData.part) : null;
}

// Toạ độ trong canvas = clientX/Y trừ gốc app (đo ở measureLayout), KHÔNG dùng offsetX/Y: offsetX phụ thuộc
// cách trình duyệt tính (đo thật: sự kiện tổng hợp trong trang đang phóng 80% cho offsetX = clientX × 0.8 →
// chạm chọn nhầm part bên cạnh), còn clientX cùng hệ CSS px với layout.W/H mà pick() dùng.
/** @param {PointerEvent} ev */
const px = (ev) => ev.clientX - layout.x;
/** @param {PointerEvent} ev */
const py = (ev) => ev.clientY - layout.y;

/** @type {Map<number, {x: number, y: number, t: number}>} */
const downs = new Map();
let lastTap = { t: -1e9, x: 0, y: 0, empty: false };
canvas.addEventListener('pointerdown', (ev) => {
  downs.set(ev.pointerId, { x: px(ev), y: py(ev), t: performance.now() });
  annotations.markDirty();
});
canvas.addEventListener('pointerup', (ev) => {
  const d = downs.get(ev.pointerId);
  const multi = downs.size > 1;
  downs.delete(ev.pointerId);
  if (!d || multi || store.state.cameraTweening) return;
  const now = performance.now();
  const x = px(ev), y = py(ev);
  if (Math.hypot(x - d.x, y - d.y) > 5 || now - d.t > 600) return;
  const p = pick(x, y);
  const isDouble = now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 20;
  if (!p) {
    // Double-tap / double-click CHỈ reset khi cả hai lần đều trúng chỗ trống
    if (isDouble && lastTap.empty) {
      store.actions.resetCamera();
      lastTap.t = -1e9;
      return;
    }
    store.actions.clearSelection();
  } else {
    store.actions.selectPart(p.name);
  }
  lastTap = { t: now, x, y, empty: !p };
});
canvas.addEventListener('pointercancel', (ev) => downs.delete(ev.pointerId));
canvas.addEventListener('pointermove', (ev) => {
  if (ev.pointerType !== 'mouse') return;
  hoverX = px(ev);
  hoverY = py(ev);
  hoverPending = downs.size === 0;
  blueprint.setPointer((hoverX / layout.W) * 2 - 1, (hoverY / layout.H) * 2 - 1);
  scheduler.invalidate();
});
canvas.addEventListener('pointerleave', () => {
  if (store.state.hoveredPartId && !app.querySelector('.lbl:hover')) store.actions.setHoveredPart(null);
  canvas.style.cursor = '';
});
// iOS: không cho pinch phóng cả trang
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ── Phím tắt ───────────────────────────────────────────────────────────────────────────────────
// Chỉ bỏ qua khi đang gõ chữ. KHÔNG chặn khi focus ở button (bấm nút xong focus nằm lại trên nút).
window.addEventListener('keydown', (ev) => {
  const t = /** @type {HTMLElement} */ (ev.target);
  const tag = t.tagName;
  const textual = (tag === 'INPUT' && !['range', 'button', 'checkbox'].includes(/** @type {HTMLInputElement} */ (t).type)) ||
    tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  if (textual || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const a = store.actions;
  const k = ev.key.toLowerCase();
  if (k === '1') a.setView('iso');
  else if (k === '2') a.setView('plan');
  else if (k === '3') a.setView('front');
  else if (k === '4') a.setView('profile');
  else if (k === 'e') a.setExplode(store.state.explodeTarget > 0.5 ? 0 : 1);
  else if (k === 'f') a.toggleMotion();
  else if (k === 's') {
    // Giữ phím (auto-repeat) không đảo qua đảo lại: chỉ tính lần nhấn thật
    if (!ev.repeat) {
      const st = store.state;
      const intent = st.pendingSpecimen ?? st.specimen;
      requestSpecimen(SPECIMEN_IDS[(SPECIMEN_IDS.indexOf(intent) + 1) % SPECIMEN_IDS.length]);
    }
  } else if (k === 'r') a.resetCamera();
  else if (k === 'o') a.toggleAutoOrbit();
  else if (k === 't') a.setTheme(store.state.theme === 'azure' ? 'obsidian' : 'azure');
  else if (k === 'escape') a.clearSelection();
  else return;
  ev.preventDefault();
});

// ── Vòng render ────────────────────────────────────────────────────────────────────────────────
let clock = 0;
/** Số khung liên tiếp không có gì chuyển động (không tính việc dựng nền). */
let idleFrames = 0;
/** @param {number} dt @param {number} now */
function frame(dt, now) {
  clock += dt;
  // ── Chuyển mẫu: store giữ luật; ở đây chạy độ sáng và commit tại alpha = 0 ─────────────────────
  {
    const st = store.state;
    if (st.specimenPhase === 'preparing' && st.pendingSpecimen) {
      const r = manager.get(st.pendingSpecimen);
      if (r.state === 'ready') store.actions.specimenReady(st.specimenGen);
      else if (r.state === 'error') store.actions.requestSpecimen(st.specimen, true); // không dựng được → huỷ
    }
    const ph = store.state.specimenPhase;
    if (ph === 'fadingOut') {
      fade = reduced ? 0 : Math.max(0, fade - dt / FADE_OUT);
      if (fade === 0) commitSwitch();
    } else if (ph === 'fadingIn') {
      fade = reduced ? 1 : Math.min(1, fade + dt / FADE_IN);
      if (fade === 1) store.actions.finishSpecimenFade(store.state.specimenGen);
    } else fade = 1;
  }

  const st = store.state;
  const m = model();
  const rig = cur.rig;
  explode.stiffness = st.isDraggingExplode ? 420 : 90;
  explode.target = st.explodeTarget;
  const e = explode.step(dt);
  let busy = !explode.settled || st.specimenPhase !== 'idle';
  if (e !== m.explode) {
    m.applyExplode(e);
    annotations.markDirty();
  }

  const amb = st.reducedMotion ? 0 : 1;
  busy = rig.update(dt, st.mode === 'motion', e) || busy;
  rig.secondary(dt, amb);
  if (rig.ampE > 0) annotations.markDirty();
  ms.setMotionBoost(rig.ampE * 0.9);
  if (def.belt) blueprint.setBelt(rig.belt);

  // Hiệu ứng nền của mẫu (bướm: gimbal quay, core thở · husky: lõi thở) — tắt khi reduced-motion
  const k = intro.modelK * fade;
  def.ambient(m, dt, { clock, amb, motion: rig.ampE, intro: k, theme: st.theme });

  busy = intro.update(dt) || busy;
  view.setIntro(k);
  ms.setIntro(k);
  m.root.scale.setScalar(0.96 + 0.04 * k);
  blueprint.setOpacity(intro.bpK);
  m.traceMat.opacity = /** @type {number} */ (m.traceOpacity) * k;

  busy = ms.step(dt) || busy;
  busy = cam.update(dt, e, rig.ampE, st.autoOrbit) || busy;
  busy = blueprint.update(dt, rig.ampE, !st.reducedMotion) || busy;

  if (hoverPending) {
    hoverPending = false;
    const p = pick(hoverX, hoverY);
    const name = p ? p.name : null;
    if (name !== st.hoveredPartId) store.actions.setHoveredPart(name);
    canvas.style.cursor = p ? 'pointer' : '';
  }

  // Dựng nền / warm-up GPU mẫu ẩn. CHẠY TRƯỚC render chính: render chính xoá dấu 1×1.
  //  • Người dùng đã chọn mẫu chưa sẵn sàng (preparing) → làm ngay cho mẫu đó.
  //  • Còn lại chỉ làm khi app RẢNH ≥ 20 khung sau intro (plan §4): đang xoay/kéo thì nhường khung.
  idleFrames = busy ? 0 : idleFrames + 1;
  if (!view.contextLost && manager.hasWork(cur.id)) {
    const urgent = st.specimenPhase === 'preparing' ? st.pendingSpecimen : null;
    if (urgent) manager.tick(cur.id, urgent);
    else if (intro.done && idleFrames >= 20) manager.tick(cur.id, null);
    busy = true; // giữ vòng lặp chạy tới khi hết việc (kể cả chế độ on-demand)
  }
  view.render();
  // Nhãn chỉ bố trí lại khi có gì chuyển động/đổi; đứng yên thì bỏ qua hoàn toàn
  if (busy) annotations.markDirty();
  if (annotations.needsUpdate()) annotations.update(e);
  explodedControls.update(e);
  hud.update(now, e, rig.ampE, cam.readout());
  return busy;
}

/** Chế độ "lite" — bậc hạ chất lượng cuối: tắt grain, chấm quỹ đạo, nhãn độ của thước. */
let lite = false;
const scheduler = new Scheduler({
  frame,
  // Bậc hạ chất lượng (plan đợt 3 §8): DPR −0.25 tới sàn 1.0 → rồi "lite". Chỉ hạ, không nâng.
  onSlow: () => {
    if (forcedDpr) return; // DPR bị ép cho test → không tự hạ, để ảnh golden ổn định
    const next = Math.max(1, view.dpr - 0.25);
    if (next < view.dpr) {
      view.setDpr(next);
      relayout();
    } else if (!lite) {
      lite = true;
      app.classList.add('is-lite');
      blueprint.setLite(true);
      scheduler.invalidate();
    }
  },
  // Cửa sổ đo bị loại khi đang chuyển mẫu, dựng/warm nền, hay còn intro (biên dịch lần đầu)
  isNoisy: () => store.state.specimenPhase !== 'idle' || manager.hasWork(cur.id) || !intro.done,
});
scheduler.ambient = !reduced;
// Thao tác của người dùng → idle giữ 30 fps (sau 10 s không đụng tới → 20 fps)
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'touchstart']) canvas.addEventListener(ev, () => scheduler.interact(), { passive: true });
window.addEventListener('keydown', () => scheduler.interact());
// SUSPENDED: tab ẩn / canvas khuất khỏi màn hình (Artifact nhúng trong trang dài) → 0 khung
document.addEventListener('visibilitychange', () => (document.hidden ? scheduler.suspend('hidden') : scheduler.resume('hidden')));
if (typeof IntersectionObserver === 'function')
  new IntersectionObserver((es) => {
    for (const e of es) e.isIntersecting ? scheduler.resume('offscreen') : scheduler.suspend('offscreen');
  }).observe(canvas);

// ── Resize ─────────────────────────────────────────────────────────────────────────────────────
function relayout() {
  measureLayout();
  view.resize(layout.W, layout.H);
  store.actions.setViewportClass(layout.cls);
  cam.computeFits();
  cam.applyFraming(explode.value, cur.rig.ampE);
  blueprint.buildScreen(layout.W, layout.H, cam.desiredPoint(layout), layout.cls, layout.hud);
  annotations.measure();
  annotations.markDirty();
  scheduler.invalidate();
}
new ResizeObserver(() => relayout()).observe(app);
window.addEventListener('orientationchange', () => setTimeout(relayout, 250));

// Grain tĩnh ~2%: vẽ một lần
(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  /** @type {HTMLElement} */ (app.querySelector('.grain')).style.backgroundImage = `url(${c.toDataURL()})`;
})();

// ── Mất context WebGL (Safari/iPadOS) ──────────────────────────────────────────────────────────
canvas.addEventListener('webglcontextlost', () => {
  view.contextLost = true;
  scheduler.suspend('context');
  manager.onContextLost(cur.id); // mẫu ẩn phải warm lại trước lần chuyển sau
  $('gl-notice').hidden = false;
});
canvas.addEventListener('webglcontextrestored', () => {
  view.contextLost = false;
  view.buildEnvironment();
  view.scene.traverse((o) => {
    const mat = /** @type {any} */ (o).material;
    if (!mat) return;
    for (const key of ['map', 'roughnessMap']) if (mat[key] instanceof CanvasTexture) mat[key].needsUpdate = true;
  });
  $('gl-notice').hidden = true;
  scheduler.resume('context');
});

// ── Khởi động ──────────────────────────────────────────────────────────────────────────────────
relayout();
cam.goTo('iso', true);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => relayout());
scheduler.start();

// Hook cho selftest và kiểm tra thủ công (khung trình duyệt ẩn thì rAF đứng im → gọi thẳng).
// model/rig/def là GETTER: luôn trả mẫu đang xem.
/** @type {any} */ (window).__am = {
  store, cam, view, ms, lib, annotations, layout, explode, scheduler, spec, blueprint, inspector, manager,
  get def() { return def; },
  get model() { return cur.model; },
  get rig() { return cur.rig; },
  get picker() { return cur.picker; },
  get fade() { return fade; },
  get lite() { return lite; },
  requestSpecimen,
  renderOnce(dt = 1 / 60) {
    return frame(dt, performance.now());
  },
  layoutOnce() {
    relayout();
    return layout;
  },
};
