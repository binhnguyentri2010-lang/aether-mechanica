// @ts-check
// Benchmark (plan đợt 3 §9) — TÁCH KHỎI selftest: ngưỡng ms phụ thuộc máy nên không trộn vào test đúng/sai.
const q = new URLSearchParams(location.search);
const QUICK = q.has('quick');
const WARM = QUICK ? 60 : 300;
const MEASURE = QUICK ? 240 : 1200;
const REPEAT = QUICK ? 1 : 3;
const SRC = q.get('src') === 'dev' ? '../index.html' : '../dist/aether-mechanica.html';

const tbody = /** @type {HTMLElement} */ (document.querySelector('#out tbody'));
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
/** @type {{ok: boolean|null, name: string, detail: string}[]} */
const results = [];
/** @param {boolean|null} ok @param {string} name @param {string} detail */
function row(ok, name, detail) {
  results.push({ ok, name, detail });
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL';
  a.className = ok === null ? 'info' : ok ? 'pass' : 'fail';
  const b = document.createElement('td');
  b.textContent = name;
  const c = document.createElement('td');
  c.textContent = detail;
  tr.append(a, b, c);
  tbody.appendChild(tr);
}
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {number[]} a @param {number} p */
function pct(a, p) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
const fmt = (/** @type {number[]} */ a) => `p50 ${pct(a, 0.5).toFixed(2)} · p95 ${pct(a, 0.95).toFixed(2)} · p99 ${pct(a, 0.99).toFixed(2)} ms`;

/** @param {string} query */
async function load(query) {
  const f = document.createElement('iframe');
  f.style.width = '1440px';
  f.style.height = '900px';
  f.src = `${SRC}?${query}&t=${Date.now()}`;
  stage.appendChild(f);
  await new Promise((r) => (f.onload = r));
  const win = /** @type {any} */ (f.contentWindow);
  for (let i = 0; i < 400 && !win.__am; i++) await sleep(25);
  const am = win.__am;
  if (win.document.fonts) await win.document.fonts.ready;
  am.layoutOnce();
  return { f, am, win };
}

/**
 * Chờ lượt làm tươi màn hình kế tiếp của iframe → mỗi khung đo được vẽ đúng một lần mỗi vsync như khi dùng thật.
 * (Vẽ dồn liên tục thì hàng đợi lệnh GPU đầy, lần gửi sau bị chặn chờ GPU → "CPU" thực ra là thông lượng GPU.)
 * @param {any} win @returns {Promise<number>}
 */
function nextFrame(win) {
  const asked = performance.now();
  waitingSince = asked;
  return new Promise((r) => win.requestAnimationFrame((/** @type {number} */ ts) => {
    waitingSince = -1;
    if (performance.now() - asked > 1000) stalls++;
    r(ts);
  }));
}
/** Số lần trang bị ẩn trong lúc đo (đổi tab, thu nhỏ) → số đo có đoạn bị hãm, không tin cậy. */
let hiddenDuringRun = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenDuringRun++; });
/** rAF đứng > 1 s dù trang báo "visible" (cửa sổ bị che / khung nhúng không được vẽ) → cũng không tin cậy. */
let stalls = 0;
/** Mốc bắt đầu chờ khung rAF đang treo (−1 = không chờ). */
let waitingSince = -1;
setInterval(() => {
  const s = /** @type {HTMLElement} */ (document.getElementById('summary'));
  if (waitingSince >= 0 && performance.now() - waitingSince > 2000) s.textContent = '⏸ Tạm dừng: trình duyệt không chạy rAF (trang không thật sự hiển thị) — hãy để trang này ở trước mặt';
  else if (s.textContent.startsWith('⏸')) s.textContent = '';
}, 1000);
const interruptions = () => hiddenDuringRun + stalls;
/** Gián đoạn trong đoạn đo đã được xử lý bằng cách bỏ đoạn đó và đo lại / gián đoạn không đo lại được. */
let repaired = 0;
let tainted = 0;
/**
 * Chạy MỘT đoạn đo liền mạch. Trong lúc đo mà trang bị ẩn (cửa sổ khác che, đổi tab) hoặc rAF đứng > 1 s thì
 * bỏ cả đoạn, chờ trang hiện lại rồi đo lại (tối đa 10 lần) → số đo cuối chỉ gồm các đoạn không bị hãm.
 * Máy đang có người dùng vẫn đo được: chỉ cần cửa sổ bench hiện ra đủ lâu cho từng đoạn.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
async function clean(fn) {
  for (let tries = 0; ; tries++) {
    await whenVisible();
    const n0 = interruptions();
    const r = await fn();
    const d = interruptions() - n0;
    if (!d) return r;
    if (tries >= 10) {
      tainted += d;
      return r;
    }
    repaired += d;
    await sleep(500);
  }
}

/** Trang ẩn thì rAF đứng im / bị hãm → chỉ bắt đầu đo khi trang đang được xem. */
function whenVisible() {
  if (!document.hidden) return Promise.resolve();
  return new Promise((r) => {
    const on = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', on);
      r(undefined);
    };
    document.addEventListener('visibilitychange', on);
  });
}

/** Bơm khung (nhường event loop để compileAsync xong) tới khi mọi mẫu dựng + warm xong. @param {any} am */
async function ready(am) {
  for (let i = 0; i < 1500 && !am.manager.allReady(); i++) {
    am.renderOnce(1 / 60);
    await sleep(2);
  }
}

/** GPU timer (nếu có). */
function gpuTimer(/** @type {WebGL2RenderingContext} */ gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  /** @type {WebGLQuery[]} */
  const pending = [];
  /** @type {number[]} */
  const out = [];
  let disjoint = 0;
  return {
    /** @param {() => void} fn */
    wrap(fn) {
      const qq = /** @type {WebGLQuery} */ (gl.createQuery());
      gl.beginQuery(ext.TIME_ELAPSED_EXT, qq);
      fn();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(qq);
    },
    poll() {
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const qq = /** @type {WebGLQuery} */ (pending.shift());
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint++;
        else out.push(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(qq);
      }
    },
    out, get disjoint() { return disjoint; }, get pending() { return pending.length; },
  };
}

/**
 * Một kịch bản: `step(i)` chuẩn bị khung thứ i (xoay camera, di chuột…), rồi renderOnce đo CPU (+ GPU).
 * @param {any} am @param {any} win @param {(i: number) => void} step
 */
async function scenario(am, win, step) {
  const gl = am.view.renderer.getContext();
  /** @type {number[]} */
  const cpu = [];
  /** @type {number[]} */
  const gpu = [];
  let disjoint = 0;
  let hasGpu = true;
  for (let rep = 0; rep < REPEAT; rep++) {
    const r = await clean(() => oneRep(am, win, gl, step));
    cpu.push(...r.cpu);
    if (r.gpu) gpu.push(...r.gpu);
    else hasGpu = false;
    disjoint += r.disjoint;
  }
  return { cpu, gpu: hasGpu ? gpu : null, disjoint };
}

/** Một lần lặp: WARM khung làm nóng rồi MEASURE khung đo. @param {any} am @param {any} win @param {WebGL2RenderingContext} gl @param {(i: number) => void} step */
async function oneRep(am, win, gl, step) {
  /** @type {number[]} */
  const cpu = [];
  const timer = gpuTimer(gl);
  for (let i = 0; i < WARM; i++) {
    await nextFrame(win);
    step(i);
    am.renderOnce(1 / 60);
  }
  for (let i = 0; i < MEASURE; i++) {
    await nextFrame(win);
    step(WARM + i);
    const t0 = performance.now();
    if (timer) timer.wrap(() => am.renderOnce(1 / 60));
    else am.renderOnce(1 / 60);
    cpu.push(performance.now() - t0);
    if (timer && i % 30 === 0) timer.poll();
  }
  if (timer) {
    for (let i = 0; i < 60 && timer.pending; i++) {
      await sleep(16);
      timer.poll();
    }
  }
  return { cpu, gpu: timer ? timer.out : null, disjoint: timer ? timer.disjoint : 0 };
}

async function main() {
  const env = /** @type {HTMLElement} */ (document.getElementById('env'));
  if (document.hidden) env.textContent = 'Đang chờ trang hiển thị — bench chỉ đo khi trang đang được xem…';
  await whenVisible();
  // fullmotion: đo nhánh đầy đủ (fade có khung tối, hiệu ứng nền) dù máy có bật giảm chuyển động
  const { f, am, win } = await load('dpr=1&theme=azure&fullmotion');
  const gl = am.view.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'không rõ';
  /** @type {any} */
  const nav = navigator;
  let power = 'không rõ';
  try {
    if (nav.getBattery) {
      const b = await nav.getBattery();
      power = b.charging ? 'đang cắm sạc' : `pin ${Math.round(b.level * 100)}%`;
    }
  } catch { /* không có Battery API */ }
  env.textContent = `Trình duyệt: ${navigator.userAgent}\nGPU: ${gpuName} · MSAA ${gl.getContextAttributes().antialias} · DPR ${am.view.dpr}\n` +
    `Nguồn điện: ${power} · nguồn ${SRC} · ${WARM} khung warm + ${MEASURE} khung đo × ${REPEAT} lần` +
    ' · chuyển động đầy đủ (?fullmotion) · mỗi khung một nhịp rAF';

  await ready(am);
  // Từ đây chỉ bench vẽ: tắt vòng lặp riêng của app, nếu không mỗi vsync có hai lần vẽ
  am.scheduler.stop();
  // Lần chuyển ĐẦU sau khi tải (mẫu kia dựng + warm nền xong) — mọi khung kể cả khung tối < 50 ms
  const firstSwitch = await switchFrames(am, win, 1);

  const canvas = win.document.getElementById('gl');
  for (const id of ['ornithopter', 'husky']) {
    if (am.store.state.specimen !== id) {
      am.requestSpecimen(id);
      for (let i = 0; i < 200 && am.store.state.specimenPhase !== 'idle'; i++) am.renderOnce(1 / 60);
    }
    am.store.actions.setView('iso');
    for (let i = 0; i < 80; i++) am.renderOnce(1 / 60);
    am.renderOnce(1 / 60);
    const info = am.view.renderer.info.render;
    const budget = id === 'husky' ? { calls: 200, tris: 250000 } : { calls: 250, tris: 400000 };
    row(info.calls < budget.calls && info.triangles < budget.tris, `${id}: ngân sách pass chính`, `${info.calls} draw call (< ${budget.calls}) · ${info.triangles} tam giác (< ${budget.tris})`);

    /** @type {[string, (i: number) => void, number][]} */
    const list = [
      ['đứng yên', () => {}, 3.5],
      ['xoay camera', () => {
        const c = am.cam.controls;
        const off = am.view.camera.position.clone().sub(c.target);
        const cs = Math.cos(0.01), sn = Math.sin(0.01);
        const x = off.x * cs + off.z * sn, z = -off.x * sn + off.z * cs;
        off.x = x; off.z = z;
        am.view.camera.position.copy(c.target).add(off);
      }, 3.5],
      ['hover', (i) => {
        canvas.dispatchEvent(new win.PointerEvent('pointermove', { pointerType: 'mouse', clientX: 520 + ((i * 7) % 400), clientY: 330 + ((i * 3) % 240), bubbles: true }));
      }, 3.5],
    ];
    for (const [name, step, lim] of list) {
      const r = await scenario(am, win, step);
      report(id, name, r, lim);
    }
    // Chuyển động (bay / nước kiệu)
    am.store.actions.startMotion();
    for (let i = 0; i < 90; i++) am.renderOnce(1 / 60);
    const rm = await scenario(am, win, () => {});
    report(id, am.def.labels.status.toLowerCase(), rm, 4);
    am.store.actions.stopMotion();
    for (let i = 0; i < 120; i++) am.renderOnce(1 / 60);
  }

  // 30 lần A↔B sau warm-up
  const many = await switchFrames(am, win, 30);
  // Sau khi mất context: mẫu ẩn warm lại, rồi chuyển
  const r = am.view.renderer;
  r.forceContextLoss();
  await sleep(300);
  r.forceContextRestore();
  await sleep(500);
  for (let i = 0; i < 30; i++) am.renderOnce(1 / 60);
  await ready(am);
  const afterCtx = await switchFrames(am, win, 1);
  const worst = Math.max(firstSwitch.max, many.max, afterCtx.max);
  // Khoảng cách rAF = thứ người dùng thấy (gồm cả phần GPU)
  const worstGap = Math.max(firstSwitch.gap, many.gap, afterCtx.gap);
  row(worst < 50 && worstGap < 50, 'Chuyển mẫu: mọi khung kể cả khung tối < 50 ms',
    `lần đầu sau tải: tối đa ${firstSwitch.max.toFixed(1)} ms · 30 lần A↔B: tối đa ${many.max.toFixed(1)} ms (${fmt(many.all)}) · sau mất context: tối đa ${afterCtx.max.toFixed(1)} ms` +
    ` · khoảng rAF dài nhất ${worstGap.toFixed(1)} ms`);

  // Khung rơi: chỉ có nghĩa khi trang hiển thị thật (rAF chạy). Vòng lặp của app chạy lại, bench chỉ đứng xem.
  am.scheduler.start();
  if (document.hidden) row(null, 'Khung rơi (rAF)', 'không đo được — trang đang ẩn, rAF không chạy');
  else {
    const iv = await clean(() => rafIntervals(am, 5000));
    const med = pct(iv, 0.5);
    const drops = iv.filter((x) => x > 1.5 * med).length;
    // rAF < 30 Hz = trình duyệt đang hãm trang (khung không hiển thị) → đếm "khung rơi" trên nhịp đó là vô nghĩa
    if (iv.length < 100 || med > 34) row(null, 'Khung rơi (rAF)', `không đo được — rAF chỉ chạy ${iv.length} lần trong 5 s (chu kỳ ${med.toFixed(1)} ms): trang bị trình duyệt hãm`);
    else row(drops / iv.length <= 0.01, 'Khung rơi (rAF, 5 s xoay tự động)', `${drops}/${iv.length} khung > 1.5 × chu kỳ ${med.toFixed(1)} ms (${((drops / iv.length) * 100).toFixed(2)}%)`);
  }
  if (tainted) row(false, 'Đoạn đo liền mạch (không bị ẩn / hãm)',
    `${tainted} lần gián đoạn không đo lại được (bị ẩn quá 10 lần liên tiếp) — hãy để cửa sổ này ở trước mặt rồi chạy lại`);
  else row(true, 'Đoạn đo liền mạch (không bị ẩn / hãm)', repaired
    ? `trang bị ẩn / rAF đứng ${repaired} lần — mỗi đoạn bị ảnh hưởng đã bị bỏ và đo lại; số đo trên chỉ gồm đoạn liền mạch`
    : 'không lần nào bị ẩn hay hãm');
  f.remove();

  const fails = results.filter((x) => x.ok === false).length;
  const pass = results.filter((x) => x.ok === true).length;
  /** @type {HTMLElement} */ (document.getElementById('summary')).textContent = `${pass} PASS · ${fails} FAIL`;
  /** @type {any} */ (window).__bench = { done: true, pass, fails, results, env: env.textContent, hiddenDuringRun, stalls, repaired, tainted };
  await save();
}

/** Máy chủ dev (tools/serve.py) lưu kết quả ra tests/bench-result.json; mở bằng máy chủ khác thì lệnh này chỉ thất bại im lặng. */
async function save() {
  try {
    await fetch('/__bench/result.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ .../** @type {any} */ (window).__bench, at: new Date().toISOString() }),
    });
  } catch { /* không lưu được thì thôi — bảng trên trang vẫn còn */ }
}

/** @param {string} id @param {string} name @param {{cpu: number[], gpu: number[]|null, disjoint: number}} r @param {number} lim */
function report(id, name, r, lim) {
  const c95 = pct(r.cpu, 0.95);
  row(c95 <= lim, `${id}: ${name} — CPU`, `${fmt(r.cpu)} (ngưỡng p95 ≤ ${lim} ms, ${r.cpu.length} khung)`);
  if (!r.gpu) row(null, `${id}: ${name} — GPU`, 'GPU: không đo được (trình duyệt không cấp EXT_disjoint_timer_query_webgl2)');
  else if (!r.gpu.length) row(null, `${id}: ${name} — GPU`, `GPU: không có mẫu hợp lệ (${r.disjoint} mẫu bị GPU_DISJOINT loại)`);
  else row(pct(r.gpu, 0.95) <= 8, `${id}: ${name} — GPU`, `${fmt(r.gpu)} (ngưỡng p95 ≤ 8 ms, ${r.gpu.length} mẫu, ${r.disjoint} bị loại)`);
}

/**
 * Đo mọi khung trong n cú chuyển mẫu (kể cả khung tối lúc commit): thời gian vẽ của khung và khoảng rAF tới
 * khung kế (khoảng đầu tiên của mỗi cú chuyển bị bỏ vì nó gồm cả thời gian chờ ngoài cú chuyển).
 * @param {any} am @param {any} win @param {number} n
 */
async function switchFrames(am, win, n) {
  /** @type {number[]} */
  const all = [];
  let gap = 0;
  for (let k = 0; k < n; k++) {
    const r = await clean(() => oneSwitch(am, win));
    all.push(...r.all);
    gap = Math.max(gap, r.gap);
  }
  return { all, max: Math.max(...all), gap };
}

/** Một cú chuyển mẫu, đo mọi khung tới khi xong. @param {any} am @param {any} win */
async function oneSwitch(am, win) {
  /** @type {number[]} */
  const all = [];
  let gap = 0;
  for (let i = 0; i < 20; i++) {
    await nextFrame(win);
    am.renderOnce(1 / 60);
  }
  const target = am.store.state.specimen === 'husky' ? 'ornithopter' : 'husky';
  am.requestSpecimen(target);
  let i = 0;
  let last = -1;
  do {
    const ts = await nextFrame(win);
    if (last >= 0) gap = Math.max(gap, ts - last);
    last = ts;
    const t0 = performance.now();
    am.renderOnce(1 / 60);
    all.push(performance.now() - t0);
    i++;
  } while ((am.store.state.specimenPhase !== 'idle' || i < 2) && i < 400);
  return { all, gap };
}

/** Khoảng cách rAF thật trong lúc autoOrbit chạy. @param {any} am @param {number} ms */
function rafIntervals(am, ms) {
  return new Promise((resolve) => {
    /** @type {number[]} */
    const iv = [];
    am.store.actions.toggleAutoOrbit();
    const win = am.view.renderer.domElement.ownerDocument.defaultView;
    let last = -1;
    const t0 = performance.now();
    const tick = (/** @type {number} */ ts) => {
      if (last >= 0) iv.push(ts - last);
      last = ts;
      if (performance.now() - t0 < ms) win.requestAnimationFrame(tick);
      else {
        am.store.actions.toggleAutoOrbit();
        resolve(iv);
      }
    };
    win.requestAnimationFrame(tick);
  });
}

main().catch((e) => {
  stage.replaceChildren(); // gỡ app đang che bảng kết quả
  row(false, 'Bench lỗi', String(e && e.stack || e).slice(0, 500));
  /** @type {any} */ (window).__bench = { done: true, error: String(e), results };
  save();
});
