// @ts-check
// Đo TÁCH chi phí mỗi khung để biết tối ưu vào đâu (bench chỉ nói ĐẠT/KHÔNG). Viết sau khi bench trên Edge
// (GPU Intel Iris Xe) cho CPU p95 12–20 ms: cần biết phần nào là JS logic, phần nào là gửi lệnh vẽ, phần nào
// là bố trí nhãn, phần nào GPU tô điểm ảnh — so các cấu hình khác nhau đúng MỘT yếu tố.
const WARM = 120;
const MEASURE = 600;
const SRC = '../dist/aether-mechanica.html';

const out = /** @type {HTMLElement} */ (document.getElementById('out'));
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const log = (/** @type {string} */ s) => { out.textContent += s + '\n'; };
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {number[]} a */
function stat(a) {
  const s = a.slice().sort((x, y) => x - y);
  const at = (/** @type {number} */ p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) };
}

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
  for (let i = 0; i < 1500 && !am.manager.allReady(); i++) {
    am.renderOnce(1 / 60);
    await sleep(2);
  }
  am.scheduler.stop(); // chỉ trang đo vẽ, một lần mỗi nhịp rAF
  return { f, am, win };
}

/**
 * Bọc MỌI hàm của context WebGL (và các extension three dùng) để cộng thời gian theo tên lệnh — tìm lệnh nào
 * chặn chờ tiến trình GPU. performance.now() bị làm thô (~0.1 ms, có nhiễu) nên chỉ tin TỔNG trên nhiều lần gọi.
 * @param {any} gl @param {() => boolean} on @returns {Map<string, {n: number, ms: number, max: number}>}
 */
function timeGl(gl, on) {
  /** @type {Map<string, {n: number, ms: number, max: number}>} */
  const stats = new Map();
  /** @param {any} obj @param {string} prefix */
  const wrap = (obj, prefix) => {
    for (let p = Object.getPrototypeOf(obj); p && p !== Object.prototype; p = Object.getPrototypeOf(p))
      for (const name of Object.getOwnPropertyNames(p)) {
        const d = Object.getOwnPropertyDescriptor(p, name);
        if (!d || typeof d.value !== 'function' || name === 'constructor' || Object.prototype.hasOwnProperty.call(obj, name)) continue;
        const orig = d.value;
        const key = prefix + name;
        obj[name] = function (/** @type {any[]} */ ...args) {
          if (!on()) return orig.apply(obj, args);
          const t = performance.now();
          const r = orig.apply(obj, args);
          const dt = performance.now() - t;
          let s = stats.get(key);
          if (!s) stats.set(key, (s = { n: 0, ms: 0, max: 0 }));
          s.n++; s.ms += dt; if (dt > s.max) s.max = dt;
          return r;
        };
      }
  };
  for (const e of ['WEBGL_multi_draw', 'ANGLE_instanced_arrays', 'OES_vertex_array_object']) {
    const ext = gl.getExtension(e);
    if (ext) wrap(ext, e + '.');
  }
  wrap(gl, '');
  return stats;
}

/**
 * @param {string} label @param {string} query
 * @param {(am: any) => void} [setup] đổi đúng một yếu tố trước khi đo
 * @param {boolean} [glTiming] đo thêm thời gian từng lệnh WebGL
 */
async function measure(label, query, setup, glTiming = false) {
  const { f, am, win } = await load(query);
  if (setup) setup(am);
  const view = am.view;
  const gl = /** @type {WebGL2RenderingContext} */ (view.renderer.getContext());
  let rMs = 0, aMs = 0, measuring = false;
  const glStats = glTiming ? timeGl(gl, () => measuring) : null;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  /** @type {WebGLQuery[]} */
  const pending = [];
  /** @type {number[]} */
  const gpu = [];
  const poll = () => {
    while (ext && pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = /** @type {WebGLQuery} */ (pending.shift());
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  };
  // Bọc đúng hai lời gọi trong frame(): view.render() và annotations.update() (ghi đè trên chính đối tượng)
  const render0 = view.render.bind(view);
  view.render = () => {
    const t = performance.now();
    /** @type {WebGLQuery|null} */
    let q = null;
    if (ext && measuring) {
      q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    }
    render0();
    if (q) {
      gl.endQuery(/** @type {any} */ (ext).TIME_ELAPSED_EXT);
      pending.push(q);
    }
    rMs = performance.now() - t;
  };
  const ann = am.annotations;
  const update0 = ann.update.bind(ann);
  ann.update = (/** @type {number} */ e) => {
    const t = performance.now();
    const r = update0(e);
    aMs = performance.now() - t;
    return r;
  };
  const cam = am.view.camera;
  const ctl = am.cam.controls;
  const rotate = () => {
    const ox = cam.position.x - ctl.target.x, oz = cam.position.z - ctl.target.z;
    const c = Math.cos(0.01), s = Math.sin(0.01);
    cam.position.x = ctl.target.x + ox * c + oz * s;
    cam.position.z = ctl.target.z - ox * s + oz * c;
  };
  /** @type {number[]} */ const tot = [];
  /** @type {number[]} */ const ren = [];
  /** @type {number[]} */ const anno = [];
  /** @type {number[]} */ const logic = [];
  /** @type {number[]} */ const gap = [];
  let last = -1;
  for (let i = 0; i < WARM + MEASURE; i++) {
    const ts = await new Promise((r) => win.requestAnimationFrame(r));
    measuring = i >= WARM;
    rotate();
    rMs = aMs = 0;
    const t0 = performance.now();
    am.renderOnce(1 / 60);
    const t = performance.now() - t0;
    if (measuring) {
      tot.push(t); ren.push(rMs); anno.push(aMs); logic.push(t - rMs - aMs);
      if (last >= 0) gap.push(/** @type {number} */ (ts) - last);
    }
    last = /** @type {number} */ (ts);
    if (i % 30 === 0) poll();
  }
  for (let i = 0; i < 60 && pending.length; i++) {
    await sleep(16);
    poll();
  }
  const info = view.renderer.info.render;
  const r = {
    label, query,
    canvas: [view.renderer.domElement.width, view.renderer.domElement.height], msaa: gl.getContextAttributes()?.antialias,
    calls: info.calls, tris: info.triangles,
    total: stat(tot), render: stat(ren), annotations: stat(anno), logic: stat(logic),
    gpu: gpu.length ? stat(gpu) : null, rafGap: stat(gap),
    /** Lệnh WebGL tốn nhiều nhất: ms mỗi khung, số lần mỗi khung, lần dài nhất. @type {any[]} */
    gl: glStats ? [...glStats.entries()].map(([k, s]) => ({ k, msPerFrame: +(s.ms / MEASURE).toFixed(3), perFrame: +(s.n / MEASURE).toFixed(1), max: +s.max.toFixed(2) }))
      .sort((a, b) => b.msPerFrame - a.msPerFrame).slice(0, 14) : null,
  };
  f.remove();
  if (r.gl) log('  WebGL: ' + r.gl.map((x) => `${x.k} ${x.msPerFrame}ms/${x.perFrame}× (max ${x.max})`).join(' · '));
  log(`${label}  [${r.canvas.join('×')} MSAA ${r.msaa} · ${r.calls} draw · ${r.tris} tam giác]\n` +
    `  tổng ${r.total.p50}/${r.total.p95} · render ${r.render.p50}/${r.render.p95} · nhãn ${r.annotations.p50}/${r.annotations.p95}` +
    ` · logic ${r.logic.p50}/${r.logic.p95} · GPU ${r.gpu ? `${r.gpu.p50}/${r.gpu.p95}` : '—'} · nhịp rAF ${r.rafGap.p50}/${r.rafGap.p95} ms (p50/p95)`);
  return r;
}

async function main() {
  const base = 'dpr=1&theme=azure&fullmotion';
  /** @type {any[]} */
  const rows = [];
  // Môi trường
  {
    const { f, am } = await load(base);
    const gl = am.view.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    /** @type {any} */ const nav = navigator;
    let power = 'không rõ';
    try { const b = await nav.getBattery(); power = b.charging ? 'đang cắm sạc' : `pin ${Math.round(b.level * 100)}%`; } catch { /* không có Battery API */ }
    rows.push({ env: { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'không rõ', ua: navigator.userAgent, power, dpr: devicePixelRatio } });
    log(`GPU: ${rows[0].env.gpu}\nTrình duyệt: ${navigator.userAgent}\nNguồn: ${power} · devicePixelRatio ${devicePixelRatio}\n`);
    f.remove();
  }
  const mode = new URLSearchParams(location.search).get('profile');
  if (mode === 'gl') {
    // Thời gian từng lệnh WebGL: tìm lệnh chặn chờ. Cảnh rỗng = chi phí cố định của một khung.
    rows.push(await measure('G1. Bướm — vẽ theo lô', base, undefined, true));
    rows.push(await measure('G2. Bướm — từng mesh', base + '&nobatch', undefined, true));
    rows.push(await measure('G3. Cảnh rỗng', base, (am) => { for (const o of am.view.scene.children) if (!o.isLight) o.visible = false; }, true));
    await finish(rows);
    return;
  }
  // A/B vẽ theo lô (mặc định) ↔ từng mesh riêng (?nobatch); thêm ?profile=full cho các cấu hình tách yếu tố cũ
  rows.push(await measure('1. Bướm — vẽ theo lô', base));
  rows.push(await measure('2. Bướm — từng mesh (?nobatch)', base + '&nobatch'));
  rows.push(await measure('3. Husky — vẽ theo lô', base + '&specimen=husky'));
  rows.push(await measure('4. Husky — từng mesh (?nobatch)', base + '&specimen=husky&nobatch'));
  rows.push(await measure('5. Ẩn model (chỉ nền + blueprint)', base, (am) => { am.model.root.visible = false; }));
  if (mode === 'full') {
    rows.push(await measure('6. Tắt MSAA', base + '&aa=0'));
    rows.push(await measure('7. Canvas 1/4 điểm ảnh, tắt MSAA', 'dpr=0.5&theme=azure&fullmotion&aa=0'));
    rows.push(await measure('8. Ẩn blueprint 3D', base, (am) => { am.blueprint.group.visible = false; }));
  }
  await finish(rows);
}

/** @param {any[]} rows */
async function finish(rows) {
  log('Xong.');
  /** @type {any} */ (window).__profile = { done: true, rows };
  try {
    await fetch('/__bench/profile.json', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at: new Date().toISOString(), rows }),
    });
  } catch { /* chỉ lưu được khi mở qua tools/serve.py */ }
}

main().catch((e) => {
  log('LỖI: ' + String(e && e.stack || e));
  fetch('/__bench/profile.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(e) }) }).catch(() => {});
});
