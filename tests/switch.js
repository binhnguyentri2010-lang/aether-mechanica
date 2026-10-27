// @ts-check
// Test chuyển mẫu vật (plan đợt 3 §3–§4): commit nguyên tử, không khung nào lệch UI/picker, phím lặp,
// huỷ giữa fade, TROT + chuyển, giữ explode, Preparing, warm-up (không upload ở lần vẽ đầu), bộ nhớ,
// nhánh không KHR_parallel_shader_compile, mất context.
import { sleep, frames } from './harness.js';

/**
 * @typedef {{
 *   report: (ok: boolean|null, name: string, detail?: any) => void,
 *   guard: (name: string, fn: () => any) => Promise<void>,
 *   load: (query: string) => Promise<{f: HTMLIFrameElement, am: any, win: any}>,
 * }} T
 */

/** Bơm khung CÓ nhường event loop (compileAsync cần promise chạy) tới khi mọi mẫu sẵn sàng. @param {any} am */
export async function waitReady(am, maxFrames = 600) {
  for (let i = 0; i < maxFrames && !am.manager.allReady(); i++) {
    am.renderOnce(1 / 60);
    await sleep(4);
  }
  return am.manager.allReady();
}

/** Bơm khung tới khi chuyển mẫu xong (phase idle). @param {any} am @param {(am: any) => void} [each] */
async function untilIdle(am, each, max = 400) {
  let n = 0;
  while ((am.store.state.specimenPhase !== 'idle' || n === 0) && n < max) {
    am.renderOnce(1 / 60);
    if (each) each(am);
    n++;
    if (n % 8 === 0) await sleep(0);
  }
  return n;
}

/** Bất biến: mọi thứ người dùng thấy/chạm được thuộc CÙNG một mẫu. Trả về chuỗi lỗi hoặc ''. @param {any} am @param {any} win */
function invariant(am, win) {
  const id = am.store.state.specimen;
  const d = am.def;
  const m = am.model;
  if (d.id !== id || m.id !== id) return `mẫu ${id} nhưng def ${d.id} / model ${m.id}`;
  if (!m.root.visible) return 'model đang xem bị ẩn';
  for (const r of am.manager.records.values()) if (r.model && r.model !== m && r.model.root.visible) return `model ${r.id} ẩn mà vẫn hiện`;
  const it = am.picker.items[0];
  let o = it && it.m;
  while (o && o !== m.root) o = o.parent;
  if (!o) return 'picker không thuộc model đang xem';
  const parts = new Set(m.parts);
  if (!am.annotations.entries.every((/** @type {any} */ e) => parts.has(e.part))) return 'nhãn thuộc mẫu khác';
  const doc = win.document;
  if (doc.querySelector('.spec-title').textContent !== d.title) return 'spec không khớp';
  if (am.inspector.byId !== d.byId) return 'inspector không khớp';
  const btn = doc.getElementById('flight').textContent;
  if (btn !== d.labels.start && btn !== d.labels.stop) return `nút chuyển động "${btn}"`;
  return '';
}

/** @param {any} am */
const mem = (am) => {
  const i = am.view.renderer.info;
  return { p: i.programs.length, g: i.memory.geometries, t: i.memory.textures };
};

/** @param {T} t */
export async function switchTests(t) {
  const { report, guard, load } = t;

  await guard('Chuyển mẫu: Preparing', async () => {
    const { f, am, win } = await load('still&theme=azure&dpr=1');
    // Chọn husky NGAY khi tải — chưa dựng: phải ở 'preparing', không fade, nút ghi Preparing…
    am.requestSpecimen('husky');
    const st0 = am.store.state.specimenPhase;
    am.renderOnce(1 / 60);
    const btn = [...win.document.querySelectorAll('#specimens button')].find((b) => b.dataset.specimen === 'husky');
    const txt = btn.textContent;
    const stillOrni = am.store.state.specimen === 'ornithopter' && am.fade === 1;
    const n = await untilIdle(am, undefined, 2000);
    let waited = 0;
    while (am.store.state.specimen !== 'husky' && waited++ < 400) {
      am.renderOnce(1 / 60);
      await sleep(4);
    }
    report(st0 === 'preparing' && /Preparing/.test(txt) && stillOrni && am.store.state.specimen === 'husky' && am.store.state.specimenPhase === 'idle',
      'Chuyển mẫu: chọn mẫu chưa dựng → Preparing (không fade, không dựng đồng bộ) rồi mới chuyển',
      `pha đầu ${st0} · nút "${txt}" · ${n + waited} khung · bước dựng nền dài nhất ${am.manager.stats.maxStepMs.toFixed(1)} ms`);
    f.remove();
  });

  // KHÔNG still, và ép bỏ qua prefers-reduced-motion của máy: có intro + fade thật
  const { f, am, win } = await load('theme=azure&dpr=1&fullmotion');
  for (let i = 0; i < 130; i++) am.renderOnce(1 / 60); // hết intro (1.9 s)
  const readyOk = await waitReady(am);

  await guard('Chuyển mẫu: warm-up', async () => {
    const s = am.manager.stats;
    // Plan §4: "đo và GHI LẠI bước dài nhất" — số ms phụ thuộc máy nên chỉ ghi, không làm ngưỡng (B7)
    report(readyOk, 'Warm-up: mẫu ẩn dựng nền theo lát thời gian + warm GPU xong khi app rảnh',
      `dựng ${s.builds} mẫu · bước dài nhất ${s.maxStepMs.toFixed(1)} ms · ${s.warmFrames} khung warm · khung warm nặng nhất ${s.maxWarmMs.toFixed(1)} ms (số ms: tham khảo)`);
    // Lần vẽ NHÌN THẤY đầu tiên sau commit không upload/biên dịch gì thêm — cả hai chiều
    /** @type {string[]} */
    const rows = [];
    let grew = 0;
    for (const target of ['husky', 'ornithopter']) {
      const a = mem(am);
      am.requestSpecimen(target);
      await untilIdle(am);
      frames(am, 2);
      const b = mem(am);
      if (b.p > a.p || b.g > a.g || b.t > a.t) grew++;
      rows.push(`${target}: program ${a.p}→${b.p} · geometry ${a.g}→${b.g} · texture ${a.t}→${b.t}`);
    }
    report(grew === 0, 'Warm-up: lần vẽ đầu sau commit không tăng programs / geometries / textures (2 chiều)', rows.join(' | '));
  });

  await guard('Chuyển mẫu: nguyên tử', async () => {
    // Mỗi khung trong suốt cú chuyển (fade ra → commit → fade vào): UI/picker/nhãn/spec cùng một mẫu
    let bad = '';
    let sawDark = false;
    let worst = 0;
    am.requestSpecimen('husky');
    await untilIdle(am, (a) => {
      const t0 = performance.now();
      bad = bad || invariant(a, win);
      worst = Math.max(worst, performance.now() - t0);
      if (a.fade === 0) sawDark = true;
    });
    const ok1 = !bad && sawDark && am.store.state.specimen === 'husky';
    report(ok1, 'Chuyển mẫu: mọi khung — UI, picker, nhãn, spec, inspector, nút đều thuộc cùng mẫu đang trong cảnh; commit tại alpha = 0',
      bad || `tối hẳn tại commit: ${sawDark}`);
    // A → B → A giữa lúc fade: huỷ, sáng lại A, không commit
    am.requestSpecimen('ornithopter');
    frames(am, 4); // đang fade ra
    const mid = am.fade;
    am.requestSpecimen('husky'); // chọn lại mẫu đang xem → huỷ
    const n = await untilIdle(am, (a) => { bad = bad || invariant(a, win); });
    report(mid < 1 && mid > 0 && am.store.state.specimen === 'husky' && !bad,
      'Chuyển mẫu: A→B→A giữa lúc fade → huỷ, sáng lại, vẫn là A', `alpha lúc huỷ ${mid.toFixed(2)} · ${n} khung`);
  });

  await guard('Chuyển mẫu: phím S', async () => {
    // 20 lần nhấn S liên tiếp (xen 0–2 khung) + 30 sự kiện lặp phím (repeat = true)
    let bad = '';
    for (let i = 0; i < 20; i++) {
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', bubbles: true }));
      for (let k = 0; k < i % 3; k++) { am.renderOnce(1 / 60); bad = bad || invariant(am, win); }
    }
    for (let i = 0; i < 30; i++) win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', repeat: true, bubbles: true }));
    await untilIdle(am, (a) => { bad = bad || invariant(a, win); });
    const st = am.store.state;
    report(!bad && st.specimenPhase === 'idle' && st.pendingSpecimen === null,
      'Chuyển mẫu: 20 lần nhấn S dồn dập + giữ phím → không kẹt, không khung nào lệch UI', bad || `kết thúc ở ${st.specimen}`);
  });

  await guard('Chuyển mẫu: TROT + explode', async () => {
    if (am.store.state.specimen !== 'husky') {
      am.requestSpecimen('husky');
      await untilIdle(am);
    }
    // Đang TROT mà chuyển mẫu → dừng; husky về bind
    am.store.actions.startMotion();
    frames(am, 90);
    const husky = am.manager.get('husky');
    const wasMoving = husky.rig.ampE > 0.9;
    am.requestSpecimen('ornithopter');
    await untilIdle(am);
    const stopped = am.store.state.mode === 'inspection' && husky.rig.ampE === 0 && husky.rig.phase === 0 && husky.model.motionRoot.rotation.x === 0;
    report(wasMoving && stopped, 'Chuyển mẫu: đang TROT mà chuyển → dừng, mẫu cũ về bind pose', `đang chạy ${wasMoving} · dừng ${stopped}`);
    // Explode được giữ qua cú chuyển
    am.store.actions.setExplode(0.6);
    frames(am, 60);
    am.requestSpecimen('husky');
    await untilIdle(am);
    frames(am, 30);
    const kept = am.store.state.explodeTarget === 0.6 && Math.abs(am.model.explode - 0.6) < 0.02;
    report(kept, 'Chuyển mẫu: explode giữ nguyên (so sánh hai mẫu ở cùng mức nổ)', `target ${am.store.state.explodeTarget} · model ${am.model.explode.toFixed(3)}`);
    am.store.actions.setExplode(0);
    frames(am, 90);
  });

  await guard('Chuyển mẫu: bộ nhớ', async () => {
    const a = mem(am);
    for (let i = 0; i < 50; i++) {
      am.requestSpecimen(am.store.state.specimen === 'husky' ? 'ornithopter' : 'husky');
      await untilIdle(am);
    }
    frames(am, 3);
    const b = mem(am);
    report(b.p === a.p && b.g === a.g && b.t === a.t, 'Chuyển mẫu: 50 lần A↔B — programs / geometries / textures không tăng',
      `program ${a.p}→${b.p} · geometry ${a.g}→${b.g} · texture ${a.t}→${b.t}`);
  });

  await guard('Chuyển mẫu: mất context', async () => {
    const r = am.view.renderer;
    const hidden = am.store.state.specimen === 'husky' ? 'ornithopter' : 'husky';
    r.forceContextLoss();
    await sleep(300);
    const lostState = am.manager.get(hidden).state;
    r.forceContextRestore();
    await sleep(500);
    for (let i = 0; i < 30; i++) am.renderOnce(1 / 60); // app rảnh → warm lại mẫu ẩn
    const again = await waitReady(am);
    const a = mem(am);
    am.requestSpecimen(hidden);
    await untilIdle(am);
    frames(am, 2);
    const b = mem(am);
    report(lostState === 'cpuReady' && again && b.p <= a.p && b.g <= a.g && b.t <= a.t,
      'Chuyển mẫu: mất context → mẫu ẩn về cpuReady, warm lại, chuyển sau đó không upload thêm',
      `trạng thái khi mất ${lostState} · program ${a.p}→${b.p} · geometry ${a.g}→${b.g}`);
  });
  f.remove();

  await guard('Chuyển mẫu: warm lô 1', async () => {
    // Bướm là mẫu ẨN (được warm), cỡ lô ép = 1: vật thể lồng trong vật thể khác (nắp chốt là con của
    // tay đòn linkage) luôn rơi vào lô khác cha — trước khi sửa, đúng ca này sót 1 geometry.
    const x = await load('still&theme=azure&dpr=1&specimen=husky');
    x.am.manager.batch = 1;
    x.am.manager.adaptBatch = false;
    const ok = await waitReady(x.am, 2000);
    const a = mem(x.am);
    x.am.requestSpecimen('ornithopter');
    await untilIdle(x.am);
    frames(x.am, 2);
    const b = mem(x.am);
    report(ok && b.p === a.p && b.g === a.g && b.t === a.t, 'Warm-up: mẫu ẩn warm theo lô 1 vật thể (cả vật thể lồng nhau) → lần vẽ đầu không upload thêm',
      `program ${a.p}→${b.p} · geometry ${a.g}→${b.g} · texture ${a.t}→${b.t}`);
    x.f.remove();
  });

  await guard('Chuyển mẫu: không KHR_parallel', async () => {
    const x = await load('still&theme=azure&dpr=1&noparallel');
    const ok = await waitReady(x.am);
    const a = mem(x.am);
    x.am.requestSpecimen('husky');
    await untilIdle(x.am);
    frames(x.am, 2);
    const b = mem(x.am);
    report(ok && b.p === a.p && b.g === a.g && b.t === a.t, 'Chuyển mẫu (?noparallel — không compileAsync): warm bằng render, lần vẽ đầu không upload thêm',
      `program ${a.p}→${b.p} · geometry ${a.g}→${b.g} · texture ${a.t}→${b.t}`);
    x.f.remove();
  });
}
