// @ts-check
// KHUNG CHUNG cho một mẫu vật (plan đợt 3, §1). Không biết gì về bướm hay chó: mọi phần riêng đi qua
// SpecimenDef (src/specimens/<mẫu>/index.js).
//
//   root (scale intro/transition)
//    └ motionRoot (thân nhấp nhô khi chuyển động — chủ: MotionRig)
//        └ các part cấp cao (group ← explode, pivot/joint ← chuyển động)
//
// applyExplode(e) là hàm thuần theo e (plan §9 đợt 1): gọi hai lần cùng e cho cùng kết quả.
import {
  Group, Mesh, Vector3, Matrix4, Box3, LineSegments, BufferGeometry, BufferAttribute,
  LineDashedMaterial, BatchedMesh,
} from 'three';
import { Part } from './Part.js';
import { mergeGeometries } from '../core/merge.js';
import { boltInstances } from './geo/fasteners.js';

/**
 * Bối cảnh dựng hình mà mỗi assembly nhận.
 * @typedef {{
 *   motionRoot: Group,
 *   part: (kind: string, name: string) => Part,
 *   top: (p: Part) => Part,
 *   material: (key: import('./materials.js').MatKey, p: Part, o?: {doubleSide?: boolean}) => any,
 *   mesh: (p: Part, geo: BufferGeometry, key: import('./materials.js').MatKey, o?: {parent?: import('three').Object3D, doubleSide?: boolean, renderOrder?: number}) => Mesh,
 *   merge: (p: Part, key: import('./materials.js').MatKey, geos: BufferGeometry[], o?: {parent?: import('three').Object3D, doubleSide?: boolean}) => Mesh,
 *   bolts: (p: Part, key: import('./materials.js').MatKey, list: {p: Vector3, n: Vector3}[], geo: BufferGeometry) => any,
 *   adopt: (p: Part, m: Mesh, parent: import('three').Object3D) => void,
 * }} BuildContext
 */

/**
 * Định nghĩa một mẫu vật. Đơn vị: 1 unit = 10 cm. Mỗi hook CHỈ ghi các DOF nó sở hữu (plan §5).
 * @typedef {{
 *   id: string, no: string, title: string, short: string, study: string, concept: string, fig: string,
 *   catalog: import('./types.js').CatalogEntry[],
 *   byId: Record<string, import('./types.js').CatalogEntry>,
 *   rep: Record<string, string>,
 *   occluders: Set<string>,
 *   desc: Record<'azure'|'obsidian', string>,
 *   labels: {start: string, stop: string, status: string, key: string},
 *   buildSteps: (ctx: BuildContext) => Generator<void, any, void>,
 *   afterExplode: (model: MechanicalModel) => void,
 *   solveLinkages: (model: MechanicalModel) => void,
 *   ambient: (model: MechanicalModel, dt: number, env: {clock: number, amb: number, motion: number, intro: number, theme: string}) => void,
 *   createRig: (model: MechanicalModel) => any,
 *   measure: (model: MechanicalModel) => Record<string, any>,
 *   specFields: (model: MechanicalModel, theme: string) => {label: string, value: string}[],
 *   views?: Partial<Record<'iso'|'plan'|'front'|'profile'|'isoPortrait', {theta: number, phi: number, fov: number}>>,
 *   shadow: {w: number, d: number}, cameraScale?: number, belt?: boolean,
 *   instanceLabel?: (name: string) => string|null,
 * }} SpecimenDef
 */

const _v = new Vector3();
const _w = new Vector3();
const _inv = new Matrix4();
const _mm = new Matrix4();

/**
 * @typedef {{b: BatchedMesh, meshes: Mesh[], last: Float64Array}} Batch
 */

/**
 * Geometry đưa vào BatchedMesh: đúng ba thuộc tính dùng chung (position, normal, uv) + index — mọi phần tử
 * của một lô phải cùng bộ thuộc tính và cùng có index (ExtrudeGeometry không có index). Thuộc tính được
 * dùng chung với geometry gốc, BatchedMesh chép dữ liệu sang bộ đệm của nó.
 * @param {BufferGeometry} src
 */
function batchGeometry(src) {
  const g = new BufferGeometry();
  const n = src.attributes.position.count;
  g.setAttribute('position', src.attributes.position);
  if (!src.attributes.normal) src.computeVertexNormals();
  g.setAttribute('normal', src.attributes.normal);
  g.setAttribute('uv', src.attributes.uv || new BufferAttribute(new Float32Array(n * 2), 2));
  let index = src.index;
  if (!index) {
    const a = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let k = 0; k < n; k++) a[k] = k;
    index = new BufferAttribute(a, 1);
  }
  g.setIndex(index);
  return g;
}

/**
 * Chép ma trận + trạng thái hiện của từng mesh gốc sang phần tử tương ứng trong lô. Gọi trong onBeforeRender
 * của lô: lúc đó renderer vừa cập nhật ma trận (cục bộ lẫn thế giới) cho cả cảnh, nên lô khớp đúng khung đang vẽ.
 * Ma trận phần tử = TÍCH MA TRẬN CỤC BỘ từ mesh lên tới cha của lô — không dùng nghịch đảo(lô) × matrixWorld:
 * cách đó sinh nhiễu làm tròn mỗi khi thân (cha của lô) chuyển động, nên phép so bằng luôn thấy "khác" và mọi
 * lô đẩy lại texture mỗi khung. Tích cục bộ trùng từng bit khi part đứng yên. Đo thật khi bay/chạy: số lô đẩy
 * texture mỗi khung 57 → 17 (bướm), 45 → 27 (husky); đứng yên 0.
 * Chỉ ghi (và đẩy texture ma trận lên GPU) khi ma trận đổi. 0 cấp phát.
 * @param {Batch} B
 */
function syncBatch(B) {
  const { b, meshes, last } = B;
  const top = b.parent;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    _mm.copy(m.matrix);
    for (let p = m.parent; p && p !== top; p = p.parent) _mm.premultiply(p.matrix);
    const e = _mm.elements;
    const o = i * 16;
    let same = true;
    for (let k = 0; k < 16; k++) if (e[k] !== last[o + k]) { same = false; break; }
    if (!same) {
      for (let k = 0; k < 16; k++) last[o + k] = e[k];
      b.setMatrixAt(i, _mm);
    }
    let vis = m.visible;
    for (let p = m.parent; vis && p && p !== b.parent; p = p.parent) vis = p.visible;
    b.setVisibleAt(i, vis);
  }
}

export class MechanicalModel {
  /**
   * @param {SpecimenDef} def
   * @param {import('./materials.js').MaterialLibrary} lib
   * @param {import('./materialState.js').MaterialState} ms
   * @param {{deferred?: boolean, batch?: boolean}} [o] deferred: KHÔNG dựng ngay — người gọi chạy buildStep()
   *   theo lát thời gian · batch: false = vẽ từng mesh riêng (chỉ để đo A/B, ?nobatch)
   */
  constructor(def, lib, ms, o = {}) {
    this.def = def;
    this.id = def.id;
    this.batch = o.batch !== false;
    /** Lô vẽ (xem _batchSteps). @type {Batch[]} */
    this.batches = [];
    this.root = new Group();
    this.root.name = 'specimen-' + def.id;
    this.motionRoot = new Group();
    this.root.add(this.motionRoot);
    /** @type {Part[]} */ this.parts = [];
    /** @type {Part[]} */ this.topParts = [];
    /** @type {Map<string, Part>} */ this.byName = new Map();
    /** @type {Map<string, Part[]>} */ this.byKind = new Map();
    /** @type {import('three').Object3D[]} */ this.pickables = [];
    this.explode = -1;
    /** Dữ liệu riêng mẫu vật do buildSteps trả về (cụm cánh, core…). @type {any} */
    this.data = null;
    /** Bộ nhớ đệm của mẫu (số đo…). @type {Record<string, any>} */
    this.userData = {};

    const self = this;
    // Vật liệu DÙNG CHUNG trong mẫu theo (kind, vai trò, hai mặt, instancing). MaterialState chỉ tính dim/glow
    // theo kind + vai trò → mọi mesh cùng khoá luôn mang cùng giá trị, bản sao riêng từng mesh chỉ khiến three
    // nạp lại toàn bộ uniform ở mỗi draw call (trước: 222 vật liệu cho 222 draw call). Mesh thường và
    // InstancedMesh KHÔNG chung: dùng xen kẽ buộc three tính lại khoá program ở mỗi lần vẽ.
    /** @type {Map<string, any>} */
    const mats = new Map();
    /** @param {import('./materials.js').MatKey} key @param {Part} p @param {{doubleSide?: boolean}} o @param {boolean} inst */
    const shared = (key, p, o, inst) => {
      const k = `${p.kind}|${key}|${o.doubleSide ? 2 : 1}|${inst ? 'i' : 'm'}`;
      let m = mats.get(k);
      if (!m) {
        m = lib.make(key, o);
        ms.register(m, p.kind, def.id);
        mats.set(k, m);
      }
      return m;
    };
    /** @type {BuildContext} */
    const ctx = {
      motionRoot: this.motionRoot,
      part(kind, name) {
        // plan §7: instanceId phải duy nhất — trùng là lỗi dựng hình, không được ghi đè âm thầm
        if (self.byName.has(name)) throw new Error(`Part trùng tên "${name}" trong mẫu ${def.id}`);
        const p = new Part(kind, name);
        self.parts.push(p);
        self.byName.set(name, p);
        if (!self.byKind.has(kind)) self.byKind.set(kind, []);
        /** @type {Part[]} */ (self.byKind.get(kind)).push(p);
        return p;
      },
      top(p) {
        self.motionRoot.add(p.group);
        self.topParts.push(p);
        return p;
      },
      material(key, p, o = {}) {
        return shared(key, p, o, false);
      },
      mesh(p, geo, key, o = {}) {
        const m = new Mesh(geo, ctx.material(key, p, o));
        if (o.renderOrder) m.renderOrder = o.renderOrder;
        (o.parent || p.pivot).add(m);
        m.userData.part = p;
        p.meshes.push(m);
        self.pickables.push(m);
        return m;
      },
      merge(p, key, geos, o = {}) {
        return ctx.mesh(p, mergeGeometries(geos), key, o);
      },
      bolts(p, key, list, geo) {
        const im = boltInstances(geo, shared(key, p, {}, true), list);
        p.pivot.add(im);
        im.userData.part = p;
        p.meshes.push(/** @type {any} */ (im));
        return im;
      },
      adopt(p, m, parent) {
        parent.add(m);
        m.userData.part = p;
        p.meshes.push(m);
        self.pickables.push(m);
      },
    };

    /** Bộ sinh các bước dựng (mỗi bước ~ một part, rồi mỗi lô vẽ một bước). */
    this._it = this._steps(def.buildSteps(ctx));
    /** Dựng xong (đủ part, traces, điểm mẫu). */
    this.ready = false;
    /** Bước dựng dài nhất (ms) — plan đợt 3 §4: đo và ghi lại. */
    this.maxStepMs = 0;
    this.steps = 0;
    /** Part giữ điểm neo nhãn cho mỗi mục catalog có nhãn. @type {Record<string, Part>} */
    this.reps = {};
    // Dựng đồng bộ trừ khi được yêu cầu chia lát (mẫu dựng nền). Thứ tự tạo đối tượng y hệt nhau.
    if (!o.deferred) this.buildStep(Infinity);
  }

  /**
   * Chạy các bước dựng tới khi hết hạn (performance.now() ≥ deadline) hoặc xong.
   * @param {number} deadline @returns {boolean} đã dựng xong
   */
  buildStep(deadline) {
    if (this.ready) return true;
    for (;;) {
      const t = performance.now();
      const r = this._it.next();
      this.steps++;
      if (r.done) {
        this.data = r.value;
        this._finish();
        this.maxStepMs = Math.max(this.maxStepMs, performance.now() - t);
        return true;
      }
      this.maxStepMs = Math.max(this.maxStepMs, performance.now() - t);
      if (performance.now() >= deadline) return false;
    }
  }

  /** Các bước của mẫu, rồi gom mesh thành lô vẽ. @param {Generator<void, any, void>} inner */
  *_steps(inner) {
    const data = yield* inner;
    if (this.batch) yield* this._batchSteps();
    return data;
  }

  // ── Vẽ theo lô ──────────────────────────────────────────────────────────────────────────────────
  // Đo thật trên Edge + Intel Iris Xe (tests/profile.html): thời gian khung TỈ LỆ VỚI SỐ DRAW CALL (~30 µs mỗi
  // lần ở JS và ngần ấy ở tiến trình GPU), gần như không đổi khi giảm điểm ảnh còn 1/4 hay tắt MSAA.
  // Mesh gốc vẫn là model LOGIC — explode, pick, hộp bao, nhãn, focus, điểm mẫu đều dùng nó — nhưng chuyển
  // sang layer 1 nên camera không vẽ; mỗi vật liệu (+ renderOrder) một BatchedMesh dưới root vẽ thay bằng
  // một lệnh multi-draw. Vật liệu vốn đã chung theo (kind, vai trò) nên dim/glow theo kind vẫn đúng.
  // Mesh có geometry ghi lại mỗi khung (userData.dynamic, vd. dây cáp) và InstancedMesh giữ nguyên.

  /** Mỗi lô một bước dựng (vẫn chia lát được khi dựng nền). */
  *_batchSteps() {
    /** @type {Map<string, Mesh[]>} */
    const groups = new Map();
    this.root.traverse((o) => {
      const m = /** @type {any} */ (o);
      if (!m.isMesh || m.isInstancedMesh || m.isBatchedMesh || m.userData.dynamic || !m.userData.part) return;
      const k = m.material.id + '|' + m.renderOrder;
      if (!groups.has(k)) groups.set(k, []);
      /** @type {Mesh[]} */ (groups.get(k)).push(m);
    });
    for (const meshes of groups.values()) {
      this._makeBatch(meshes);
      yield;
    }
  }

  /** @param {Mesh[]} meshes cùng vật liệu và renderOrder */
  _makeBatch(meshes) {
    const geos = meshes.map((m) => batchGeometry(m.geometry));
    let nv = 0, ni = 0;
    for (const g of geos) {
      nv += g.attributes.position.count;
      ni += /** @type {BufferAttribute} */ (g.index).count;
    }
    const mat = /** @type {any} */ (meshes[0].material);
    const b = new BatchedMesh(meshes.length, nv, ni, mat);
    b.name = `batch-${meshes[0].userData.part.kind}-${mat.userData.matKey}`;
    b.renderOrder = meshes[0].renderOrder;
    b.frustumCulled = false; // hộp bao của cả lô không theo ma trận từng phần tử
    b.perObjectFrustumCulled = false; // model luôn nằm trong khung hình (camera căn theo nó)
    b.sortObjects = !!mat.transparent; // chỉ vật trong suốt cần vẽ xa → gần
    for (const g of geos) b.addGeometry(g);
    // Float64: so với elements (số double). Bản đầu dùng Float32Array → giá trị lưu bị làm tròn nên LUÔN "khác"
    // → mọi lô đẩy lại texture ma trận mỗi khung (đo thật: 50 texSubImage2D/khung khi model đứng yên).
    /** @type {Batch} */
    const B = { b, meshes, last: new Float64Array(meshes.length * 16).fill(NaN) };
    b.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      syncBatch(B);
      BatchedMesh.prototype.onBeforeRender.call(this, renderer, scene, camera, geometry, material, group);
    };
    // Dưới motionRoot (mọi part cấp cao nằm trong nó): thân nhấp nhô/chúi khi bay/chạy chỉ đổi MỘT ma trận của
    // lô, không đổi ma trận từng phần tử → chỉ lô có part thật sự chuyển động mới phải đẩy lại texture ma trận.
    this.motionRoot.add(b);
    for (const m of meshes) m.layers.set(1);
    this.batches.push(B);
  }

  _finish() {
    const def = this.def;
    for (const c of def.catalog) {
      const name = def.rep[c.id];
      const p = name ? this.byName.get(name) : undefined;
      if (c.annotate && p && p.anchor) this.reps[c.id] = p;
    }
    this._buildTraces();
    this.applyExplode(0);
    this._buildSamples();
    this.ready = true;
  }

  // ── Explode ──────────────────────────────────────────────────────────────────────────────────

  /** @param {number} e */
  applyExplode(e) {
    this.explode = e;
    for (const p of this.topParts) p.applyExplode(e);
    this.def.afterExplode(this);
    this.root.updateMatrixWorld(true);
    this._updateTraces(e);
  }

  /** Sau khi rig đổi tư thế: giải lại cơ cấu (piston, thanh truyền). */
  updateLinkages() {
    this.def.solveLinkages(this);
  }

  // ── Đường dóng lắp ráp: MỘT LineSegments, buffer cấp sẵn, ghi đè tại chỗ ──────────────────────

  _buildTraces() {
    this.traceParts = this.parts.filter((p) => p.dist > 0);
    const n = this.traceParts.length;
    this.tracePos = new Float32Array(n * 6);
    this.traceDist = new Float32Array(n * 2);
    const g = new BufferGeometry();
    this.tracePosAttr = new BufferAttribute(this.tracePos, 3);
    this.traceDistAttr = new BufferAttribute(this.traceDist, 1);
    g.setAttribute('position', this.tracePosAttr);
    g.setAttribute('lineDistance', this.traceDistAttr);
    this.traceMat = new LineDashedMaterial({
      color: 0xe8e0cf, dashSize: 0.03, gapSize: 0.028, transparent: true, opacity: 0,
      depthWrite: false, toneMapped: false,
    });
    this.traces = new LineSegments(g, this.traceMat);
    this.traces.frustumCulled = false;
    this.traces.renderOrder = 3;
    this.root.add(this.traces);
  }

  /** @param {number} e */
  _updateTraces(e) {
    const tp = /** @type {Part[]} */ (this.traceParts);
    const pos = /** @type {Float32Array} */ (this.tracePos);
    const dist = /** @type {Float32Array} */ (this.traceDist);
    _inv.copy(this.root.matrixWorld).invert();
    for (let i = 0; i < tp.length; i++) {
      const p = tp[i];
      const parent = /** @type {import('three').Object3D} */ (p.group.parent);
      _v.copy(p.home).applyMatrix4(parent.matrixWorld).applyMatrix4(_inv);
      _w.copy(p.group.position).applyMatrix4(parent.matrixWorld).applyMatrix4(_inv);
      pos[i * 6] = _v.x; pos[i * 6 + 1] = _v.y; pos[i * 6 + 2] = _v.z;
      pos[i * 6 + 3] = _w.x; pos[i * 6 + 4] = _w.y; pos[i * 6 + 5] = _w.z;
      dist[i * 2] = 0;
      dist[i * 2 + 1] = _v.distanceTo(_w);
    }
    /** @type {BufferAttribute} */ (this.tracePosAttr).needsUpdate = true;
    /** @type {BufferAttribute} */ (this.traceDistAttr).needsUpdate = true;
    this.traceOpacity = 0.17 * Math.min(1, e * 1.6);
  }

  // ── Điểm mẫu cho căn khung và bố trí nhãn ─────────────────────────────────────────────────────

  _buildSamples() {
    const take = (/** @type {number} */ e) => {
      this.applyExplode(e);
      _inv.copy(this.root.matrixWorld).invert();
      /** @type {number[]} */
      const out = [];
      const meshes = this.pickables.filter((m) => /** @type {Mesh} */ (m).isMesh && !(/** @type {any} */ (m).isInstancedMesh));
      let total = 0;
      for (const m of meshes) total += /** @type {Mesh} */ (m).geometry.attributes.position.count;
      const stride = Math.max(1, Math.floor(total / 900));
      for (const m of meshes) {
        const pos = /** @type {Mesh} */ (m).geometry.attributes.position;
        for (let i = 0; i < pos.count; i += stride) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(_inv);
          out.push(_v.x, _v.y, _v.z);
        }
      }
      return new Float32Array(out);
    };
    this.samples1 = take(1);
    this.samples0 = take(0);
    const box0 = new Box3();
    const box1 = new Box3();
    for (let i = 0; i < this.samples0.length; i += 3) box0.expandByPoint(_v.fromArray(this.samples0, i));
    for (let i = 0; i < this.samples1.length; i += 3) box1.expandByPoint(_v.fromArray(this.samples1, i));
    this.box0 = box0;
    this.box1 = box1;
    this.center0 = box0.getCenter(new Vector3());
    this.center1 = box1.getCenter(new Vector3());
    // Tập nhỏ hơn cho việc bố trí nhãn mỗi khung
    const pick = (/** @type {Float32Array} */ a) => {
      const n = a.length / 3;
      const step = Math.max(1, Math.floor(n / 120));
      /** @type {number[]} */
      const o = [];
      for (let i = 0; i < n; i += step) o.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      return new Float32Array(o);
    };
    this.lite0 = pick(this.samples0);
    this.lite1 = pick(this.samples1);
  }

  /** Tâm hình của model ở mức nổ e (toạ độ root). @param {number} e @param {Vector3} out */
  centerAt(e, out) {
    return out.lerpVectors(/** @type {Vector3} */ (this.center0), /** @type {Vector3} */ (this.center1), e);
  }

  /** Số đo từ hình học của mẫu (đơn vị do mẫu khai báo, ví dụ cm). */
  measure() {
    return this.def.measure(this);
  }

  /** @param {string} name */
  partByName(name) {
    return this.byName.get(name) || null;
  }
}
