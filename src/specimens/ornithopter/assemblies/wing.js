// @ts-check
// Một cụm cánh (module): bản lề + servo + linkage bên thân, và cánh quạt kiểu Papilio trên pivot.
//
// Hệ toạ độ module: gốc nằm trên ĐƯỜNG CHỐT HINGE (x = ±0.35, y = 0.08), trục chốt // Z.
//   module.group  ← dịch explode
//     ├ pin, hinge, servo, pinion, linkage      (phía thân: không quay theo cánh)
//     └ module.pivot  ← quay vỗ cánh quanh Z (cùng một đường thẳng cho cánh trước và sau)
//          ├ spar trong + tấm gốc + cần đẩy, carpal, tấm cánh trong, bánh răng đồng trục
//          └ feather (tại khớp carpal, quay quanh tiếp tuyến spar)
//               ├ spar ngoài
//               └ tấm cánh ngoài (+ mép lượn sóng, cụm bánh xích)
import {
  BufferGeometry, BufferAttribute, BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh,
  Quaternion, Shape, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { FORE_FAN, HIND_FAN, buildFan } from '../geo/fanWing.js';
import { tubeThrough, cylZ } from '../../../model/geo/tube.js';
import { gearGeometry } from '../../../model/geo/gear.js';

export const HINGE = { x: 0.35, y: 0.08 };
const DT = 0.012; // khe (theo tham số t) giữa tấm trong và tấm ngoài tại đường carpal
const Y = new Vector3(0, 1, 0);

/**
 * @typedef {[number, number, number]} P3
 * @typedef {{
 *   module: import('../../../model/Part.js').Part, s: number, which: 'fore'|'hind', zMid: number, zs: number,
 *   feather: Group, fAxis: Vector3, pinion: import('../../../model/Part.js').Part,
 *   servo: import('../../../model/Part.js').Part, link: Linkage, fan: import('../geo/fanWing.js').Fan,
 *   lattices: import('../../../model/Part.js').Part[], panels: {obj: Group, t0: number, t1: number, map: (p: P3) => Vector3}[],
 * }} WingRig
 * @typedef {{
 *   part: import('../../../model/Part.js').Part, horn: Mesh, rod: Mesh, O: Vector3, L0: Vector3,
 *   a: number, Lr: number,
 * }} Linkage
 */

/**
 * Màng cong: lưới đỉnh trên từng múi trong khoảng t ∈ [t0, t1].
 * @param {import('../geo/fanWing.js').Fan} fan @param {number} t0 @param {number} t1
 * @param {(p: P3) => Vector3} map @param {number} nt @param {number} nw
 */
function membraneGeometry(fan, t0, t1, map, nt, nw) {
  const per = (nt + 1) * (nw + 1);
  const pos = new Float32Array(fan.n * per * 3);
  const uv = new Float32Array(fan.n * per * 2);
  const idx = [];
  let o = 0;
  for (let i = 0; i < fan.n; i++) {
    const base = i * per;
    for (let a = 0; a <= nt; a++) {
      const t = t0 + ((t1 - t0) * a) / nt;
      for (let b = 0; b <= nw; b++) {
        const w = b / nw;
        const p = map(fan.patch(i, t, w));
        pos[o * 3] = p.x; pos[o * 3 + 1] = p.y; pos[o * 3 + 2] = p.z;
        uv[o * 2] = t; uv[o * 2 + 1] = (i + w) / fan.n;
        o++;
      }
    }
    for (let a = 0; a < nt; a++)
      for (let b = 0; b < nw; b++) {
        const p0 = base + a * (nw + 1) + b;
        const p1 = p0 + 1;
        const p2 = p0 + nw + 1;
        const p3 = p2 + 1;
        idx.push(p0, p2, p1, p1, p2, p3);
      }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * @param {import('../../../model/MechanicalModel.js').BuildContext} ctx
 * @param {1|-1} s  +1 cánh phải (+X), −1 cánh trái
 * @param {'fore'|'hind'} which
 * @returns {WingRig}
 */
export function buildWing(ctx, s, which) {
  const fore = which === 'fore';
  const fan = buildFan(fore ? FORE_FAN : HIND_FAN);
  const tag = `${s > 0 ? 'R' : 'L'}-${which}`;
  const zMid = fore ? 0.23 : -0.23;
  const zs = fore ? 1 : -1; // hướng z đi ra xa khe giữa hai cánh
  const tc = fan.tc;
  const C = fan.C;

  const module = ctx.top(ctx.part('wingModule', 'wing-' + tag)).at(s * HINGE.x, HINGE.y, 0);
  if (fore) module.explode(s * 0.35, 0.9, 0.25, 1.25, 0);
  else module.explode(s * 0.35, -0.8, -0.3, 1.15, 0);

  /** @param {P3} p */
  const toV = ([u, v, y]) => new Vector3(s * u, y, v);
  /** @param {P3} p */
  const toF = ([u, v, y]) => new Vector3(s * (u - C[0]), y, v - C[1]);

  // ── Phía cánh (trên pivot) ──────────────────────────────────────────────────────────────────
  const sparIn = module.add(ctx.part('spar', `spar-in-${tag}`));
  ctx.mesh(sparIn, tubeThrough(fan.ribLine(0, 0, tc - DT).map(toV), 0.026, { radial: 10 }), 'silver');
  const plate = new Shape();
  const pv = fore
    ? [[-0.01, 0.09], [0.13, 0.1], [0.26, 0.2], [0.15, 0.37], [-0.01, 0.375]]
    : [[-0.01, -0.09], [0.13, -0.1], [0.26, -0.2], [0.15, -0.37], [-0.01, -0.375]];
  pv.forEach(([u, v], i) => (i ? plate.lineTo(s * u, v) : plate.moveTo(s * u, v)));
  plate.closePath();
  const pg = new ExtrudeGeometry(plate, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
  pg.translate(0, 0, -0.007);
  pg.rotateX(Math.PI / 2); // hình (x, y) → (x, z)
  ctx.mesh(sparIn, pg, 'carbon');
  const knuckle = cylZ(0.034, 0.1, 0, 0, zMid, 24);
  const L0 = new Vector3(s * 0.024, 0.066, zMid);
  const lever = [knuckle];
  const arm = new CylinderGeometry(0.008, 0.008, 0.05, 8);
  arm.applyQuaternion(new Quaternion().setFromUnitVectors(Y, new Vector3(s * 0.012, 0.036, 0).normalize()));
  arm.translate(s * 0.018, 0.048, zMid);
  lever.push(arm);
  const lb = new SphereGeometry(0.012, 10, 8);
  lb.translate(L0.x, L0.y, L0.z);
  lever.push(lb);
  ctx.merge(sparIn, 'brass', lever);

  const carpal = module.add(ctx.part('carpal', `carpal-${tag}`)).at(s * C[0], 0, C[1]).explode(0, 1, 0, 0.14, 0.3);
  const d3 = new Vector3(s * fan.d[0], 0, fan.d[1]).normalize();
  const qd = new Quaternion().setFromUnitVectors(Y, d3);
  const drum = new CylinderGeometry(0.031, 0.031, 0.075, 20);
  drum.applyQuaternion(qd);
  ctx.mesh(carpal, drum, 'brass');
  const cr = [];
  for (const k of [-0.042, 0.042]) {
    const t = new TorusGeometry(0.03, 0.0055, 6, 24);
    t.rotateX(Math.PI / 2);
    t.applyQuaternion(qd);
    t.translate(d3.x * k, 0, d3.z * k);
    cr.push(t);
  }
  ctx.merge(carpal, 'azure', cr);
  carpal.anchor = new Vector3(0, 0.032, 0);

  const feather = new Group();
  feather.position.set(s * C[0], 0, C[1]);
  module.pivot.add(feather);
  const fAxis = d3.clone();

  const sparOut = module.add(ctx.part('spar', `spar-out-${tag}`), feather);
  const outerSpar = fan.ribLine(0, tc + DT, 1);
  ctx.mesh(sparOut, tubeThrough(outerSpar.map(toF), 0.021, { radial: 10 }), 'silver');
  // Ngọc trai ở mút spar (chấm trắng ở đầu cánh trong ảnh mẫu)
  const tipCap = new SphereGeometry(0.034, 16, 12);
  const tp = toF(outerSpar[outerSpar.length - 1]);
  tipCap.translate(tp.x, tp.y, tp.z);
  ctx.mesh(sparOut, tipCap, 'pearl');
  const midOut = toF(outerSpar[Math.floor(outerSpar.length * 0.55)]);
  sparOut.anchor = new Vector3(midOut.x, midOut.y + 0.024, midOut.z);

  // Hai tấm cánh: trong (t < carpal) và ngoài (t > carpal)
  /** @type {import('../../../model/Part.js').Part[]} */
  const lattices = [];
  /** @type {WingRig['panels']} */
  const panels = [];
  const last = fan.ribCount - 1;
  for (const side of /** @type {(1|-1)[]} */ ([-1, 1])) {
    const inner = side < 0;
    const lat = inner
      ? module.add(ctx.part('membrane', `lattice-in-${tag}`))
      : module.add(ctx.part('membrane', `lattice-out-${tag}`), feather);
    lat.explode(0, 1, 0, 0.25, 0.15);
    const map = inner ? toV : toF;
    const t0 = inner ? 0 : tc + DT;
    const t1 = inner ? tc - DT : 1;
    panels.push({ obj: inner ? module.pivot : feather, t0, t1, map });
    ctx.mesh(lat, membraneGeometry(fan, t0, t1, map, inner ? 8 : 12, 6), 'membrane', { renderOrder: 2 });

    const tubes = [];
    /** @param {P3[]} line @param {number} r */
    const add = (line, r) => tubes.push(tubeThrough(line.map(map), r, { radial: 4 })); // gân 1–2 px: 4 cạnh là đủ
    for (let i = 1; i <= last; i++) add(fan.ribLine(i, t0, t1, inner ? 12 : 18), i === last ? 0.011 : 0.0085);
    add(fan.isoT(inner ? t1 : t0), 0.0085); // mép cắt carpal
    if (!inner) {
      for (let i = 0; i < fan.n; i++) add(fan.marginLine(i), 0.011);
      for (const ct of fan.def.crossT) add(fan.isoT(ct), 0.0058);
      for (let i = 0; i < fan.n; i++) add(fan.subVein(i, 0.5, Math.max(t0, 0.58), 0.985), 0.0048);
    }
    ctx.merge(lat, 'ivory', tubes);

    // Trang trí trên tấm ngoài (theo mẫu "Azure & Gold"): đĩa ở đầu nan, cụm vòng filigree,
    // cụm bánh xích, "mắt" ngọc trai viền vàng tâm azure, ngọc trai ở vài đầu nan.
    if (!inner) {
      const gold = [];
      const pearl = [];
      const azure = [];
      /** Điểm trên nan i (i = n là nan cuối) tại t. @param {number} i @param {number} t */
      const onRib = (i, t) => map(fan.patch(Math.min(i, fan.n - 1), t, i >= fan.n ? 1 : 0));
      /** @param {Vector3} q @param {number} r @param {number} h @param {any[]} list */
      const disc = (q, r, h, list) => {
        const g = new CylinderGeometry(r, r, h, 12);
        g.translate(q.x, q.y, q.z);
        list.push(g);
      };
      /** Vòng nằm trên mặt cánh. @param {Vector3} q @param {number} r @param {number} tube */
      const ring = (q, r, tube) => {
        const g = new TorusGeometry(r, tube, 4, 28);
        g.rotateX(Math.PI / 2);
        g.translate(q.x, q.y + 0.004, q.z);
        gold.push(g);
      };
      for (let i = 1; i <= last; i++) {
        disc(onRib(i, 1), 0.022, 0.01, gold);
        for (const ct of fan.def.crossT) disc(onRib(i, ct), 0.012, 0.012, gold);
      }
      // ngọc trai ở đầu nan 2 và nan cuối (chấm trắng ở mép như ảnh)
      for (const i of [2, last]) {
        const g = new SphereGeometry(0.026, 14, 10);
        const q = onRib(i, 1);
        g.translate(q.x, q.y + 0.014, q.z);
        pearl.push(g);
      }
      // cụm filigree: các vòng vàng lồng nhau quanh một tâm ở giữa quạt
      const mid = Math.floor(fan.n / 2);
      const fc = map(fan.patch(mid, 0.7, 0.35));
      const rings = /** @type {[number, number, number, number][]} */ ([
        [0, 0, 0.085, 0.006], [0, 0, 0.05, 0.005], [0.11, 0.07, 0.055, 0.005],
        [-0.1, 0.09, 0.045, 0.005], [0.06, -0.12, 0.06, 0.005], [-0.08, -0.1, 0.035, 0.004],
      ]);
      for (const [dx, dz, r, tube] of rings) ring(new Vector3(fc.x + dx * s, fc.y, fc.z + dz), r, tube);
      disc(fc, 0.022, 0.02, gold);
      // bánh xích
      for (const sp of fan.def.sprockets) {
        const e = map(fan.patch(Math.min(sp.rib, fan.n - 1), 0.9, sp.rib >= fan.n ? 1 : 0));
        const g1 = gearGeometry({ teeth: sp.teeth, radius: sp.R, thickness: 0.01, spokes: 5 });
        g1.rotateX(-Math.PI / 2);
        g1.translate(e.x, e.y + 0.008, e.z);
        gold.push(g1);
        disc(e, sp.R * 0.28, 0.03, gold);
      }
      // "mắt" ngọc trai: đĩa ngọc + viền vàng + tâm azure
      const eyeAt = fore ? map(fan.patch(1, 0.86, 0.55)) : map(fan.patch(2, 0.72, 0.5));
      const er = fore ? 0.075 : 0.1;
      disc(eyeAt, er, 0.012, pearl);
      ring(eyeAt, er + 0.012, 0.009);
      disc(new Vector3(eyeAt.x, eyeAt.y + 0.004, eyeAt.z), er * 0.38, 0.016, azure);
      ctx.merge(lat, 'brass', gold);
      ctx.merge(lat, 'pearl', pearl);
      ctx.merge(lat, 'azure', azure);
    }

    // Neo nhãn: giữa tấm
    const mid = map(fan.patch(Math.floor(fan.n / 2), (t0 + t1) / 2, 0.5));
    lat.anchor = new Vector3(mid.x, mid.y + 0.01, mid.z);
    lattices.push(lat);
  }

  // Bánh răng đồng trục với chốt: quay CÙNG cánh, không thể va cánh kia
  const zGear = zMid - zs * 0.172;
  const wg = module.add(ctx.part('gears', `wing-gear-${tag}`)).at(0, 0, zGear).explode(0, 1, -zs * 0.3, 0.22, 0.3);
  ctx.mesh(wg, gearGeometry({ teeth: 26, radius: 0.085, thickness: 0.012, spokes: 4 }), 'brass');

  // ── Phía thân (module.group, không quay theo cánh) ─────────────────────────────────────────
  const pin = ctx.part('pivot', `pin-${tag}`);
  module.add(pin, module.group);
  pin.at(0, 0, zMid).explode(0, 0, zs, 0.36, 0.3);
  ctx.mesh(pin, cylZ(0.013, 0.34, 0, 0, 0, 12), 'brass');
  const caps = [];
  for (const k of [-0.175, 0.175]) {
    const c = new CylinderGeometry(0.02, 0.02, 0.01, 6);
    c.rotateX(Math.PI / 2);
    c.translate(0, 0, k);
    caps.push(c);
  }
  ctx.merge(pin, 'azure', caps);
  pin.anchor = new Vector3(0, 0.02, zs * 0.175);

  const hinge = ctx.part('hinge', `hinge-${tag}`);
  module.add(hinge, module.group);
  hinge.explode(0, -1, 0, 0.14, 0.25);
  const hb = [cylZ(0.034, 0.075, 0, 0, zMid + 0.11, 24), cylZ(0.034, 0.075, 0, 0, zMid - 0.11, 24)];
  ctx.merge(hinge, 'brass', hb);
  const ha = [];
  for (const k of [-0.061, 0.061, -0.155, 0.155]) {
    const t = new TorusGeometry(0.035, 0.0055, 6, 24);
    t.translate(0, 0, zMid + k);
    ha.push(t);
  }
  ctx.merge(hinge, 'azure', ha);
  const clevis = [];
  for (const k of [-0.11, 0.11]) {
    const b = new BoxGeometry(0.1, 0.05, 0.02);
    b.translate(s * -0.055, 0, zMid + k);
    clevis.push(b);
  }
  ctx.merge(hinge, 'steel', clevis);
  hinge.anchor = new Vector3(0, 0.036, zMid + zs * 0.11);

  const servo = ctx.part('servo', `servo-${tag}`);
  module.add(servo, module.group);
  servo.at(s * -0.08, 0.17, zMid + zs * 0.1).explode(-s, 0.3, 0, 0.3, 0.2);
  const sb = new Shape();
  const w = 0.04, h = 0.042, r = 0.012;
  sb.moveTo(-w + r, -h); sb.lineTo(w - r, -h); sb.quadraticCurveTo(w, -h, w, -h + r);
  sb.lineTo(w, h - r); sb.quadraticCurveTo(w, h, w - r, h); sb.lineTo(-w + r, h);
  sb.quadraticCurveTo(-w, h, -w, h - r); sb.lineTo(-w, -h + r); sb.quadraticCurveTo(-w, -h, -w + r, -h);
  const body = new ExtrudeGeometry(sb, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 });
  body.translate(0, 0, -0.065);
  ctx.mesh(servo, body, 'steel');
  ctx.mesh(servo, cylZ(0.03, 0.05, 0, 0, zs * 0.085, 20), 'copper');
  const top = new BoxGeometry(0.058, 0.004, 0.09);
  top.translate(0, 0.047, 0);
  ctx.merge(servo, 'brass', [top]);
  const sbolt = [cylZ(0.009, 0.04, 0, 0.035, -zs * 0.085, 10)];
  for (const [bx, bz] of [[-0.02, -0.035], [0.02, -0.035], [-0.02, 0.035], [0.02, 0.035]]) {
    const b = new CylinderGeometry(0.006, 0.006, 0.006, 6);
    b.translate(bx, 0.051, bz);
    sbolt.push(b);
  }
  ctx.merge(servo, 'azure', sbolt);
  servo.anchor = new Vector3(0, 0.052, 0);

  const pinion = ctx.part('gears', `pinion-${tag}`);
  module.add(pinion, module.group);
  pinion.at(s * -0.111, 0, zGear).explode(-s, 0.4, 0, 0.26, 0.3);
  ctx.mesh(pinion, gearGeometry({ teeth: 11, radius: 0.036, thickness: 0.012, spokes: 0 }), 'brass');
  ctx.mesh(pinion, cylZ(0.007, 0.05, 0, 0, 0, 8), 'azure');
  pinion.userData.phase = Math.PI / 11;
  pinion.pivot.rotation.z = pinion.userData.phase;

  // ── Torsion linkage: tay đòn servo + thanh truyền CHIỀU DÀI CỐ ĐỊNH ─────────────────────────
  const link = ctx.part('linkage', `linkage-${tag}`);
  module.add(link, module.group);
  const O = new Vector3(s * -0.08, 0.205, zMid);
  const a = 0.075;
  const Lr = O.distanceTo(L0);
  const hornGeo = new BoxGeometry(a, 0.016, 0.01);
  hornGeo.translate(a / 2, 0, 0);
  const horn = ctx.mesh(link, hornGeo, 'brass');
  const pinCap = new SphereGeometry(0.011, 8, 6);
  pinCap.translate(a, 0, 0);
  ctx.mesh(link, pinCap, 'azure', { parent: horn });
  const rod = ctx.mesh(link, new CylinderGeometry(0.0075, 0.0075, Lr, 8), 'silver');
  link.anchor = O.clone();

  return {
    module, s, which, zMid, zs, feather, fAxis, pinion, servo, fan, lattices, panels,
    link: { part: link, horn, rod, O, L0, a, Lr },
  };
}

/**
 * Điểm mẫu trên màng (lưới t × w mỗi múi) trong hệ toạ độ tấm — cho test quét va chạm.
 * @param {WingRig} w @param {number} nt @param {number} nw
 * @returns {{obj: Group, p: Vector3}[]}
 */
export function membraneSamples(w, nt = 20, nw = 10) {
  /** @type {{obj: Group, p: Vector3}[]} */
  const out = [];
  for (const pn of w.panels)
    for (let i = 0; i < w.fan.n; i++)
      for (let a = 0; a <= nt; a++)
        for (let b = 0; b <= nw; b++)
          out.push({ obj: pn.obj, p: pn.map(w.fan.patch(i, pn.t0 + ((pn.t1 - pn.t0) * a) / nt, b / nw)) });
  return out;
}

const _O = new Vector3();
const _L = new Vector3();
const _P = new Vector3();
const _D = new Vector3();
const _q = new Quaternion();

/**
 * Giải linkage cho góc cánh hiện tại (và vị trí servo sau explode). 0 cấp phát.
 * @param {WingRig} w
 */
export function updateLinkage(w) {
  const { horn, rod, O, L0, a, Lr, part } = w.link;
  _O.copy(O).add(w.servo.group.position).sub(w.servo.home);
  _L.copy(L0).applyQuaternion(w.module.pivot.quaternion);
  const dx = _L.x - _O.x;
  const dy = _L.y - _O.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / dist;
  const uy = dy / dist;
  if (dist > a + Lr - 1e-5 || dist < Math.abs(a - Lr) + 1e-5) {
    _P.set(_O.x + ux * a, _O.y + uy * a, _O.z);
  } else {
    const along = (a * a - Lr * Lr + dist * dist) / (2 * dist);
    const hh = Math.sqrt(Math.max(0, a * a - along * along));
    const bx = _O.x + ux * along;
    const by = _O.y + uy * along;
    const p1y = by + hh * ux;
    const p2y = by - hh * ux;
    if (p1y >= p2y) _P.set(bx - hh * uy, p1y, _O.z);
    else _P.set(bx + hh * uy, p2y, _O.z);
  }
  horn.position.copy(_O);
  horn.rotation.set(0, 0, Math.atan2(_P.y - _O.y, _P.x - _O.x));
  _D.subVectors(_L, _P);
  _D.z = 0;
  if (_D.lengthSq() < 1e-10) _D.set(1, 0, 0);
  _D.normalize();
  rod.position.copy(_P).addScaledVector(_D, Lr / 2);
  rod.quaternion.copy(_q.setFromUnitVectors(Y, _D));
  if (part.anchor) part.anchor.copy(_O);
}
