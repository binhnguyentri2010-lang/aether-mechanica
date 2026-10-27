// @ts-check
// SPECIMEN 02 — husky cơ khí, chế độ chuyển động TROT. Mọi phần riêng của husky nằm trong thư mục này
// (plan đợt 3, §1); khung chung chỉ gọi qua các hook dưới đây. Số liệu: spec.js (GaitSpec §6).
import { Vector3 } from 'three';
import { GROUND_Y } from '../../core/stage.js';
import { TrotRig } from '../../motion/TrotRig.js';
import { CATALOG, BY_ID, NOMINAL, SPEC_DESC } from './catalog.js';
import { GAIT, STRIDE } from './spec.js';
import { buildChassis } from './parts/body.js';
import { buildHead, JAW_MAX } from './parts/head.js';
import { buildLegs, solvePiston } from './parts/legs.js';
import { buildTail } from './parts/tail.js';
import { DEG } from '../../core/easing.js';

/** Instance giữ nhãn cho mỗi catalogId — bên TRÁI (+X) vì góc ISO của husky nhìn từ trước-trái. */
const REP = {
  ear: 'ear.l', skull: 'skull', optic: 'optic.l', jaw: 'jaw', neck: 'neck', chassis: 'chassis',
  core: 'core', spine: 'spine.2', shoulder: 'shoulder.l', humerus: 'humerus.fl', forearm: 'forearm.fl',
  hip: 'hip.l', thigh: 'thigh.hl', shank: 'shank.hl', paw: 'paw.fl', tail: 'tail.3',
};

const SIDE = /** @type {Record<string, string>} */ ({ l: 'Left', r: 'Right', fl: 'Front-left', fr: 'Front-right', hl: 'Hind-left', hr: 'Hind-right' });
/** Danh từ số ít cho từng loại có nhiều bản sao. */
const NOUN = /** @type {Record<string, string>} */ ({
  ear: 'ear', optic: 'optic', shoulder: 'shoulder', hip: 'hip', humerus: 'upper arm', forearm: 'forearm',
  thigh: 'thigh', shank: 'shank', paw: 'paw',
});

const _v = new Vector3();

/** @typedef {import('../../model/MechanicalModel.js').MechanicalModel} Model */

/**
 * Số đo hình học ở bind pose (cao tính từ sàn, unit) — nguồn cho ô SHOULDER và test kích thước §6.
 * @param {Model} model
 */
function measureDims(model) {
  const saved = model.explode;
  model.applyExplode(0);
  model.root.updateMatrixWorld(true);
  /** @param {(n: string) => boolean} pick @param {(x: number, y: number, z: number) => void} fn */
  const scan = (pick, fn) => {
    for (const p of model.parts) {
      if (!pick(p.name)) continue;
      for (const m of p.meshes) {
        const g = /** @type {any} */ (m).geometry;
        if (!g || /** @type {any} */ (m).isInstancedMesh) continue;
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          fn(_v.x, _v.y, _v.z);
        }
      }
    }
  };
  const d = { withers: -Infinity, back: -Infinity, chestBottom: Infinity, earTop: -Infinity, headTop: -Infinity, noseZ: -Infinity, noseH: 0, tailTipZ: -Infinity, tailTipH: 0, halfWidth: 0, minY: Infinity };
  scan((n) => n === 'chassis' || n === 'cover', (x, y, z) => {
    if (z > 0.8 && z < 1.8) d.withers = Math.max(d.withers, y);
    if (z > -1.2 && z < -0.6) d.back = Math.max(d.back, y);
    if (z > 0.8 && z < 1.6) d.chestBottom = Math.min(d.chestBottom, y);
  });
  scan((n) => n.startsWith('ear.'), (x, y) => (d.earTop = Math.max(d.earTop, y)));
  scan((n) => n === 'skull', (x, y) => (d.headTop = Math.max(d.headTop, y)));
  scan((n) => n === 'nose', (x, y, z) => {
    if (z > d.noseZ) {
      d.noseZ = z;
      d.noseH = y;
    }
  });
  // Đỉnh đuôi = điểm CUỐI đuôi (xa nhất về phía trước của khâu chót), không phải điểm cao nhất
  scan((n) => n === 'tail.6', (x, y, z) => {
    if (z > d.tailTipZ) {
      d.tailTipZ = z;
      d.tailTipH = y;
    }
  });
  // Bề ngang THÂN: vỏ + tấm yên + tang trống vai/hông (không tính bàn chân)
  scan((n) => /^(chassis|cover|belly|shoulder\.|hip\.)/.test(n), (x) => (d.halfWidth = Math.max(d.halfWidth, Math.abs(x))));
  scan(() => true, (x, y) => (d.minY = Math.min(d.minY, y)));
  model.applyExplode(saved < 0 ? 0 : saved);
  const g = GROUND_Y;
  return {
    withers: d.withers - g, back: d.back - g, chestBottom: d.chestBottom - g, earTop: d.earTop - g,
    headTop: d.headTop - g, nose: { h: d.noseH - g, z: d.noseZ }, tailTip: { h: d.tailTipH - g, z: d.tailTipZ },
    width: d.halfWidth * 2, lowest: d.minY - g,
  };
}

/** @type {import('../../model/MechanicalModel.js').SpecimenDef} */
export const husky = {
  id: 'husky',
  no: '02',
  title: 'Mechanical Husky',
  short: 'Husky',
  study: 'Project Nº 01 — Articulated Mechanical Specimen — Study 02',
  concept: 'Concept Nº 02 · Articulated Trotting Frame · 1:1 Study',
  fig: 'FIG. 02 — MECHANICAL HUSKY  ·  SHEET 02/04  ·  SCALE 1:1',
  catalog: CATALOG,
  byId: BY_ID,
  rep: REP,
  // Khối đặc có thể che nhãn (bỏ ống piston, móng, tai mỏng)
  occluders: new Set(['chassis', 'cover', 'belly', 'skull', 'jaw', 'neck', 'shoulder', 'hip', 'thigh', 'humerus', 'core']),
  desc: SPEC_DESC,
  labels: { start: 'Trot', stop: 'Stop Trot', status: 'Trotting', key: 'Trot' },
  // Chạy trên băng chuyền: lưới dấu + và trục Z của sàn trượt theo nước kiệu
  belt: true,
  // Góc camera riêng: husky quay mặt về +Z → ISO nhìn từ trước-trái, thấp hơn bướm để thấy dáng chân
  views: {
    iso: { theta: 38 * DEG, phi: 66 * DEG, fov: 30 },
    isoPortrait: { theta: 62 * DEG, phi: 64 * DEG, fov: 30 },
  },
  shadow: { w: 3.4, d: 7.6 },
  // Cao ~7 và dài ~7 unit: lùi camera ra ~1.9 lần để phối cảnh gần như bản vẽ (zoom khung ≈ 1)
  cameraScale: 1.9,

  *buildSteps(ctx) {
    const body = yield* buildChassis(ctx);
    const legs = yield* buildLegs(ctx);
    const head = yield* buildHead(ctx);
    const tail = yield* buildTail(ctx);
    return {
      ...body, legs, head, tail: tail.links, tailJoints: tail.joints,
      gait: GAIT, ground: GROUND_Y, jawMax: JAW_MAX,
    };
  },

  /** Chủ: piston khuỷu/gối (DOF "linkage"). @param {Model} model */
  afterExplode(model) {
    for (const L of model.data.legs) solvePiston(L.piston, L.lower);
  },

  /** @param {Model} model */
  solveLinkages(model) {
    for (const L of model.data.legs) solvePiston(L.piston, L.lower);
  },

  /** Chủ: độ sáng lõi năng lượng (không phải DOF — chỉ opacity sprite). */
  ambient(model, dt, env) {
    const breath = 0.86 + 0.14 * Math.sin(env.clock * 1.1) * env.amb;
    const glowGain = env.theme === 'azure' ? 0.4 : 1;
    model.data.glowMat.opacity = 0.8 * breath * env.intro * glowGain * (1 + env.motion * 0.5);
  },

  createRig(model) {
    return new TrotRig(model);
  },

  /** @param {Model} model */
  measure(model) {
    return measureDims(model);
  },

  /** Bốn ô SPECIFICATION. SHOULDER đo từ hình học; STRIDE/CADENCE đọc từ GaitSpec. */
  specFields(model) {
    const m = model.userData.measured || (model.userData.measured = model.measure());
    return [
      { label: 'Shoulder', value: `${Math.round(m.withers * 10)} cm` },
      { label: 'Mass', value: `${NOMINAL.massKg.toFixed(1)} kg` },
      { label: 'Stride', value: `${Math.round(STRIDE * 10)} cm` },
      { label: 'Cadence', value: `${GAIT.cycleHz.toFixed(1)} Hz` },
    ];
  },

  /** "paw.fl" → "Front-left paw" (inspector ghi rõ instance được bấm, plan §7). @param {string} name */
  instanceLabel(name) {
    const [kind, pos] = name.split('.');
    if (pos === undefined) return null;
    if (/^\d+$/.test(pos)) {
      const n = Number(pos) + 1;
      return kind === 'tail' ? `Link ${n} of 7` : kind === 'spine' ? `Vertebra ${n} of 6` : `#${n}`;
    }
    return SIDE[pos] && NOUN[kind] ? `${SIDE[pos]} ${NOUN[kind]}` : null;
  },
};
