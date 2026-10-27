// @ts-check
// Test riêng của husky (plan đợt 3 §6–§7): kích thước theo GaitSpec, khớp/bind pose, registry, explode
// với chính sách sàn, ngân sách. Chạy trong selftest (tests/selftest.js gọi runHuskySuite).
import { Vector3, Box3 } from 'three';
import { GROUND_Y } from '../src/core/stage.js';
import { BODY, H, GAIT } from '../src/specimens/husky/spec.js';
import { footAnalytic, foot, frac } from '../src/motion/gait.js';
import { REACH_EPS } from '../src/motion/ik.js';
import { frames } from './harness.js';

const _v = new Vector3();
const DEG = 180 / Math.PI;

/**
 * @typedef {{
 *   report: (ok: boolean|null, name: string, detail?: any) => void,
 *   guard: (name: string, fn: () => any) => Promise<void>,
 * }} T
 */

/**
 * Điểm thấp nhất (y thế giới) của mọi mesh thường trong model. Bỏ BatchedMesh: lô vẽ chỉ là bản sao để vẽ,
 * geometry của nó ở toạ độ riêng từng phần tử — hình học LOGIC là mesh gốc (cùng dữ liệu, đúng ma trận).
 * @param {any} m
 */
export function lowestY(m) {
  m.root.updateMatrixWorld(true);
  let lo = Infinity;
  m.root.traverse((/** @type {any} */ o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isBatchedMesh || !o.geometry || !o.visible) return;
    if (o === m.traces) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y;
      if (y < lo) lo = y;
    }
  });
  return lo;
}

/** @param {T} t @param {any} am app đang xem husky */
export async function huskyModelTests(t, am) {
  const { report, guard } = t;
  const m = am.model;
  const d = am.def;

  await guard('Husky: kích thước §6', () => {
    const dim = m.measure();
    /** @type {[string, number, number, number][]} */
    const rows = [
      ['vai (withers)', dim.withers, BODY.withers, 0.05],
      ['lưng', dim.back, BODY.back, 0.1],
      ['đáy ngực', dim.chestBottom, BODY.chestBottom, 0.05],
      ['đỉnh tai', dim.earTop, BODY.earTop, 0.05],
      ['đỉnh đầu', dim.headTop, BODY.headTop, 0.05],
      ['mũi — cao', dim.nose.h, BODY.nose.h, 0.1],
      ['mũi — z', dim.nose.z, BODY.nose.z, 0.05],
      ['đỉnh đuôi — cao', dim.tailTip.h, BODY.tailTip.h, 0.05],
      ['đỉnh đuôi — z', dim.tailTip.z, BODY.tailTip.z, 0.1],
      ['bề ngang thân', dim.width, BODY.width, 0.03],
      ['điểm thấp nhất', dim.lowest, 0, 0.01],
    ];
    const bad = rows.filter(([, v, want, tol]) => !(Math.abs(v - want) <= tol));
    report(bad.length === 0, 'Husky: kích thước bind pose khớp GaitSpec (cao tính từ sàn)',
      (bad.length ? bad : rows).map(([n, v, want]) => `${n} ${v.toFixed(3)}/${want}`).join(' · '));
  });

  await guard('Husky: khớp & bind', () => {
    m.root.updateMatrixWorld(true);
    let rootErr = 0, ankleErr = 0, soleErr = 0, levelErr = 0;
    /** @type {string[]} */
    const inner = [];
    for (const L of m.data.legs) {
      const sp = L.spec;
      const want = new Vector3(sp.side * sp.x, H(sp.rootH), sp.rootZ);
      rootErr = Math.max(rootErr, L.actuator.group.getWorldPosition(new Vector3()).distanceTo(want));
      // Cổ chân (gốc của part bàn chân) thẳng dưới khớp gốc, cao ankle[0] trên sàn
      const ankle = L.paw.group.getWorldPosition(new Vector3());
      ankleErr = Math.max(ankleErr, ankle.distanceTo(new Vector3(want.x, H(sp.ankle[0]), sp.rootZ)));
      // Điểm đế: (0, −ankle[0], −ankle[1]) trong hệ bàn chân → nằm trên sàn
      const sole = new Vector3(0, -sp.ankle[0], -sp.ankle[1]).applyMatrix4(L.paw.pivot.matrixWorld);
      soleErr = Math.max(soleErr, Math.abs(sole.y - GROUND_Y));
      // Đế song song sàn: trục Y của bàn chân trùng phương đứng
      const up = new Vector3(0, 1, 0).transformDirection(L.paw.pivot.matrixWorld);
      levelErr = Math.max(levelErr, Math.acos(Math.min(1, up.y)) * DEG);
      inner.push(`${sp.id} ${(Math.PI - Math.abs(L.bind.psi2 - L.bind.psi1)) * DEG | 0}°`);
    }
    report(rootErr < 1e-6 && ankleErr < 1e-5, 'Husky: khớp vai/hông đúng GaitSpec; cổ chân trung tính thẳng dưới khớp gốc',
      `gốc lệch ${rootErr.toExponential(1)} · cổ chân lệch ${ankleErr.toExponential(1)}`);
    report(soleErr < 1e-5 && levelErr < 1e-4, 'Husky: bind pose — đế đúng sàn, song song sàn',
      `đế lệch ${soleErr.toExponential(1)} · nghiêng ${levelErr.toExponential(1)}°`);
    const f = m.data.legs.find((/** @type {any} */ l) => l.spec.front);
    const h = m.data.legs.find((/** @type {any} */ l) => !l.spec.front);
    const fi = (Math.PI - Math.abs(f.bind.psi2 - f.bind.psi1)) * DEG;
    const hi = (Math.PI - Math.abs(h.bind.psi2 - h.bind.psi1)) * DEG;
    const elbowBack = f.lower.group.getWorldPosition(new Vector3()).z < f.actuator.group.getWorldPosition(new Vector3()).z;
    const kneeFwd = h.lower.group.getWorldPosition(new Vector3()).z > h.actuator.group.getWorldPosition(new Vector3()).z;
    report(Math.abs(fi - 134.0) < 0.5 && Math.abs(hi - 110.5) < 0.5 && elbowBack && kneeFwd,
      'Husky: góc trong ở bind — khuỷu ≈ 134° ra sau, gối ≈ 110.5° ra trước', inner.join(' · '));
  });

  await guard('Husky: registry §7', () => {
    const names = new Set(m.parts.map((/** @type {any} */ p) => p.name));
    const conv = m.parts.every((/** @type {any} */ p) => p.name === p.kind || p.name.startsWith(p.kind + '.'));
    let unmapped = 0;
    for (const mesh of m.pickables) {
      const p = mesh.userData.part;
      if (!p || d.catalog.filter((/** @type {any} */ c) => c.id === p.kind).length !== 1) unmapped++;
    }
    const withAnchor = d.catalog.filter((/** @type {any} */ c) => c.annotate && m.reps[c.id] && m.reps[c.id].anchor).length;
    report(names.size === m.parts.length && unmapped === 0 && withAnchor === 16 && conv,
      'Husky: instanceId duy nhất theo quy ước kind.vị-trí · mọi mesh → 1 mục catalog · đủ 16 neo nhãn',
      `${m.parts.length} part · ${m.pickables.length} mesh · ${unmapped} không ánh xạ · neo ${withAnchor}/16`);
    const lbl = ['paw.fl', 'thigh.hr', 'tail.3', 'shoulder.l'].map((n) => d.instanceLabel(n));
    report(lbl[0] === 'Front-left paw' && lbl[1] === 'Hind-right thigh' && lbl[2] === 'Link 4 of 7' && lbl[3] === 'Left shoulder',
      'Husky: inspector ghi rõ instance được bấm', lbl.join(' · '));
  });

  await guard('Husky: ngân sách', () => {
    frames(am, 2);
    const info = am.view.renderer.info;
    /** @type {Set<any>} */
    const geos = new Set();
    let tris = 0;
    const layers = am.view.camera.layers;
    m.root.traverse((/** @type {any} */ o) => {
      if (!o.geometry) return;
      geos.add(o.geometry);
      // Tam giác ĐƯỢC VẼ: mesh gốc của model vẽ theo lô nằm ở layer 1 (lô vẽ thay) → không đếm hai lần
      if (o.isMesh && o.layers.test(layers)) {
        const g = o.geometry;
        const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
        tris += o.isInstancedMesh ? n * o.count : n;
      }
    });
    report(info.render.calls < 200 && tris < 250000 && geos.size <= 300,
      'Husky: < 200 draw call (cả cảnh) · < 250k tam giác · ≤ 300 geometry',
      `${info.render.calls} draw call · ${tris | 0} tam giác · ${geos.size} geometry`);
  });

  await guard('Husky: explode', () => {
    let err0 = 0, err1 = 0, mono = 0, lo = Infinity;
    m.applyExplode(0);
    for (const p of m.parts) err0 = Math.max(err0, p.group.position.distanceTo(p.home));
    m.applyExplode(1);
    const want = new Vector3();
    for (const p of m.parts) {
      want.copy(p.home).addScaledVector(p.dir, p.dist);
      err1 = Math.max(err1, p.group.position.distanceTo(want));
    }
    const prev = new Map();
    for (let i = 0; i <= 20; i++) {
      const e = i / 20;
      m.applyExplode(e);
      for (const p of m.parts) {
        const dd = p.group.position.distanceTo(p.home);
        if (prev.has(p) && dd < prev.get(p) - 1e-9) mono++;
        prev.set(p, dd);
      }
      if (i % 2 === 0) lo = Math.min(lo, lowestY(m));
    }
    m.applyExplode(am.explode.value);
    report(err0 < 1e-6 && err1 < 1e-6 && mono === 0, 'Husky: explode thuần theo e — đúng home/đích, đơn điệu',
      `sai số ${Math.max(err0, err1).toExponential(1)} · ${mono} lần giảm`);
    report(lo >= GROUND_Y - 0.01, 'Husky: chính sách sàn — không part nào thấp hơn GROUND_Y ở mọi mức nổ (11 mức)',
      `điểm thấp nhất ${(lo - GROUND_Y).toFixed(4)} so với sàn`);
  });

  await guard('Husky: không cấp phát khi nổ', () => {
    am.store.actions.setExplode(0);
    am.explode.snap(0);
    frames(am, 6);
    /** @type {[any, any, any[]][]} */
    const snap = [];
    m.root.traverse((/** @type {any} */ o) => {
      if (o.geometry) snap.push([o, o.geometry, Object.values(o.geometry.attributes).map((a) => /** @type {any} */ (a).array)]);
    });
    const mem = am.view.renderer.info.memory.geometries;
    am.store.actions.setExplode(1);
    frames(am, 120);
    let changed = 0;
    for (const [o, g, arrays] of snap) {
      if (o.geometry !== g) changed++;
      else Object.values(g.attributes).forEach((a, i) => { if (/** @type {any} */ (a).array !== arrays[i]) changed++; });
    }
    report(changed === 0 && am.view.renderer.info.memory.geometries === mem, 'Husky: 0 cấp phát geometry trong 120 khung explode',
      `${snap.length} geometry theo dõi · ${changed} đổi`);
    am.store.actions.setExplode(0);
    am.explode.snap(0);
    frames(am, 6);
  });
}

// ── P4: TROT (plan đợt 3 §6) ─────────────────────────────────────────────────────────────────────

/** Khoảng cách nhỏ nhất giữa hai đoạn thẳng p1q1, p2q2 (Ericson, Real-Time Collision Detection 5.1.9). */
function segSeg(/** @type {Vector3} */ p1, /** @type {Vector3} */ q1, /** @type {Vector3} */ p2, /** @type {Vector3} */ q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
  if (a <= 1e-12) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

/** Khoảng cách từ đoạn thẳng tới hộp (lấy mẫu 24 điểm — sai số ≤ nửa bước, nhỏ hơn biên an toàn). */
function segBox(/** @type {Vector3} */ a, /** @type {Vector3} */ b, /** @type {Box3} */ box) {
  let best = Infinity;
  const p = new Vector3();
  for (let i = 0; i <= 24; i++) best = Math.min(best, box.distanceToPoint(p.lerpVectors(a, b, i / 24)));
  return best;
}

/** Ảnh chụp mọi ma trận part (để so tất định / về bind). @param {any} m */
function snapMatrices(m) {
  m.root.updateMatrixWorld(true);
  return m.parts.map((/** @type {any} */ p) => p.pivot.matrixWorld.elements.slice());
}
/** @param {number[][]} A @param {number[][]} B */
function maxDiff(A, B) {
  let d = 0;
  for (let i = 0; i < A.length; i++) for (let k = 0; k < 16; k++) d = Math.max(d, Math.abs(A[i][k] - B[i][k]));
  return d;
}

/** @param {T} t @param {any} am app đang xem husky (explode = 0, không chuyển động) */
export async function huskyGaitTests(t, am) {
  const { report, guard } = t;
  const m = am.model;
  const rig = am.rig;
  const G = GAIT;
  const legs = m.data.legs;
  const W = (/** @type {any} */ o) => o.getWorldPosition(new Vector3());
  rig.onDeactivate();
  const bind = snapMatrices(m);

  await guard('TROT: động học 720 pha', () => {
    let fk = 0, clamped = 0, flips = 0, nan = 0, limit = 0, soleY = 0, level = 0, pisOut = 0;
    const dRange = legs.map(() => [Infinity, -Infinity]);
    const poleSign = legs.map(() => 0);
    const F = foot();
    /** @type {string[]} */
    const why = [];
    for (let k = 0; k < 720; k++) {
      const phi = k / 720;
      rig.pose(phi, 1);
      m.root.updateMatrixWorld(true);
      legs.forEach((/** @type {any} */ L, i) => {
        const sp = L.spec;
        footAnalytic(frac(phi + sp.phase), 1, G, F);
        const R = W(L.actuator.group), M = W(L.lower.group), A = W(L.paw.group);
        const want = new Vector3(R.x, GROUND_Y + sp.ankle[0] + F.y, L.actuator.group.position.z + F.z);
        fk = Math.max(fk, A.distanceTo(want));
        const J = rig.joints[i];
        if (J.clamped) clamped++;
        for (const p of [L.upper, L.lower, L.paw]) if (!Number.isFinite(p.pivot.rotation.x)) nan++;
        // phía của khớp giữa so với đường gốc→cổ chân (dấu nhánh)
        const cross = (A.z - R.z) * (M.y - R.y) - (A.y - R.y) * (M.z - R.z);
        const sg = Math.sign(cross);
        if (poleSign[i] === 0) poleSign[i] = sg;
        else if (sg !== poleSign[i]) flips++;
        const rootRel = (J.root - L.bind.psi1) * DEG;
        const inner = J.inner * DEG;
        const [lo, hi] = sp.limits.inner;
        if (rootRel < sp.limits.root[0] || rootRel > sp.limits.root[1] || inner < lo || inner > hi) {
          limit++;
          if (why.length < 3) why.push(`${sp.id}@${phi.toFixed(3)} gốc ${rootRel.toFixed(1)}° trong ${inner.toFixed(1)}°`);
        }
        const d = R.distanceTo(A);
        dRange[i][0] = Math.min(dRange[i][0], d);
        dRange[i][1] = Math.max(dRange[i][1], d);
        if (!F.swing) {
          const sole = new Vector3(0, -sp.ankle[0], -sp.ankle[1]).applyMatrix4(L.paw.pivot.matrixWorld);
          soleY = Math.max(soleY, Math.abs(sole.y - GROUND_Y));
          const up = new Vector3(0, 1, 0).transformDirection(L.paw.pivot.matrixWorld);
          level = Math.max(level, Math.acos(Math.min(1, up.y)) * DEG);
        }
        const P = L.piston;
        if (P.span < P.min || P.span > P.max) pisOut++;
      });
    }
    report(fk <= 1e-4 && clamped === 0 && flips === 0 && nan === 0, 'TROT: FK tới cổ chân ≤ 1e-4 · IK không kẹp · dấu nhánh không đổi · không NaN (720 pha × 4 chân)',
      `FK lệch ${fk.toExponential(1)} · kẹp ${clamped} · đổi nhánh ${flips} · NaN ${nan}`);
    report(limit === 0, 'TROT: góc khớp trong giới hạn (gốc ±40° quanh bind; khuỷu 95–175°, gối 80–165°)', limit ? why.join(' | ') : '0 vi phạm');
    const fr = legs.map((/** @type {any} */ L, i) => `${L.spec.id} ${dRange[i][0].toFixed(2)}–${dRange[i][1].toFixed(2)}`);
    const reach = legs.every((/** @type {any} */ L, i) => dRange[i][0] >= Math.abs(L.spec.L1 - L.spec.L2) + REACH_EPS && dRange[i][1] <= L.spec.L1 + L.spec.L2 - REACH_EPS);
    report(reach, 'TROT: khoảng cách gốc–cổ chân luôn trong không gian làm việc [|L1−L2|+ε, L1+L2−ε]', fr.join(' · '));
    report(soleY <= 0.01 && level <= 1, 'TROT: stance — đế ở GROUND_Y ± 0.01, pháp tuyến đế lệch phương đứng ≤ 1°',
      `đế lệch ${soleY.toExponential(1)} · nghiêng ${level.toFixed(4)}°`);
    const P0 = legs.map((/** @type {any} */ L) => `${L.spec.id} [${L.piston.min.toFixed(2)}, ${L.piston.max.toFixed(2)}]`);
    report(pisOut === 0, 'TROT: hành trình piston trong [min, max] ở mọi pha', pisOut ? `${pisOut} lần ra ngoài` : P0.join(' · '));
  });

  await guard('TROT: sàn + va chạm', () => {
    let lo = Infinity;
    let minLimb = Infinity, minBody = Infinity, minPaw = Infinity, minTail = Infinity, jawBad = 0;
    // Hộp thân cho va chạm: lõi khung ngực (bên trong vỏ) — chi dưới, bàn chân, đuôi không được lọt vào
    const torso = new Box3(new Vector3(-0.45, H(2.5), -2.45), new Vector3(0.45, H(5.1), 2.4));
    const radius = { upperF: 0.19, lowerF: 0.15, upperH: 0.25, lowerH: 0.16, paw: 0.2 };
    const jaw = m.data.head.jaw;
    for (let k = 0; k < 48; k++) {
      const phi = k / 48;
      rig.pose(phi, 1);
      m.root.updateMatrixWorld(true);
      lo = Math.min(lo, lowestY(m));
      /** @type {{leg: number, a: Vector3, b: Vector3, r: number, kind: string}[]} */
      const caps = [];
      legs.forEach((/** @type {any} */ L, i) => {
        const R = W(L.actuator.group), M = W(L.lower.group), A = W(L.paw.group);
        const toe = new Vector3(0, -L.spec.ankle[0] + 0.1, 0.3 - L.spec.ankle[1]).applyMatrix4(L.paw.pivot.matrixWorld);
        caps.push({ leg: i, a: R, b: M, r: L.spec.front ? radius.upperF : radius.upperH, kind: 'upper' });
        caps.push({ leg: i, a: M, b: A, r: L.spec.front ? radius.lowerF : radius.lowerH, kind: 'lower' });
        caps.push({ leg: i, a: A, b: toe, r: radius.paw, kind: 'paw' });
      });
      for (let a = 0; a < caps.length; a++)
        for (let b = a + 1; b < caps.length; b++) {
          if (caps[a].leg === caps[b].leg) continue;
          const d = segSeg(caps[a].a, caps[a].b, caps[b].a, caps[b].b) - caps[a].r - caps[b].r;
          if (caps[a].kind === 'paw' && caps[b].kind === 'paw') minPaw = Math.min(minPaw, d);
          else minLimb = Math.min(minLimb, d);
        }
      for (const c of caps) if (c.kind !== 'upper') minBody = Math.min(minBody, segBox(c.a, c.b, torso) - c.r);
      // Đuôi (trừ khâu gốc gắn vào mông) không lọt vào thân
      const tl = m.data.tail;
      for (let i = 1; i < tl.length; i++) {
        const a = W(tl[i].group);
        const b = i + 1 < tl.length ? W(tl[i + 1].group) : new Vector3(0, 0, 0).applyMatrix4(tl[i].pivot.matrixWorld);
        minTail = Math.min(minTail, segBox(a, b, torso) - 0.15);
      }
      // Hàm chỉ mở XUỐNG trong giới hạn → không lấn lên mõm trên
      const jr = jaw.pivot.rotation.x;
      if (jr < -1e-9 || jr > m.data.jawMax + 1e-9) jawBad++;
    }
    report(lo >= GROUND_Y - 0.01, 'TROT: không hình học nào thấp hơn sàn quá 0.01 (48 pha, mọi mesh)', `thấp nhất ${(lo - GROUND_Y).toFixed(4)} so với sàn`);
    report(minLimb > 0 && minPaw > 0, 'TROT: va chạm chi–chi và bàn–bàn (capsule) — luôn tách nhau', `khe chi nhỏ nhất ${minLimb.toFixed(3)} · khe bàn chân ${minPaw.toFixed(3)}`);
    report(minBody > 0 && minTail > 0, 'TROT: chi dưới/bàn chân và đuôi không lọt vào khối thân (OBB)', `khe chi–thân ${minBody.toFixed(3)} · đuôi–thân ${minTail.toFixed(3)}`);
    report(jawBad === 0, 'TROT: hàm chỉ mở xuống trong [0, JAW_MAX] → không chạm mõm trên', `${jawBad} vi phạm`);
  });

  await guard('TROT: planner ≡ giải tích, pha, trượt đế', () => {
    rig.onDeactivate();
    for (const [label, dts] of /** @type {[string, () => number][]} */ ([
      ['1/60', () => 1 / 60], ['1/30', () => 1 / 30], ['1/144', () => 1 / 144], ['ngẫu nhiên', () => 1 / 144 + Math.random() * (1 / 30 - 1 / 144)],
    ])) {
      rig.onDeactivate();
      let expect = 0, T = 0, slip = 0;
      /** @type {(number|null)[]} */
      const anchor = legs.map(() => null);
      while (T < 3.4) {
        const dt = dts();
        const moving = rig.update(dt, true, 0);
        if (moving) expect += G.cycleHz * dt;
        T += dt;
        // Trượt đế trong stance: z đế (W) + quãng băng chuyền phải không đổi suốt một stance
        if (T > 1.2) {
          m.root.updateMatrixWorld(true);
          legs.forEach((/** @type {any} */ L, i) => {
            const PL = rig.planner.legs[i];
            if (!PL.stance) { anchor[i] = null; return; }
            const sole = new Vector3(0, -L.spec.ankle[0], -L.spec.ankle[1]).applyMatrix4(L.paw.pivot.matrixWorld);
            const g = sole.z + rig.belt;
            if (anchor[i] === null) anchor[i] = g;
            else slip = Math.max(slip, Math.abs(g - /** @type {number} */ (anchor[i])));
          });
        }
      }
      // Sau ramp 1 s + > 2 chu kỳ: planner trùng lời giải giải tích
      let dev = 0;
      const F = foot();
      legs.forEach((/** @type {any} */ L, i) => {
        footAnalytic(frac(rig.phase + L.spec.phase), rig.ampE, G, F);
        const PL = rig.planner.legs[i];
        dev = Math.max(dev, Math.abs(PL.z - F.z), Math.abs(PL.y - F.y));
      });
      const phaseErr = Math.abs(rig.cycles - expect);
      report(dev <= 1e-4 && phaseErr <= 1e-9 && slip <= 0.01 && rig.ampE === 1,
        `TROT (dt ${label}): planner ≡ giải tích sau 2 chu kỳ · pha = ∫f·dt · đế không trượt trên băng chuyền`,
        `lệch planner ${dev.toExponential(1)} · lệch pha ${phaseErr.toExponential(1)} · trượt ${slip.toExponential(1)}`);
    }
    rig.onDeactivate();
  });

  await guard('TROT: dừng & tất định', () => {
    // Dừng từ nước kiệu đầy đủ → về ĐÚNG bind (không trượt chân, đặt lại theo cặp chéo)
    rig.onDeactivate();
    for (let i = 0; i < 150; i++) rig.update(1 / 60, true, 0);
    let n = 0;
    while (rig.update(1 / 60, false, 0) && n < 400) n++;
    const stopErr = maxDiff(snapMatrices(m), bind);
    report(stopErr <= 1e-4 && n < 120, 'TROT: STOP → về đúng bind pose (≤ 1e-4), < 2 s', `lệch ${stopErr.toExponential(1)} · ${n} khung (${(n / 60).toFixed(2)} s)`);

    // 10.000 update ngẫu nhiên (bật/tắt, dt lộn xộn) rồi dừng → bind
    let want = true;
    for (let i = 0; i < 10000; i++) {
      if (Math.random() < 0.004) want = !want;
      rig.update(1 / 144 + Math.random() * (1 / 30 - 1 / 144), want, 0);
    }
    n = 0;
    while (rig.update(1 / 60, false, 0) && n < 600) n++;
    rig.secondary(0, 0);
    const randErr = maxDiff(snapMatrices(m), bind);
    report(randErr <= 1e-4, 'TROT: 10.000 update ngẫu nhiên rồi dừng → trùng bind pose ≤ 1e-4', `lệch ${randErr.toExponential(1)} · dừng sau ${n} khung`);

    // Cùng (pha, biên độ) → cùng ma trận, bất kể lịch sử
    rig.onDeactivate();
    for (let i = 0; i < 97; i++) rig.update(1 / 60, true, 0);
    rig.pose(0.3719, 0.8);
    const A = snapMatrices(m);
    rig.onDeactivate();
    for (let i = 0; i < 313; i++) rig.update(1 / 45, i % 50 < 30, 0);
    rig.pose(0.3719, 0.8);
    const B = snapMatrices(m);
    report(maxDiff(A, B) === 0, 'TROT: cùng (pha, biên độ) → cùng ma trận, không phụ thuộc lịch sử', `lệch ${maxDiff(A, B).toExponential(1)}`);
    rig.onDeactivate();
  });

  await guard('TROT: luật store', () => {
    const a = am.store.actions;
    const st = () => am.store.state;
    am.store.actions.setExplode(1);
    am.explode.snap(1);
    frames(am, 4);
    a.startMotion();
    let early = false;
    for (let i = 0; i < 100; i++) {
      frames(am, 1);
      if (am.explode.value >= 0.05 && rig.ampE > 0) early = true;
    }
    report(st().explodeTarget === 0 && !early && rig.ampE > 0, 'TROT: đang nổ + Trot → lắp lại trước, chỉ chạy khi e < 0.05', `ampE ${rig.ampE.toFixed(2)}`);
    a.setExplode(0.5);
    report(st().mode === 'inspection', 'TROT: đang chạy mà nổ → dừng trước', st().mode);
    a.setExplode(0);
    am.explode.snap(0);
    let n = 0;
    while ((rig.ampE > 0 || rig.settle) && n < 300) { frames(am, 1); n++; }
    rig.onDeactivate();
    frames(am, 3);
  });
}
