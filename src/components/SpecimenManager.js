// @ts-check
// VÒNG ĐỜI MẪU VẬT (plan đợt 3 §4): unbuilt → building → cpuReady → gpuWarming → ready | error.
//
// • Dựng NỀN theo lát thời gian: MechanicalModel.buildStep(deadline) — mỗi bước ~ một part, tối đa
//   `budgetMs` mỗi khung; ghi lại bước dài nhất. Không bao giờ dựng đồng bộ trong lúc fade.
// • Warm-up GPU trước khi cho phép chuyển (mẫu vẫn ẩn):
//     1. renderer.compileAsync(root, camera, scene chính) → program đúng biến thể đèn/env của cảnh thật;
//     2. RENDER THẬT vào chính canvas qua viewport/scissor 1×1 (cùng renderer, color space, tone
//        mapping, instancing) — không dùng render target vì sinh biến thể màu khác;
//     3. chia LÔ qua nhiều khung (tự điều chỉnh cỡ lô để khung không nặng), đẩy geometry/texture lên dần.
//   Lượt warm chạy TRƯỚC render chính của khung → render chính xoá sạch điểm ảnh 1×1 đó.
// • Mất context: mọi mẫu ẩn về cpuReady, promise cũ vô hiệu (warmGen), sẽ warm lại trước lần chuyển sau.
// Component này nhận registry qua tham số — không import specimens/ (tools/check_boundaries.py).
import { PerspectiveCamera, Vector3, Vector4, Box3, Sphere } from 'three';
import { MechanicalModel } from '../model/MechanicalModel.js';
import { Picker } from '../core/pick.js';

const _vp = new Vector4();
const _sc = new Vector4();

/**
 * @typedef {'unbuilt'|'building'|'cpuReady'|'gpuWarming'|'ready'|'error'} Life
 * @typedef {{
 *   id: string, def: import('../model/MechanicalModel.js').SpecimenDef, state: Life,
 *   model: MechanicalModel|null, rig: any, picker: Picker|null, error: any,
 *   warm: null | {gen: number, items: import('three').Object3D[], vis: boolean[], index: Map<import('three').Object3D, number>, i: number, compiled: boolean},
 * }} Rec
 */

export class SpecimenManager {
  /**
   * @param {{
   *   registry: Record<string, import('../model/MechanicalModel.js').SpecimenDef>,
   *   lib: import('../model/materials.js').MaterialLibrary, ms: import('../model/materialState.js').MaterialState,
   *   view: import('./MechanicalScene.js').MechanicalScene, noParallel?: boolean, budgetMs?: number,
   *   batchDraw?: boolean,
   * }} o
   */
  constructor(o) {
    /** Vẽ model theo lô (MechanicalModel._batchSteps); false chỉ để đo A/B. */
    this.batchDraw = o.batchDraw !== false;
    this.lib = o.lib;
    this.ms = o.ms;
    this.view = o.view;
    this.noParallel = !!o.noParallel;
    this.budgetMs = o.budgetMs ?? 6;
    /** @type {Map<string, Rec>} */
    this.records = new Map();
    for (const [id, def] of Object.entries(o.registry))
      this.records.set(id, { id, def, state: 'unbuilt', model: null, rig: null, picker: null, error: null, warm: null });
    this.warmGen = 0;
    this.batch = 24; // cỡ lô warm-up, tự điều chỉnh
    this.adaptBatch = true; // test tắt đi để ép cỡ lô cố định
    this.stats = { maxStepMs: 0, maxWarmMs: 0, warmFrames: 0, builds: 0, loadBuildMs: 0 };
    this.warmCam = new PerspectiveCamera(50, 1, 0.1, 500);
  }

  /** @param {string} id */
  get(id) {
    return /** @type {Rec} */ (this.records.get(id));
  }

  /** Mọi mẫu đã sẵn sàng chuyển (test / công cụ). */
  allReady() {
    for (const r of this.records.values()) if (r.state !== 'ready') return false;
    return true;
  }

  /** Mẫu hiển thị lúc tải: dựng đồng bộ (thứ tự tạo đối tượng y hệt trước refactor). @param {string} id */
  buildNow(id) {
    const r = this.get(id);
    r.model = new MechanicalModel(r.def, this.lib, this.ms, { batch: this.batchDraw });
    this._attach(r, true);
    r.state = 'ready'; // render chính đầu tiên chính là warm-up của mẫu này
    this.stats.loadBuildMs = r.model.maxStepMs; // dựng đồng bộ lúc tải trang — không phải bước dựng nền
    return r;
  }

  /** @param {Rec} r @param {boolean} visible */
  _attach(r, visible) {
    const m = /** @type {MechanicalModel} */ (r.model);
    this.view.scene.add(m.root);
    m.root.visible = visible;
    r.picker = new Picker(/** @type {any} */ (m.pickables));
    r.rig = r.def.createRig(m);
    // Bước dựng NỀN dài nhất (plan §4: đo và ghi lại)
    if (!visible) this.stats.maxStepMs = Math.max(this.stats.maxStepMs, m.maxStepMs);
  }

  /** Bắt đầu dựng nền (idempotent: gọi lại khi đang/đã dựng không làm gì). @param {string} id */
  prepare(id) {
    const r = this.get(id);
    if (!r || r.state !== 'unbuilt') return;
    try {
      r.model = new MechanicalModel(r.def, this.lib, this.ms, { deferred: true, batch: this.batchDraw });
      r.state = 'building';
      this.stats.builds++;
    } catch (e) {
      r.state = 'error';
      r.error = e;
    }
  }

  /** Còn việc nền (dựng/warm) cho mẫu nào ngoài mẫu đang xem? @param {string} activeId */
  hasWork(activeId) {
    return this._pending(activeId);
  }

  /**
   * Việc nền của một khung: dựng tiếp HOẶC warm một lô — tối đa một mẫu mỗi khung. Không đụng mẫu đang xem.
   * @param {string} activeId
   * @param {string|null} only chỉ làm cho mẫu này (người dùng đã chọn nó — ưu tiên, kể cả khi đang thao tác);
   *   null = việc nền tự động, chỉ gọi khi app đang RẢNH (plan §4: "dựng sẵn khi rảnh")
   * @returns {boolean} còn việc (scheduler giữ Active)
   */
  tick(activeId, only) {
    const deadline = performance.now() + this.budgetMs;
    for (const r of this.records.values()) {
      if (r.id === activeId || r.state === 'ready' || r.state === 'error') continue;
      if (only && r.id !== only) continue;
      if (r.state === 'unbuilt') this.prepare(r.id);
      if (r.state === 'building') {
        try {
          if (/** @type {MechanicalModel} */ (r.model).buildStep(deadline)) {
            this._attach(r, false);
            r.state = 'cpuReady';
          }
        } catch (e) {
          r.state = 'error';
          r.error = e;
        }
        return true;
      }
      if (r.state === 'cpuReady' || r.state === 'gpuWarming') {
        this._warm(r);
        return r.state !== 'ready' || this._pending(activeId);
      }
    }
    // Việc nền cuối: dựng sẵn cây BVH cho pick của mọi mẫu đã dựng → lần hover đầu qua part lớn khỏi khựng
    if (!only)
      for (const r of this.records.values())
        if (r.picker && !r.picker.prepared) {
          r.picker.prepare(deadline);
          return this._pending(activeId);
        }
    return false;
  }

  /** Còn việc nền nào (mẫu khác chưa sẵn sàng, hoặc cây pick chưa dựng xong)? @param {string} activeId */
  _pending(activeId) {
    for (const r of this.records.values()) {
      if (r.id !== activeId && r.state !== 'ready' && r.state !== 'error') return true;
      if (r.picker && !r.picker.prepared) return true;
    }
    return false;
  }

  /** @param {Rec} r */
  _warm(r) {
    const renderer = this.view.renderer;
    const m = /** @type {MechanicalModel} */ (r.model);
    if (r.state === 'cpuReady') {
      // Chỉ những gì camera THẬT SỰ vẽ (layer của camera). Mesh gốc của model vẽ theo lô nằm ở layer 1:
      // biên dịch chúng sinh biến thể shader không bao giờ dùng, và compileAsync chỉ chờ program "hiện
      // hành" của mỗi vật liệu — có thể chờ nhầm biến thể đó thay vì biến thể của lô.
      const layers = this.view.camera.layers;
      /** @type {import('three').Object3D[]} */
      const items = [];
      m.root.traverse((o) => {
        if (/** @type {any} */ (o).material && o.layers.test(layers)) items.push(o);
      });
      const gen = this.warmGen;
      const warm = {
        gen, items, vis: items.map((o) => o.visible), index: new Map(items.map((o, k) => [o, k])), i: 0,
        compiled: this.noParallel || typeof renderer.compileAsync !== 'function',
      };
      r.warm = warm;
      r.state = 'gpuWarming';
      if (!warm.compiled) {
        // compile() chỉ gọi traverse (và traverseVisible khi khác cảnh đích) → đưa vào đúng danh sách items
        const drawn = /** @type {any} */ ({ traverse: (/** @type {any} */ fn) => items.forEach(fn), traverseVisible: (/** @type {any} */ fn) => m.root.traverseVisible(fn) });
        renderer.compileAsync(drawn, this.view.camera, this.view.scene).then(
          () => { if (r.warm === warm && gen === this.warmGen) warm.compiled = true; },
          () => { if (r.warm === warm) warm.compiled = true; }, // lỗi biên dịch sẽ lộ ở lượt render warm
        );
      }
      this._aimWarmCam(m);
    }
    const w = /** @type {NonNullable<Rec['warm']>} */ (r.warm);
    // Chờ biên dịch song song xong rồi mới vẽ lô: vẽ sớm thì GPU driver bắt khung chờ link shader
    // (đo thật: khung warm đầu 24 ms). Nhánh không có KHR_parallel_shader_compile (compiled = true
    // ngay) biên dịch ở lô đầu — chấp nhận, vì vẫn là lúc mẫu còn ẩn.
    if (!w.compiled) return;
    if (w.i < w.items.length) {
      const t0 = performance.now();
      const n = Math.min(this.batch, w.items.length - w.i);
      this._renderBatch(r, w.i, n);
      w.i += n;
      const ms = performance.now() - t0;
      this.stats.maxWarmMs = Math.max(this.stats.maxWarmMs, ms);
      this.stats.warmFrames++;
      // Lô tự điều chỉnh: khung warm nặng → lô nhỏ lại; nhẹ → lô lớn lên (giữ khung < 16 ms)
      if (this.adaptBatch) {
        if (ms > 8 && this.batch > 4) this.batch = Math.max(4, this.batch >> 1);
        else if (ms < 2 && this.batch < 96) this.batch *= 2;
      }
    }
    if (w.i >= w.items.length && w.compiled) {
      r.state = 'ready';
      r.warm = null;
    }
  }

  /** Camera warm nhìn trọn mẫu (kể cả lúc nổ) để frustum culling không bỏ sót vật thể nào. @param {MechanicalModel} m */
  _aimWarmCam(m) {
    const box = new Box3().copy(/** @type {Box3} */ (m.box0)).union(/** @type {Box3} */ (m.box1));
    const s = box.getBoundingSphere(new Sphere());
    const cam = this.warmCam;
    const dist = (s.radius / Math.sin((cam.fov / 2) * (Math.PI / 180))) * 1.2;
    cam.position.copy(s.center).add(new Vector3(0, 0, dist));
    cam.near = Math.max(0.05, dist - s.radius * 1.5);
    cam.far = dist + s.radius * 1.5;
    cam.lookAt(s.center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /** Vẽ riêng lô [i, i+n) của mẫu vào 1×1 góc canvas (các vật thể khác ẩn tạm, đèn giữ nguyên). @param {Rec} r @param {number} i @param {number} n */
  _renderBatch(r, i, n) {
    const scene = this.view.scene;
    const renderer = this.view.renderer;
    const m = /** @type {MechanicalModel} */ (r.model);
    const w = /** @type {NonNullable<Rec['warm']>} */ (r.warm);
    const saved = scene.children.map((o) => o.visible);
    for (const o of scene.children) if (!(/** @type {any} */ (o).isLight) && o !== m.root) o.visible = false;
    m.root.visible = true;
    for (let k = 0; k < w.items.length; k++) w.items[k].visible = w.vis[k] && k >= i && k < i + n;
    // Vật thể LỒNG trong vật thể khác (vd. nắp chốt là con của mesh tay đòn linkage): cha bị ẩn thì con
    // không được vẽ → phải hiện cả các tổ tiên là renderable. Đo thật: cỡ lô tự điều chỉnh làm cha/con
    // có lúc rơi vào hai lô khác nhau → sót đúng 1 geometry, lúc có lúc không.
    for (let k = i; k < i + n; k++) {
      if (!w.vis[k]) continue;
      for (let p = w.items[k].parent; p && p !== m.root; p = p.parent) {
        const j = w.index.get(p);
        if (j !== undefined && w.vis[j]) p.visible = true;
      }
    }
    // Lượt warm cũng KHÔNG frustum-cull: vật thể sát mép khối bao vẫn phải được vẽ và upload.
    const culled = [];
    for (let k = i; k < i + n; k++) {
      culled.push(w.items[k].frustumCulled);
      w.items[k].frustumCulled = false;
    }
    renderer.getViewport(_vp);
    renderer.getScissor(_sc);
    const test = renderer.getScissorTest();
    renderer.setViewport(0, 0, 1, 1);
    renderer.setScissor(0, 0, 1, 1);
    renderer.setScissorTest(true);
    renderer.render(scene, this.warmCam);
    renderer.setViewport(_vp);
    renderer.setScissor(_sc);
    renderer.setScissorTest(test);
    for (let k = i; k < i + n; k++) w.items[k].frustumCulled = culled[k - i];
    w.items.forEach((o, k) => (o.visible = w.vis[k]));
    m.root.visible = false;
    scene.children.forEach((o, k) => (o.visible = saved[k]));
  }

  /** Mất context WebGL: mẫu ẩn phải warm lại; promise warm cũ vô hiệu. @param {string} activeId */
  onContextLost(activeId) {
    this.warmGen++;
    for (const r of this.records.values()) {
      if (r.id === activeId) continue;
      if (r.state === 'ready' || r.state === 'gpuWarming') {
        r.state = 'cpuReady';
        r.warm = null;
      }
    }
  }
}
