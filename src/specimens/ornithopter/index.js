// @ts-check
// SPECIMEN 01 — ornithopter bốn cánh. Mọi phần riêng của con bướm nằm ở đây (plan đợt 3, §1);
// khung chung (MechanicalModel, components) chỉ gọi qua các hook dưới đây.
import { Vector3 } from 'three';
import { CATALOG, BY_ID, NOMINAL, SPEC_DESC } from './catalog.js';
import { buildThorax } from './assemblies/thorax.js';
import { buildCore } from './assemblies/core.js';
import { buildHead } from './assemblies/head.js';
import { buildSpine } from './assemblies/spine.js';
import { buildLegs } from './assemblies/legs.js';
import { buildCoupling, updateCables } from './assemblies/drivetrain.js';
import { buildWing, updateLinkage } from './assemblies/wing.js';
import { FlightRig, STROKE_DEG, RATE_HZ } from '../../motion/FlightRig.js';

/** Instance giữ nhãn cho mỗi catalogId (loại có nhiều bản sao: servo ×4, spar ×8...). */
const REP = {
  antenna: 'antenna-R', cranial: 'head', optic: 'optic-L', housing: 'housing', core: 'core',
  fcu: 'fcu', servo: 'servo-R-fore', hinge: 'hinge-L-hind', pivot: 'pin-L-fore',
  linkage: 'linkage-R-hind', spar: 'spar-out-R-fore', carpal: 'carpal-L-fore',
  membrane: 'lattice-in-L-hind', coupling: 'coupling', spine: 'spine-3', caudal: 'caudal',
};

const _v = new Vector3();

/** @typedef {import('../../model/MechanicalModel.js').MechanicalModel} Model */

/** @type {import('../../model/MechanicalModel.js').SpecimenDef} */
export const ornithopter = {
  id: 'ornithopter',
  no: '01',
  title: 'Mechanical Ornithopter',
  short: 'Ornithopter',
  study: 'Project Nº 01 — Articulated Mechanical Specimen — Study 01',
  concept: 'Concept Nº 01 · Articulated Flight System · 1:1 Study',
  fig: 'FIG. 01 — FOUR-WING ORNITHOPTER  ·  SHEET 01/04  ·  SCALE 1:1',
  catalog: CATALOG,
  byId: BY_ID,
  rep: REP,
  // Bộ phận khối đặc có thể che nhãn (bỏ màng/khung cánh mỏng, ống, dây, chân)
  occluders: new Set(['housing', 'cover', 'belly', 'core', 'fcu', 'cranial', 'optic', 'spine', 'caudal', 'coupling', 'servo', 'hinge']),
  desc: SPEC_DESC,
  labels: { start: 'Take Flight', stop: 'Stop Flight', status: 'In flight', key: 'Flight' },
  shadow: { w: 6.8, d: 4.8 },

  /** "servo-R-fore" → "Right fore" (inspector ghi rõ instance được bấm). @param {string} name */
  instanceLabel(name) {
    const side = /(^|-)R(-|$)/.test(name) ? 'Right' : /(^|-)L(-|$)/.test(name) ? 'Left' : '';
    const pos = /-fore$/.test(name) ? 'fore' : /-hind$/.test(name) ? 'hind' : '';
    const num = /-(\d+)$/.exec(name);
    const s = [side, pos].filter(Boolean).join(' ') || (num ? `#${Number(num[1]) + 1}` : '');
    return s || null;
  },

  // Thứ tự dựng GIỮ NGUYÊN như trước refactor: id đối tượng three.js (dùng khi sắp xếp vật thể trong
  // suốt cùng độ sâu) không đổi → ảnh golden khớp từng pixel.
  *buildSteps(ctx) {
    const thorax = buildThorax(ctx);
    yield;
    const core = buildCore(ctx);
    yield;
    const head = buildHead(ctx);
    yield;
    const spine = buildSpine(ctx);
    yield;
    const legs = buildLegs(ctx);
    yield;
    const coupling = buildCoupling(ctx);
    yield;
    const wings = [];
    for (const [s, which] of /** @type {[1|-1, 'fore'|'hind'][]} */ ([[1, 'fore'], [-1, 'fore'], [1, 'hind'], [-1, 'hind']])) {
      wings.push(buildWing(ctx, s, which));
      yield;
    }
    return { thorax, core, head, spine, legs, coupling, wings };
  },

  /** Chủ: linkage cánh + cáp đồng (DOF "linkage"). @param {Model} model */
  afterExplode(model) {
    for (const w of model.data.wings) updateLinkage(w);
    updateCables(model.data.coupling, model.data.spine.segs[1]);
  },

  /** @param {Model} model */
  solveLinkages(model) {
    for (const w of model.data.wings) updateLinkage(w);
  },

  /** Chủ: gimbal quay + glow core (DOF "ambient"). */
  ambient(model, dt, env) {
    const core = model.data.core;
    for (const r of core.rings) r.spin.rotation[r.axis] += dt * r.speed * env.amb * (1 + env.motion * 4);
    const breath = 0.86 + 0.14 * Math.sin(env.clock * 1.3) * env.amb;
    const glowGain = env.theme === 'azure' ? 0.35 : 1; // cộng sáng trên nền kem sẽ loá
    core.glowMat.opacity = 0.8 * breath * env.intro * glowGain * (1 + env.motion * 0.4);
  },

  createRig(model) {
    return new FlightRig(model);
  },

  /** Sải cánh đo từ hình học, tư thế nghỉ, cánh phẳng (cm). @param {Model} model */
  measure(model) {
    const wings = model.data.wings;
    const saved = model.explode;
    const flap = wings.map((/** @type {any} */ w) => w.module.pivot.rotation.z);
    wings.forEach((/** @type {any} */ w) => w.module.pivot.rotation.set(0, 0, 0));
    model.applyExplode(0);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const w of wings)
      for (const l of w.lattices)
        l.group.traverse((/** @type {any} */ o) => {
          if (!o.isMesh) return;
          const pos = o.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            if (_v.x < minX) minX = _v.x;
            if (_v.x > maxX) maxX = _v.x;
          }
        });
    wings.forEach((/** @type {any} */ w, /** @type {number} */ i) => (w.module.pivot.rotation.z = flap[i]));
    model.applyExplode(saved < 0 ? 0 : saved);
    return { wingspanCm: (maxX - minX) * 10 };
  },

  /** Bốn ô SPECIFICATION. WINGSPAN đo từ hình học; ANGLE/RATE đọc từ hằng số FlightRig. */
  specFields(model) {
    const m = model.userData.measured || (model.userData.measured = model.measure());
    return [
      { label: 'Wingspan', value: `${Math.round(m.wingspanCm)} cm` },
      { label: 'Mass', value: `${NOMINAL.massKg.toFixed(1)} kg` },
      { label: 'Angle', value: `${STROKE_DEG}°` },
      { label: 'Rate', value: `${RATE_HZ.toFixed(1)} Hz` },
    ];
  },
};
