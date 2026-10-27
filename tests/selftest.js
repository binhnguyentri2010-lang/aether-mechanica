// @ts-check
// Selftest (plan §21). App chạy trong iframe có KÍCH THƯỚC CỐ ĐỊNH (iframe quyết định viewport và
// media query bên trong). Gọi thẳng __am.renderOnce() thay vì chờ rAF: khung trình duyệt tích hợp
// bị ẩn thì rAF đứng im.
import { Vector3, Box3, Spherical, Matrix4 } from 'three';
import { Scheduler } from '../src/core/scheduler.js';
import { createStore } from '../src/core/store.js';
import { MechanicalModel } from '../src/model/MechanicalModel.js';
import { MaterialState } from '../src/model/materialState.js';
import { createMaterialLibrary, PALETTES } from '../src/model/materials.js';
import { STROKE_DEG, RATE_HZ } from '../src/motion/FlightRig.js';
import { membraneSamples } from '../src/specimens/ornithopter/assemblies/wing.js';
import { REGISTRY, SPECIMEN_IDS } from '../src/specimens/index.js';
import { angleDelta } from '../src/core/easing.js';
import { sleep, loadApp as loadAppIn, frames, setView, setExplodeNow, compareGoldens } from './harness.js';
import { huskyModelTests, huskyGaitTests } from './husky.js';
import { switchTests } from './switch.js';
import { touchTests } from './touch.js';

const out = /** @type {HTMLTableElement} */ (document.getElementById('out'));
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
/** @type {{ok: boolean|null, name: string, detail: string}[]} */
const results = [];

/** @param {boolean|null} ok @param {string} name @param {any} [detail] */
function report(ok, name, detail = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ ok, name, detail: d });
  const tr = out.insertRow();
  const a = tr.insertCell();
  a.textContent = ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL';
  a.className = ok === null ? 'info' : ok ? 'pass' : 'fail';
  tr.insertCell().textContent = name;
  tr.insertCell().textContent = d;
}

/**
 * Quy trình nạp app dùng chung với golden (tests/harness.js): chờ font, DPR ép 1. Test thường chạy
 * CÓ MSAA như production ở DPR 1; chỉ golden/A/B tắt MSAA (GOLDEN_QUERY) để so được từng byte.
 * @param {number} w @param {number} h
 */
const loadApp = (w, h, extra = '') => loadAppIn(stage, w, h, 'still&theme=azure&dpr=1' + extra);

/** Hình chiếu model (điểm mẫu) trên màn hình. @param {any} am @param {number} e */
function modelBox(am, e) {
  const m = am.model;
  const cam = am.view.camera;
  const L = am.layout;
  const v = new Vector3();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const s0 = m.samples0, s1 = m.samples1;
  for (let i = 0; i < s0.length; i += 3) {
    v.set(s0[i] + (s1[i] - s0[i]) * e, s0[i + 1] + (s1[i + 1] - s0[i + 1]) * e, s0[i + 2] + (s1[i + 2] - s0[i + 2]) * e);
    v.applyMatrix4(m.root.matrixWorld).project(cam);
    const x = ((v.x + 1) / 2) * L.W;
    const y = ((1 - v.y) / 2) * L.H;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}

/** @param {DOMRect[]} rects */
function hudOverlaps(rects) {
  let n = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) n++;
    }
  return n;
}

async function guard(/** @type {string} */ name, /** @type {() => Promise<void>|void} */ fn) {
  try {
    await fn();
  } catch (e) {
    report(false, name, String((/** @type {any} */ (e)).stack || e).slice(0, 400));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function run() {
  const t0 = performance.now();
  const { f, am, win } = await loadApp(1440, 900);
  const m = am.model;

  await guard('Model', () => {
    report(m.pickables.length >= 40, 'Model: ≥ 40 mesh', m.pickables.length + ' mesh, ' + m.parts.length + ' part');
    report(Object.keys(m.reps).length === 16, 'Model: 16 bộ phận có annotation', Object.keys(m.reps).join(' '));
    const span = m.measure().wingspanCm;
    report(Math.abs(span - 62) <= 1, 'Model: sải cánh 62 ± 1 cm (đo từ hình học)', span.toFixed(2) + ' cm');
  });

  await guard('Registry', () => registryTests(am));
  await guard('Vẽ theo lô', () => batchTests(am));
  await guard('Pick bằng BVH', () => pickTests(am));

  await guard('Explode', () => {
    let err0 = 0, err1 = 0, mono = 0;
    m.applyExplode(0);
    for (const p of m.parts) {
      err0 = Math.max(err0, p.group.position.distanceTo(p.home), p.rotTarget ? p.group.quaternion.angleTo(p.homeQuat) : 0);
    }
    m.applyExplode(1);
    const want = new Vector3();
    for (const p of m.parts) {
      want.copy(p.home).addScaledVector(p.dir, p.dist);
      err1 = Math.max(err1, p.group.position.distanceTo(want));
    }
    const prev = new Map();
    for (let e = 0; e <= 1.0001; e += 0.05) {
      m.applyExplode(Math.min(1, e));
      for (const p of m.parts) {
        const d = p.group.position.distanceTo(p.home);
        if (prev.has(p) && d < prev.get(p) - 1e-9) mono++;
        prev.set(p, d);
      }
    }
    m.applyExplode(am.explode.value);
    report(err0 < 1e-6, 'Explode: applyExplode(0) → mọi part đúng home', 'sai số lớn nhất ' + err0.toExponential(2));
    report(err1 < 1e-6, 'Explode: applyExplode(1) → đúng home + hướng × khoảng', 'sai số lớn nhất ' + err1.toExponential(2));
    report(mono === 0, 'Explode: khoảng dịch đơn điệu theo e', mono + ' lần giảm');
  });

  await guard('Hiệu năng', () => {
    frames(am, 2);
    const info = am.view.renderer.info.render;
    report(info.calls < 250, 'Hiệu năng: < 250 draw call', info.calls);
    report(info.triangles < 400000, 'Hiệu năng: < 400k tam giác', info.triangles);

    // Thời gian CPU mỗi khung khi xoay camera (gồm bố trí nhãn + che khuất) và khi hover.
    const gl = am.view.renderer.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const c = am.cam.controls;
    const axis = new Vector3(0, 1, 0);
    sync();
    let t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      const off = am.view.camera.position.clone().sub(c.target).applyAxisAngle(axis, 0.01);
      am.view.camera.position.copy(c.target).add(off);
      am.renderOnce(1 / 60);
    }
    sync();
    const orbit = (performance.now() - t0) / 60;
    const cv = win.document.getElementById('gl');
    t0 = performance.now();
    for (let i = 0; i < 30; i++) {
      cv.dispatchEvent(new win.PointerEvent('pointermove', { pointerType: 'mouse', clientX: 600 + i * 4, clientY: 420, bubbles: true }));
      am.renderOnce(1 / 60);
    }
    sync();
    const hover = (performance.now() - t0) / 30;
    t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      am.annotations.markDirty();
      am.annotations.frame = 5;
      am.annotations.update(0);
    }
    const occl = (performance.now() - t0) / 20;
    t0 = performance.now();
    for (let i = 0; i < 60; i++) am.renderOnce(1 / 60);
    sync();
    const idle = (performance.now() - t0) / 60;
    // Số ms phụ thuộc máy và trạng thái GPU → chỉ ghi THAM KHẢO. Ngưỡng ms nằm ở tests/bench.html
    // (plan đợt 3 §9 / B7: không trộn ngưỡng ms vào selftest — đo thật cùng máy dao động 7→18 ms).
    report(null, 'Hiệu năng (tham khảo, ngưỡng ở tests/bench.html): khung xoay / hover / đứng yên (đồng bộ bằng readPixels)',
      `xoay ${orbit.toFixed(2)} ms · hover ${hover.toFixed(2)} ms · đứng yên ${idle.toFixed(2)} ms · một lượt nhãn + che khuất ${occl.toFixed(2)} ms`);
  });

  await guard('Không cấp phát', () => {
    setExplodeNow(am, 0);
    /** @type {[any, any, any[]][]} */
    const snap = [];
    m.root.traverse((/** @type {any} */ o) => {
      if (o.geometry) snap.push([o, o.geometry, Object.values(o.geometry.attributes).map((a) => /** @type {any} */ (a).array)]);
    });
    const memBefore = am.view.renderer.info.memory.geometries;
    am.store.actions.setExplode(1);
    frames(am, 120);
    let changed = 0;
    for (const [o, g, arrays] of snap) {
      if (o.geometry !== g) changed++;
      else Object.values(g.attributes).forEach((a, i) => { if (/** @type {any} */ (a).array !== arrays[i]) changed++; });
    }
    report(changed === 0 && am.view.renderer.info.memory.geometries === memBefore,
      'Không cấp phát geometry trong 120 khung explode (so sánh tham chiếu)',
      `${snap.length} geometry theo dõi, ${changed} đổi đối tượng`);
    setExplodeNow(am, 0);
  });

  await guard('Camera', () => {
    const sph = new Spherical();
    const v = new Vector3();
    let worst = 0;
    for (const name of ['iso', 'plan', 'front', 'profile']) {
      setView(am, name);
      v.copy(am.view.camera.position).sub(am.cam.controls.target);
      sph.setFromVector3(v);
      const P = am.cam.presets[am.cam.presetKey(name)];
      const dPhi = Math.abs(sph.phi - P.phi);
      const dTh = P.phi < 0.01 ? 0 : Math.abs(angleDelta(sph.theta, P.theta));
      worst = Math.max(worst, dPhi, dTh, Math.abs(am.cam.fov - P.fov) / 100);
    }
    report(worst < 2e-3, 'Camera: 4 preset tới đích', 'sai lệch lớn nhất ' + worst.toExponential(2) + ' rad');

    setView(am, 'iso');
    const d0 = am.view.camera.position.distanceTo(am.cam.controls.target);
    am.store.actions.setExplode(1);
    frames(am, 90);
    am.store.actions.startMotion();
    frames(am, 150);
    am.store.actions.stopMotion();
    frames(am, 60);
    const d1 = am.view.camera.position.distanceTo(am.cam.controls.target);
    report(Math.abs(d1 - d0) < 1e-6, 'Camera: zoom tay giữ nguyên sau explode + flight', `${d0.toFixed(6)} → ${d1.toFixed(6)}`);

    setExplodeNow(am, 1);
    am.store.actions.selectPart('fcu');
    frames(am, 70);
    const fc = am.cam.focusCenter(new Vector3());
    const off1 = fc.distanceTo(am.cam.controls.target);
    am.store.actions.setExplode(0);
    frames(am, 90);
    const off2 = am.cam.focusCenter(new Vector3()).distanceTo(am.cam.controls.target);
    report(off1 < 1e-3, 'Camera: focus part ở e = 1 không bị kéo target về', 'lệch ' + off1.toExponential(2) + ' (FCU cách tâm ' + fc.length().toFixed(2) + ')');
    report(off2 < 1e-3, 'Luật: đang focus mà explode đổi → target bám tâm part', 'lệch ' + off2.toExponential(2));
    am.store.actions.clearSelection();
    frames(am, 60);
  });

  await guard('Flight', () => {
    setView(am, 'iso');
    setExplodeNow(am, 0);
    am.store.actions.startMotion();
    const rig = am.rig;
    let maxStep = 0, minStep = Infinity, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 120; i++) {
      frames(am, 1);
      maxStep = Math.max(maxStep, rig.lastStep);
      minStep = Math.min(minStep, rig.lastStep);
      const a = m.data.wings[0].module.pivot.rotation.z;
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    const limit = (2 * Math.PI * RATE_HZ) / 60 + 1e-9;
    report(maxStep <= limit && minStep >= 0, 'Flight: pha liên tục trong lúc tần số tăng (không nhảy)',
      `bước pha lớn nhất ${(maxStep * 180 / Math.PI).toFixed(2)}° ≤ ${(limit * 180 / Math.PI).toFixed(2)}°`);
    report((hi - lo) * 180 / Math.PI > 60, 'Flight: góc pivot đổi theo thời gian', `${(lo * 180 / Math.PI).toFixed(1)}° … ${(hi * 180 / Math.PI).toFixed(1)}°`);
    am.store.actions.stopMotion();
    let n = 0;
    while (rig.amp > 0 && n < 200) { frames(am, 1); n++; }
    report(n <= 60, 'Flight: STOP về tư thế nghỉ trong < 1s', n + ' khung (' + (n / 60).toFixed(2) + 's)');
    const doc = win.document;
    const ang = doc.getElementById('spec-v2').textContent;
    const rate = doc.getElementById('spec-v3').textContent;
    report(ang === STROKE_DEG + '°' && rate === RATE_HZ.toFixed(1) + ' Hz', 'Flight: ANGLE/RATE trên HUD khớp hằng số rig', `${ang} · ${rate}`);

    // onDeactivate (dùng khi chuyển mẫu, P5): đang vỗ dở → về đúng tư thế chuẩn, pha/biên độ = 0
    am.store.actions.startMotion();
    frames(am, 40);
    rig.onDeactivate();
    am.store.actions.stopMotion();
    let dev = Math.abs(m.motionRoot.position.y) + Math.abs(m.motionRoot.rotation.x);
    for (const w of m.data.wings) dev = Math.max(dev, Math.abs(w.module.pivot.rotation.z), w.feather.quaternion.angleTo(w.feather.quaternion.clone().identity()));
    report(dev < 1e-9 && rig.amp === 0 && rig.phase === 0, 'Rig: onDeactivate() → tư thế chuẩn, reset pha/biên độ', 'lệch lớn nhất ' + dev.toExponential(2));
    frames(am, 5);
  });

  await guard('Va chạm cánh', () => sweepTest(am));
  await guard('Luật trạng thái', () => stateRules(am));
  await guard('Offline', () => {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i;
    const ext = [...win.performance.getEntriesByType('resource'), ...performance.getEntriesByType('resource')]
      .map((e) => e.name).filter((u) => /^https?:/i.test(u) && !local.test(u));
    report(ext.length === 0, 'Offline: 0 request ra ngoài', ext.length ? ext.slice(0, 3).join(' ') : 'mọi tài nguyên đều nội bộ');
  });
  await guard('Chủ đề', () => {
    const memMesh = m.byKind.get('membrane')[0].meshes.find((/** @type {any} */ x) => x.material.userData.matKey === 'membrane');
    const mat = memMesh.material;
    frames(am, 30);
    const c0 = mat.color.getHex();
    const op0 = mat.opacity;
    am.store.actions.setTheme('obsidian');
    frames(am, 30);
    const c1 = mat.color.getHex();
    const bg = win.getComputedStyle(win.document.documentElement).getPropertyValue('--bg').trim();
    am.store.actions.setTheme('azure');
    frames(am, 30);
    const c2 = mat.color.getHex();
    const ok = c0 !== c1 && c2 === c0 && Math.abs(mat.opacity - op0) < 1e-6 && bg === '#050405';
    report(ok, 'Chủ đề: Azure & Gold ⇄ Obsidian, đổi lại khớp đúng giá trị gốc (không nhân dồn)',
      `màng #${c0.toString(16)} → #${c1.toString(16)} → #${c2.toString(16)} · nền Obsidian ${bg}`);
  });
  await guard('Context loss', async () => {
    const r = am.view.renderer;
    r.forceContextLoss();
    await sleep(300);
    const lost = am.view.contextLost && !win.document.getElementById('gl-notice').hidden;
    r.forceContextRestore();
    await sleep(500);
    frames(am, 3);
    const ok = !am.view.contextLost && !r.getContext().isContextLost() && !!am.view.scene.environment && r.info.render.calls > 0;
    report(lost && ok, 'Context loss → restore: vẫn render, env map còn', `lost=${lost} restored=${ok}`);
  });
  await guard('Bố cục: HUD đang trượt', () => {
    // Lỗi cũ: HUD trượt vào bằng translateY lúc intro và getBoundingClientRect tính cả transform → vùng an
    // toàn (và khung camera) lệch tới 4 px tuỳ thời điểm đo. Giờ phải đo đúng vị trí NGHỈ.
    const base = JSON.stringify(am.layoutOnce().safe);
    const huds = [...win.document.querySelectorAll('.hud')];
    for (const el of huds) /** @type {HTMLElement} */ (el).style.transform = el.classList.contains('hud-bc') ? 'translate(-50%, 4px)' : 'translateY(4px)';
    const moving = JSON.stringify(am.layoutOnce().safe);
    for (const el of huds) /** @type {HTMLElement} */ (el).style.transform = '';
    am.layoutOnce();
    report(moving === base, 'Bố cục: vùng an toàn đo ở vị trí nghỉ của HUD (không lệch khi HUD đang trượt vào lúc intro)', `nghỉ ${base} · đang trượt ${moving}`);
  });

  await guard('Vật liệu dựng muộn', () => {
    // Mẫu dựng SAU khi đổi chủ đề (husky dựng khi rảnh, P5) phải mang chủ đề hiện hành
    am.store.actions.setTheme('obsidian');
    frames(am, 5);
    const late = am.lib.make('membrane');
    const okDark = late.color.getHex() === PALETTES.obsidian.membrane.c && late.opacity === PALETTES.obsidian.membrane.op;
    am.store.actions.setTheme('azure');
    frames(am, 30);
    const late2 = am.lib.make('membrane');
    const okLight = late2.color.getHex() === PALETTES.azure.membrane.c;
    report(okDark && okLight && am.lib.theme === 'azure', 'Vật liệu: tạo sau khi đổi chủ đề lấy đúng chủ đề hiện hành',
      `obsidian #${late.color.getHex().toString(16)} · azure #${late2.color.getHex().toString(16)}`);
    late.dispose();
    late2.dispose();
  });
  f.remove();

  await guard('Store: chuyển mẫu', () => storeMachineTests());

  // ── Husky (mẫu vật 2): hình học, kích thước GaitSpec, registry, explode + sàn ─────────────────────
  {
    const h = await loadApp(1440, 900, '&specimen=husky');
    await huskyModelTests({ report, guard }, h.am);
    await huskyGaitTests({ report, guard }, h.am);
    h.f.remove();
  }

  // ── Chuyển mẫu vật (§3–§4): commit nguyên tử, warm-up, bộ nhớ, context ──────────────────────────
  await switchTests({ report, guard, load: (q) => loadAppIn(stage, 1440, 900, q) });
  // ── Cử chỉ chạm ở kích thước iPhone / iPad ─────────────────────────────────────────────────────
  await touchTests({ report, guard, load: (q, w, h) => loadAppIn(stage, w, h, q) });
  await guard('Golden', async () => {
    const g = await compareGoldens(stage);
    report(g.fail === 0 && g.skipped === 0 && g.pass === g.total, `Golden: ${g.total} ảnh (bướm + husky × 2 chủ đề × 4 view × 2 mức nổ) khớp mốc chuẩn`, g.summary);
    const bad = g.rows.filter((r) => !r.startsWith('PASS'));
    if (bad.length) report(null, 'Golden: chi tiết', bad.slice(0, 6).join(' | '));
  });
  // (A/B với bản đông cứng trước refactor — bằng chứng P1 "không đổi một pixel" — nay chạy tay qua
  //  tests/golden.html?ab: từ FPS vòng 3, hình bướm được giảm tam giác CÓ CHỦ ĐÍCH nên không còn trùng byte.)
  await guard('DPR', () => dprTest());
  await layoutGrid();

  const fails = results.filter((r) => r.ok === false).length;
  const pass = results.filter((r) => r.ok === true).length;
  const sum = /** @type {HTMLElement} */ (document.getElementById('summary'));
  sum.textContent = `${pass} PASS · ${fails} FAIL · ${((performance.now() - t0) / 1000).toFixed(1)}s`;
  sum.style.color = fails ? '#e0876a' : '#9fc49a';
  /** @type {any} */ (window).__selftest = { done: true, pass, fails, results };
}

// ── Vẽ theo lô (FPS vòng 3): mesh gốc = model logic ở layer 1, BatchedMesh vẽ thay ────────────────
/** @param {any} am */
function batchTests(am) {
  const m = am.model;
  /** @type {Map<any, number>} */
  const owner = new Map();
  for (const B of m.batches) for (const mesh of B.meshes) owner.set(mesh, (owner.get(mesh) || 0) + 1);
  let eligible = 0, wrongLayer = 0, notOnce = 0, mixed = 0;
  m.root.traverse((/** @type {any} */ o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.userData.dynamic || !o.userData.part) return;
    eligible++;
    if (owner.get(o) !== 1) notOnce++;
    if (o.layers.mask !== 2) wrongLayer++;
  });
  for (const B of m.batches) if (B.meshes.some((/** @type {any} */ x) => x.material !== B.b.material || x.renderOrder !== B.b.renderOrder)) mixed++;
  report(eligible > 0 && notOnce === 0 && wrongLayer === 0 && mixed === 0, 'Vẽ theo lô: mỗi mesh gốc nằm đúng một lô cùng vật liệu, và rời lượt vẽ (layer 1)',
    `${eligible} mesh → ${m.batches.length} lô · sai lô ${notOnce} · sai layer ${wrongLayer} · lô trộn vật liệu ${mixed}`);

  // Ma trận + trạng thái hiện của từng phần tử phải khớp mesh gốc ở ĐÚNG khung vừa vẽ (gọi ngay sau render)
  const M = new Matrix4(), W = new Matrix4(), inv = new Matrix4();
  const check = () => {
    let worst = 0, visBad = 0;
    for (const B of m.batches) {
      inv.copy(B.b.matrixWorld).invert();
      B.meshes.forEach((/** @type {any} */ mesh, /** @type {number} */ i) => {
        B.b.getMatrixAt(i, M);
        W.multiplyMatrices(inv, mesh.matrixWorld);
        for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(M.elements[k] - W.elements[k]));
        if (B.b.getVisibleAt(i) !== mesh.visible) visBad++;
      });
    }
    return { worst, visBad };
  };
  setExplodeNow(am, 0.63);
  const a = check();
  setExplodeNow(am, 0);
  am.store.actions.startMotion();
  frames(am, 40); // đang bay: cánh, bánh răng, thanh truyền đổi mỗi khung
  const amp = am.rig.ampE;
  const moving = amp > 0.3;
  const b = check();
  am.store.actions.stopMotion();
  frames(am, 90);
  report(moving && Math.max(a.worst, b.worst) < 1e-5 && a.visBad + b.visBad === 0,
    'Vẽ theo lô: ma trận + trạng thái hiện của từng phần tử khớp mesh gốc ngay trong khung vẽ (lúc nổ dở e = 0.63 và lúc đang bay)',
    `sai lệch lớn nhất ${Math.max(a.worst, b.worst).toExponential(2)} (texture ma trận float32) · lệch trạng thái hiện ${a.visBad + b.visBad} · biên độ bay lúc đo ${amp.toFixed(2)}`);
}

// ── Pick bằng cây BVH (core/triBvh.js) phải trùng raycast từng tam giác của three ─────────────────
/** @param {any} am */
function pickTests(am) {
  const picker = am.picker;
  const cam = am.view.camera;
  const L = am.layout;
  // Raycaster của CHÍNH iframe (cùng thực thể three với app)
  const rc = new picker.raycaster.constructor();
  rc.layers.enableAll();
  const meshes = picker.items.map((/** @type {any} */ it) => it.m);
  const ndc = { x: 0, y: 0 };
  let rays = 0, hits = 0, bad = 0, worst = 0;
  /** @type {string[]} */
  const eg = [];
  for (const [view, e] of /** @type {[string, number][]} */ ([['iso', 0], ['profile', 0], ['plan', 1], ['front', 0.5]])) {
    setView(am, view);
    setExplodeNow(am, e);
    am.renderOnce(1 / 60);
    for (let gy = 0; gy < 20; gy++)
      for (let gx = 0; gx < 30; gx++) {
        ndc.x = ((gx + 0.5) / 30) * 2 - 1;
        ndc.y = -(((gy + 0.5) / 20) * 2 - 1);
        rc.setFromCamera(ndc, cam);
        const a = picker.first(rc.ray);
        const hs = rc.intersectObjects(meshes.filter((/** @type {any} */ m) => m.visible), false);
        rays++;
        const b = hs.length ? hs[0] : null;
        if (!!a !== !!b || (a && b && a.object !== b.object && Math.abs(a.distance - b.distance) > 1e-6)) {
          bad++;
          if (eg.length < 3) eg.push(`${view}@${e}: BVH ${a ? a.object.userData.part.name : '—'} · three ${b ? b.object.userData.part.name : '—'}`);
        }
        if (a && b) {
          hits++;
          worst = Math.max(worst, Math.abs(a.distance - b.distance));
        }
      }
  }
  setExplodeNow(am, 0);
  setView(am, 'iso');
  report(bad === 0 && hits > 50, 'Pick bằng BVH: trùng raycast từng tam giác của three (600 tia × 4 view/mức nổ)',
    `${rays} tia · ${hits} trúng · ${bad} khác${eg.length ? ' — ' + eg.join(' | ') : ''} · lệch khoảng cách lớn nhất ${worst.toExponential(1)}`);
}

// ── Quét va chạm cánh (plan §16/§21) ───────────────────────────────────────────────────────────
/** @param {any} am */
function sweepTest(am) {
  const m = am.model;
  const rig = am.rig;
  setExplodeNow(am, 0);
  const v = new Vector3();

  /** Điểm màng: lưới t × w trên từng múi của cánh quạt (mặt cong thật, không phải đỉnh mesh) */
  /** @param {any} w */
  const gridPoints = (w) => membraneSamples(w, 24, 12);

  /** Đỉnh bề mặt các ống/khối trên cánh (trừ bánh răng đồng trục — cố ý ăn khớp với bánh con) */
  /** @param {any} w */
  const meshPoints = (w) => {
    /** @type {{obj: any, p: Vector3}[]} */
    const pts = [];
    w.module.pivot.traverse((/** @type {any} */ o) => {
      if (!o.isMesh || !o.userData.part || o.userData.part.kind === 'gears') return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) pts.push({ obj: o, p: new Vector3().fromBufferAttribute(pos, i) });
    });
    return pts;
  };

  /** @param {{obj: any, p: Vector3}[]} list @param {Vector3[]} into */
  const toWorld = (list, into) => {
    into.length = 0;
    for (const it of list) into.push(v.copy(it.p).applyMatrix4(it.obj.matrixWorld).clone());
    return into;
  };

  // Hộp bao các bộ phận thân mà cánh không được lọt vào
  const bodyKinds = new Set(['cranial', 'optic', 'antenna', 'spine', 'caudal', 'legs']);
  const bodyParts = m.parts.filter((/** @type {any} */ p) => bodyKinds.has(p.kind) ||
    (p.kind === 'gears' && (p.name.startsWith('dorsal') || p.name.startsWith('pinion'))));
  const boxOf = (/** @type {any} */ p) => {
    const b = new Box3();
    for (const mesh of p.meshes) b.expandByObject(mesh);
    return b;
  };

  let intrusions = 0;
  let worstMin = Infinity;
  let worstAt = '';
  for (const s of [1, -1]) {
    const fore = m.data.wings.find((/** @type {any} */ w) => w.s === s && w.which === 'fore');
    const hind = m.data.wings.find((/** @type {any} */ w) => w.s === s && w.which === 'hind');
    const F = [...gridPoints(fore), ...meshPoints(fore)];
    const H = [...gridPoints(hind), ...meshPoints(hind)];
    /** @type {Vector3[]} */ const Fw = [];
    /** @type {Vector3[]} */ const Hw = [];
    let minD = Infinity, minPhase = 0;
    for (let k = 0; k < 48; k++) {
      const phase = (k / 48) * Math.PI * 2;
      rig.pose(phase, 1);
      m.root.updateMatrixWorld(true);
      toWorld(F, Fw);
      toWorld(H, Hw);
      // băm không gian 0.06 cho H
      const cell = 0.06;
      /** @type {Map<string, Vector3[]>} */
      const grid = new Map();
      const key = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => x + ',' + y + ',' + z;
      for (const p of Hw) {
        const kk = key(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell));
        if (!grid.has(kk)) grid.set(kk, []);
        /** @type {Vector3[]} */ (grid.get(kk)).push(p);
      }
      for (const p of Fw) {
        const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (const q of list) {
            const d = p.distanceTo(q);
            if (d < minD) { minD = d; minPhase = k; }
          }
        }
      }
      // (b) thân: không điểm cánh nào lọt vào hộp bao
      const boxes = bodyParts.map(boxOf);
      for (const p of [...Fw, ...Hw]) for (const b of boxes) if (b.containsPoint(p)) { intrusions++; break; }
    }
    if (minD < worstMin) { worstMin = minD; worstAt = `${s > 0 ? 'phải' : 'trái'}, pha ${minPhase}/48`; }
    report(minD > 0.01, `Va chạm: forewing–hindwing bên ${s > 0 ? 'phải' : 'trái'} tách nhau suốt 48 pha`,
      `khoảng cách bề mặt nhỏ nhất ${minD === Infinity ? '> 0.06 (không cặp nào gần)' : minD.toFixed(4)} · ${F.length}+${H.length} điểm`);
  }
  report(intrusions === 0, 'Va chạm: không điểm cánh nào lọt vào đầu, antenna, spine, chân, bánh răng thân', intrusions + ' điểm lọt');
  rig.pose(rig.phase, rig.ampE);
  m.root.updateMatrixWorld(true);
  void worstAt;
}

// ── Luật trạng thái (plan §4) ─────────────────────────────────────────────────────────────────
/** @param {any} am */
function stateRules(am) {
  const a = am.store.actions;
  const st = () => am.store.state;
  setExplodeNow(am, 0);

  a.startMotion(); frames(am, 30);
  a.setExplode(0.5);
  report(st().mode === 'inspection' && st().explodeTarget === 0.5, 'Luật: đang bay + nổ → dừng bay rồi nổ', st().mode);
  setExplodeNow(am, 0);

  a.startMotion(); frames(am, 10);
  a.selectPart('servo-R-fore');
  report(st().mode === 'inspection' && st().selectedPartId === 'servo-R-fore', 'Luật: đang bay + chọn part → dừng bay rồi focus', st().mode);
  a.clearSelection(); frames(am, 60);

  setExplodeNow(am, 1);
  a.startMotion();
  let flappedEarly = false;
  for (let i = 0; i < 90; i++) {
    frames(am, 1);
    if (am.explode.value >= 0.05 && am.rig.amp > 0) flappedEarly = true;
  }
  report(st().explodeTarget === 0 && !flappedEarly && am.rig.amp > 0,
    'Luật: đang nổ + TAKE FLIGHT → lắp lại trước, chỉ vỗ khi e < 0.05', `amp=${am.rig.amp.toFixed(2)}`);
  a.stopMotion(); frames(am, 60);

  a.selectPart('fcu'); frames(am, 30);
  a.setView('plan');
  report(st().selectedPartId === null, 'Luật: đang focus + đổi preset → bỏ focus', String(st().selectedPartId));
  frames(am, 64);

  a.toggleAutoOrbit();
  a.setView('iso');
  const off1 = !st().autoOrbit;
  a.toggleAutoOrbit();
  a.selectPart('fcu');
  const off2 = !st().autoOrbit;
  report(off1 && off2, 'Luật: auto-orbit tắt khi đổi preset / chọn part', `${off1} ${off2}`);
  a.clearSelection(); frames(am, 64);

  a.setView('front');
  frames(am, 5);
  const locked = am.cam.controls.enabled === false && st().cameraTweening;
  frames(am, 64);
  report(locked && am.cam.controls.enabled && !st().cameraTweening, 'Luật: trong tween camera, OrbitControls bị khoá; xong thì mở lại', String(locked));
  setView(am, 'iso');
}

// ── Registry / instance ↔ catalog (plan đợt 3, §7) ────────────────────────────────────────────
/** @param {any} am */
function registryTests(am) {
  const m = am.model;
  const def = am.def;
  // So theo id/tiêu đề, KHÔNG so đối tượng: iframe nạp module riêng nên REGISTRY ở đây là bản sao khác realm
  const id = am.store.state.specimen;
  report(SPECIMEN_IDS.includes(id) && def.id === id && REGISTRY[id].title === def.title && REGISTRY[id].catalog.length === def.catalog.length,
    'Registry: mẫu đang xem lấy từ registry (nguồn ID duy nhất)', `${SPECIMEN_IDS.join(', ')} · đang xem ${def.id}`);

  // ID duy nhất + mọi mesh pick được ánh xạ đúng MỘT catalogId
  const names = new Set(m.parts.map((/** @type {any} */ p) => p.name));
  let unmapped = 0;
  /** @type {Set<string>} */
  const kinds = new Set();
  for (const mesh of m.pickables) {
    const p = mesh.userData.part;
    const hits = def.catalog.filter((/** @type {any} */ c) => p && c.id === p.kind).length;
    if (hits !== 1 || !m.byName.get(p.name)) unmapped++;
    else kinds.add(p.kind);
  }
  const anchored = def.catalog.filter((/** @type {any} */ c) => c.annotate && m.reps[c.id] && m.reps[c.id].anchor).length;
  const wantAnn = def.catalog.filter((/** @type {any} */ c) => c.annotate).length;
  report(names.size === m.parts.length && unmapped === 0 && anchored === wantAnn && wantAnn === 16,
    'Registry: tên instance duy nhất · mọi mesh pick → đúng 1 mục catalog · 16 mục có neo nhãn',
    `${m.parts.length} part · ${m.pickables.length} mesh · ${unmapped} không ánh xạ · ${kinds.size} loại · neo ${anchored}/${wantAnn}`);

  // ctx.part() trùng tên → ném lỗi (không ghi đè âm thầm). Dựng một mẫu giả trong trang test.
  const lib = createMaterialLibrary('azure');
  const ms = new MaterialState();
  /** @type {any} */
  const fake = {
    ...def, id: 'dup', catalog: [], rep: {},
    *buildSteps(/** @type {any} */ ctx) {
      ctx.top(ctx.part('x', 'same'));
      yield;
      ctx.top(ctx.part('x', 'same'));
      return {};
    },
    afterExplode() {},
  };
  let threw = '';
  try {
    new MechanicalModel(fake, lib, ms);
  } catch (e) {
    threw = String(/** @type {any} */ (e).message || e);
  }
  report(/trùng tên/.test(threw), 'Registry: part trùng tên → ném lỗi khi dựng', threw || 'KHÔNG ném lỗi');

  // Vật liệu tách theo mẫu: mẫu đang xem là chủ danh sách, mọi vật liệu của model nằm trong đó
  let mats = 0, owned = 0;
  const list = am.ms.lists.get(def.id) || [];
  const set = new Set(list.map((/** @type {any} */ e) => e.m));
  m.root.traverse((/** @type {any} */ o) => {
    if (!o.material || !o.material.userData.matKey || !o.userData.part) return;
    mats++;
    if (set.has(o.material)) owned++;
  });
  report(am.ms.activeOwner === def.id && mats > 0 && owned === mats, 'Vật liệu: danh sách theo mẫu, mẫu đang xem sở hữu mọi vật liệu của nó',
    `${owned}/${mats} vật liệu · ${list.length} mục đăng ký`);
}

// ── Store: state machine chuyển mẫu (plan đợt 3, §3) — kiểm trên store độc lập ──────────────────
function storeMachineTests() {
  const s = createStore({}, { specimenIds: ['a', 'b'] });
  const a = s.actions;
  const st = () => s.state;
  /** @type {string[][]} */
  const calls = [];
  s.subscribe((_st, ch) => calls.push(Object.keys(ch)));

  // Yêu cầu B khi chưa sẵn sàng → preparing; lặp phím không tạo gen mới
  a.requestSpecimen('b', false);
  const g1 = st().specimenGen;
  a.requestSpecimen('b', false);
  a.requestSpecimen('b', false);
  const t1 = st().specimenPhase === 'preparing' && st().pendingSpecimen === 'b' && st().specimenGen === g1 && st().specimen === 'a';
  // Chọn lại A khi đang preparing → huỷ; kết quả build gen cũ về muộn không được bắt đầu fade
  a.requestSpecimen('a', true);
  const lateReady = a.specimenReady(g1);
  const t2 = st().specimenPhase === 'idle' && st().pendingSpecimen === null && lateReady === false && st().specimen === 'a';
  report(t1 && t2, 'Store: yêu cầu lặp không tạo gen mới · chọn lại mẫu cũ huỷ · ready của gen cũ bị bỏ', `${t1} ${t2}`);

  // A → B → A khi đang fade ra: huỷ, sáng lại A; commit của gen B cũ không được đổi mẫu
  a.requestSpecimen('b', true);
  const gB = st().specimenGen;
  const out = st().specimenPhase === 'fadingOut';
  a.requestSpecimen('a', true);
  const cancelled = st().specimenPhase === 'fadingIn' && st().pendingSpecimen === null;
  const lateCommit = a.commitSpecimen(gB);
  a.finishSpecimenFade(st().specimenGen);
  report(out && cancelled && lateCommit === false && st().specimen === 'a' && st().specimenPhase === 'idle',
    'Store: A→B→A giữa lúc fade → huỷ, commit gen cũ bị bỏ, vẫn là A', `commit cũ=${lateCommit} mẫu=${st().specimen}`);

  // Guard trong lúc chuyển: explode / motion / chọn part / đổi view đều bị bỏ qua
  a.setExplode(0.7);
  a.selectPart('p1');
  a.toggleAutoOrbit();
  const nonce0 = st().viewNonce;
  a.requestSpecimen('b', true);
  const gen = st().specimenGen;
  a.setExplode(0.2);
  a.startMotion();
  a.selectPart('p2');
  a.setView('plan');
  const guarded = st().explodeTarget === 0.7 && st().mode === 'inspection' && st().selectedPartId === 'p1' && st().viewPreset === 'iso';
  report(guarded, 'Store: đang chuyển mẫu → bỏ qua explode / motion / chọn part / đổi view',
    `explode=${st().explodeTarget} mode=${st().mode} sel=${st().selectedPartId} view=${st().viewPreset}`);

  // Commit NGUYÊN TỬ: một lần phát sự kiện, đủ mọi trường, explode giữ nguyên
  calls.length = 0;
  const ok = a.commitSpecimen(gen);
  const nEvents = calls.length;
  const keys = calls.length === 1 ? calls[0] : [];
  const need = ['specimen', 'pendingSpecimen', 'specimenPhase', 'selectedPartId', 'autoOrbit', 'viewNonce'];
  const atomic = ok && calls.length === 1 && need.every((k) => keys.includes(k));
  const after = st().specimen === 'b' && st().pendingSpecimen === null && st().specimenPhase === 'fadingIn' &&
    st().mode === 'inspection' && st().selectedPartId === null && !st().autoOrbit && st().viewPreset === 'iso' &&
    st().viewNonce === nonce0 + 1 && st().explodeTarget === 0.7;
  const again = a.commitSpecimen(gen);
  a.finishSpecimenFade(gen);
  report(atomic && after && again === false && st().specimenPhase === 'idle',
    'Store: commit nguyên tử (1 sự kiện, đủ trường), giữ explode, commit lại bị từ chối',
    `${nEvents} sự kiện · [${keys.join(',')}]`);

  // Bấm 20 lần liên tiếp xen kẽ: chỉ gen cuối commit được, không bao giờ kẹt
  let committed = 0;
  /** @type {number[]} */
  const gens = [];
  for (let i = 0; i < 20; i++) {
    a.requestSpecimen(i % 2 ? 'b' : 'a', true);
    gens.push(st().specimenGen);
  }
  for (const g of gens) if (a.commitSpecimen(g)) committed++;
  a.finishSpecimenFade(st().specimenGen);
  report(committed <= 1 && st().specimenPhase === 'idle' && ['a', 'b'].includes(st().specimen),
    'Store: 20 yêu cầu dồn dập → tối đa 1 commit, kết thúc ở idle', `${committed} commit · mẫu ${st().specimen}`);
}

// ── DPR thích ứng: chỉ đo khi Active (plan §18) ───────────────────────────────────────────────
function dprTest() {
  const realRAF = window.requestAnimationFrame;
  const realCAF = window.cancelAnimationFrame;
  /** @type {FrameRequestCallback[]} */
  let queue = [];
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => { queue = []; };
  let ts = 1000;
  const pump = (/** @type {number} */ seconds, /** @type {number} */ step) => {
    for (let t = 0; t < seconds * 1000; t += step) {
      ts += step;
      const q = queue;
      queue = [];
      q.forEach((cb) => cb(ts));
    }
  };
  /** Chạy một scheduler giả lập: frame() bận/rảnh, khoảng cách khung `step` ms, trong `seconds` s. */
  const run = (/** @type {boolean} */ busyFrames, /** @type {number} */ seconds, /** @type {number} */ step, /** @type {() => boolean} */ noisy = () => false) => {
    let slow = 0;
    const s = new Scheduler({ frame: () => busyFrames, onSlow: () => slow++, isNoisy: noisy });
    ts = 1000;
    s.start();
    pump(seconds, step);
    s.stop();
    return slow;
  };
  try {
    const slowIdle = run(false, 12, 16.7);
    const slowBusy = run(true, 12, 30); // 5 s bỏ qua + 3 cửa sổ 2 s chậm
    const twoWindows = run(true, 9.5, 30); // mới 2 cửa sổ chậm
    const noisy = run(true, 12, 30, () => true); // cửa sổ có chuyển mẫu/warm → bị loại
    const healthy = run(true, 12, 16.7);
    report(slowIdle === 0 && healthy === 0, 'Chất lượng: Idle (~30 fps cố ý) hay Active 60 fps → không hạ', `${slowIdle} · ${healthy} lần hạ`);
    report(slowBusy === 1 && twoWindows === 0, 'Chất lượng: Active p95 > 22 ms trong 3 cửa sổ 2 s liên tiếp (sau 5 s đầu) → hạ đúng một bậc; 2 cửa sổ → chưa',
      `3 cửa sổ: ${slowBusy} lần · 2 cửa sổ: ${twoWindows} lần`);
    report(noisy === 0, 'Chất lượng: cửa sổ có chuyển mẫu / biên dịch / warm bị loại → không hạ oan', `${noisy} lần hạ`);

    // Idle 30 → 20 fps sau 10 s không thao tác; SUSPENDED (tab ẩn) → 0 khung; resume → dt khung đầu = 1/60
    let n = 0;
    /** @type {number[]} */
    const dts = [];
    const s = new Scheduler({ frame: (dt) => { n++; dts.push(dt); return false; } });
    ts = 1000;
    s.start();
    pump(2, 1000 / 120);
    const at30 = n;
    pump(10, 1000 / 120);
    n = 0;
    pump(2, 1000 / 120);
    const at20 = n;
    s.suspend('hidden');
    n = 0;
    pump(3, 1000 / 120);
    const hiddenFrames = n;
    ts += 5000; // tab ẩn 5 s
    s.resume('hidden');
    dts.length = 0;
    pump(0.02, 1000 / 120);
    const firstDt = dts[0];
    s.stop();
    report(Math.abs(at30 - 60) <= 4 && Math.abs(at20 - 40) <= 4, 'Scheduler: Idle ~30 fps, còn ~20 fps sau 10 s không thao tác',
      `2 s đầu ${at30} khung · 2 s sau 10 s ${at20} khung`);
    report(hiddenFrames === 0 && Math.abs(firstDt - 1 / 60) < 1e-9, 'Scheduler: SUSPENDED (tab ẩn) 0 khung · resume không "đuổi" thời gian (dt khung đầu = 1/60)',
      `${hiddenFrames} khung khi ẩn · dt đầu ${firstDt && firstDt.toFixed(4)} s`);
  } finally {
    window.requestAnimationFrame = realRAF;
    window.cancelAnimationFrame = realCAF;
  }
}

// ── Bố cục: 2 mẫu × 8 kích thước × 4 view × 3 mức nổ ──────────────────────────────────────────
async function layoutGrid() {
  const sizes = [[1440, 900], [1366, 768], [1280, 720], [1024, 768], [834, 1194], [1194, 834], [390, 844], [844, 390]];
  for (const sp of ['ornithopter', 'husky'])
    for (const [w, h] of sizes) await layoutOne(sp, w, h);
}

/** @param {string} sp @param {number} w @param {number} h */
async function layoutOne(sp, w, h) {
  {
    await guard(`Bố cục ${sp} ${w}×${h}`, async () => {
      const { f, am } = await loadApp(w, h, '&specimen=' + sp);
      const small = am.layout.cls === 'mobile' || am.layout.cls === 'phone-landscape';
      const [lo, hi] = small ? [0.6, 0.92] : [0.6, 0.78];
      /** @type {string[]} */
      const bad = [];
      let minShown = Infinity, maxShown = 0, fMin = Infinity, fMax = 0;
      const hudRects = am.layout.hud;
      const hud = hudOverlaps(hudRects);
      if (hud) bad.push(`HUD chồng nhau ×${hud}`);
      for (const view of ['iso', 'plan', 'front', 'profile']) {
        setView(am, view);
        for (const e of [0, 0.5, 1]) {
          setExplodeNow(am, e);
          frames(am, 8);
          const au = am.annotations.audit();
          minShown = Math.min(minShown, au.shown);
          maxShown = Math.max(maxShown, au.shown);
          if (au.overlaps || au.crossings || au.hud || au.out || au.nan)
            bad.push(`${view}@${e}: chồng ${au.overlaps} · cắt ${au.crossings} · đè HUD ${au.hud} · tràn ${au.out} · NaN ${au.nan}`);
          const b = modelBox(am, e);
          const S = am.layout.safe;
          const frac = Math.max((b.x1 - b.x0) / (S.x1 - S.x0), (b.y1 - b.y0) / (S.y1 - S.y0));
          fMin = Math.min(fMin, frac);
          fMax = Math.max(fMax, frac);
          if (frac < lo || frac > hi) bad.push(`${view}@${e}: model chiếm ${(frac * 100).toFixed(0)}%`);
          if (b.x0 < -1 || b.y0 < -1 || b.x1 > am.layout.W + 1 || b.y1 > am.layout.H + 1) bad.push(`${view}@${e}: model tràn khung`);
        }
      }
      report(bad.length === 0, `Bố cục ${sp} ${w}×${h} (${am.layout.cls})`,
        bad.length ? bad.slice(0, 4).join(' | ') : `nhãn ${minShown}–${maxShown} · model ${(fMin * 100).toFixed(0)}–${(fMax * 100).toFixed(0)}% vùng an toàn · 0 chồng · 0 cắt`);
      f.remove();
    });
  }
}

run();
