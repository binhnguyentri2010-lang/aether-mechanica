// @ts-check
// Điều khiển app trong iframe cho selftest và chụp golden. Dùng chung để ảnh golden và ảnh so sánh
// được tạo bằng ĐÚNG một quy trình đặt trạng thái.
//
// App chạy trong iframe kích thước cố định (iframe quyết định viewport + media query). Gọi thẳng
// __am.renderOnce() thay vì chờ rAF: khung trình duyệt tích hợp bị ẩn thì rAF đứng im.

export const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cấu hình ảnh golden: DPR ép 1 (kích thước canvas cố định) và TẮT MSAA (aa=0) để so được TỪNG BYTE:
 * có MSAA, hai context giống hệt nhau trên máy này (ANGLE/D3D11) vẫn lệch vài chục byte.
 * (Lệch lớn 571 ô ở golden đầu tiên KHÔNG do MSAA mà do transition CSS của HUD — xem loadApp.)
 */
export const GOLDEN_QUERY = 'still&theme=azure&dpr=1&aa=0';

/** Bản build ĐÔNG CỨNG trước refactor P1 — mốc so A/B, chụp golden (xem tests/reference/). */
export const REFERENCE_PAGE = './reference/pre-p1.html';

/**
 * @param {HTMLElement} stage @param {number} w @param {number} h @param {string} [query]
 * @param {string} [page] trang app, tương đối với tests/
 */
export async function loadApp(stage, w, h, query = GOLDEN_QUERY, page = '../index.html') {
  const f = document.createElement('iframe');
  f.style.width = w + 'px';
  f.style.height = h + 'px';
  f.style.border = '0';
  f.src = page + '?' + query + '&t=' + Date.now();
  stage.appendChild(f);
  await new Promise((r) => (f.onload = r));
  const win = /** @type {any} */ (f.contentWindow);
  for (let i = 0; i < 200 && !win.__am; i++) await sleep(25);
  const am = win.__am;
  // CHỜ FONT trước khi đo bố cục: font nạp muộn làm khối HUD đổi cỡ → vùng an toàn → khung hình camera
  // lệch dưới 1 px. Đã gặp thật: không chờ thì ảnh golden lệch 3–571 ô giữa hai lần tải; chờ thì 0.
  if (win.document.fonts) await win.document.fonts.ready;
  // TẮT transition/animation CSS trước khi đo bố cục. .hud có transform translateY(4px) → none trong
  // 700 ms lúc intro, và getBoundingClientRect() TÍNH CẢ transform → vùng an toàn (và khung camera)
  // phụ thuộc thời điểm đo. Trang ẩn thì transition đứng yên ở +4 px; một lần relayout muộn
  // (ResizeObserver) rơi vào lúc khác làm ảnh golden dịch đúng 4 px — đã gặp thật.
  const noAnim = win.document.createElement('style');
  noAnim.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  win.document.head.appendChild(noAnim);
  void win.document.body.offsetHeight;
  am.layoutOnce();
  frames(am, 5);
  return { f, am, win };
}

/** @param {any} am @param {number} n */
export const frames = (am, n, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) am.renderOnce(dt);
};

/** @param {any} am @param {string} v */
export function setView(am, v) {
  am.store.actions.setView(v);
  frames(am, 64);
}

/** @param {any} am @param {number} e */
export function setExplodeNow(am, e) {
  am.store.actions.setExplode(e);
  am.explode.snap(e);
  frames(am, 6);
}

/**
 * Trạng thái golden của một mẫu: 2 chủ đề × 4 view × e ∈ {0, 1} = 16 ảnh.
 * @param {string} [specimen]
 */
export function goldenStates(specimen = 'ornithopter') {
  /** @type {{theme: 'azure'|'obsidian', view: string, e: number, name: string, specimen: string}[]} */
  const out = [];
  for (const theme of /** @type {('azure'|'obsidian')[]} */ (['azure', 'obsidian']))
    for (const view of ['iso', 'plan', 'front', 'profile'])
      for (const e of [0, 1]) out.push({ theme, view, e, specimen, name: `${specimen}-${theme}-${view}-e${e}.png` });
  return out;
}

/** Mẫu có ảnh golden (bướm: 16 ảnh mốc P1 · husky: thêm từ đợt 3). */
export const GOLDEN_SPECIMENS = ['ornithopter', 'husky'];

/**
 * Đặt app vào một trạng thái golden theo quy trình cố định rồi render một khung.
 * @param {any} am @param {{theme: string, view: string, e: number}} s
 */
export function applyGoldenState(am, s) {
  if (am.store.state.theme !== s.theme) {
    am.store.actions.setTheme(s.theme);
    frames(am, 30);
  }
  setView(am, s.view);
  setExplodeNow(am, s.e);
  frames(am, 6);
  am.renderOnce(1 / 60);
}

/**
 * Chép khung WebGL vừa vẽ sang 2D và lấy pixel. Phải gọi NGAY sau render (cùng một tác vụ):
 * preserveDrawingBuffer = false nên sau đó bộ đệm có thể đã bị xoá.
 * @param {HTMLCanvasElement} gl
 */
export function grab(gl) {
  const c = document.createElement('canvas');
  c.width = gl.width;
  c.height = gl.height;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  g.drawImage(gl, 0, 0);
  return { canvas: c, data: g.getImageData(0, 0, c.width, c.height) };
}

/**
 * Nạp PNG thành pixel. Dùng fetch + createImageBitmap, KHÔNG dùng <img>.decode(): khi trang bị ẩn
 * (khung trình duyệt tích hợp đang đóng), decode() không bao giờ trả kết quả — đã gặp thật.
 * @param {string} url @returns {Promise<ImageData>}
 */
async function loadImageData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return g.getImageData(0, 0, c.width, c.height);
}

/**
 * Render lại mọi trạng thái golden (16 ảnh mỗi mẫu) và so với tests/golden/*.png.
 * Golden gắn với DPR lúc chụp: khác kích thước canvas → báo "không so được", không tính FAIL oan.
 * @param {HTMLElement} stage @param {string[]} [specimens]
 */
export async function compareGoldens(stage, specimens = GOLDEN_SPECIMENS) {
  const all = { pass: 0, fail: 0, skipped: 0, worstMean: 0, worstBlocks: 0, rows: /** @type {string[]} */ ([]), summary: '', sameEnv: false, total: 0 };
  /** @type {string[]} */
  const parts = [];
  for (const sp of specimens) {
    const r = await compareGoldensOf(stage, sp);
    all.pass += r.pass;
    all.fail += r.fail;
    all.skipped += r.skipped;
    all.total += 16;
    all.worstMean = Math.max(all.worstMean, r.worstMean);
    all.worstBlocks = Math.max(all.worstBlocks, r.worstBlocks);
    all.rows.push(...r.rows);
    all.sameEnv = r.sameEnv;
    parts.push(r.summary);
  }
  all.summary = parts.join(' | ');
  return all;
}

/** @param {HTMLElement} stage @param {string} specimen */
async function compareGoldensOf(stage, specimen) {
  const { f, am, win } = await loadApp(stage, 1440, 900, GOLDEN_QUERY + '&specimen=' + specimen);
  const gl = win.document.getElementById('gl');
  // Ngưỡng theo MÔI TRƯỜNG: cùng GPU + cùng phiên bản trình duyệt như lúc chụp → chặt (cổng P1: TB ≤ 1,
  // 0 ô lệch). Khác (vd. ứng dụng tự cập nhật) → dung sai nhiễu raster hoá: đo thật sau một lần cập nhật
  // Claude desktop 2.2553.1 → .13, code KHÔNG đổi (A/B 0 byte) mà golden lệch TB ≤ 0.032, ≤ 58/81 000 ô,
  // toàn ở điểm ảnh mép nét mảnh. Dung sai TB ≤ 0.1, ≤ 100 ô vẫn bắt mọi thay đổi thật (dịch khung 1 px
  // đã cho hàng nghìn ô).
  const envNow = renderEnv(am, win);
  /** @type {any} */
  let meta0 = null;
  try {
    meta0 = await (await fetch('./golden/meta.json?t=' + Date.now())).json();
  } catch { /* golden cũ không có meta */ }
  const sameEnv = !!meta0 && meta0.env && meta0.env.renderer === envNow.renderer && meta0.env.userAgent === envNow.userAgent;
  const tol = sameEnv ? { mean: 1, blocks: 0 } : { mean: 0.1, blocks: 100 };
  /** @type {string[]} */
  const rows = [];
  let pass = 0, fail = 0, skipped = 0, worstMean = 0, worstBlocks = 0;
  for (const s of goldenStates(specimen)) {
    applyGoldenState(am, s);
    const cur = grab(gl).data;
    let ref;
    try {
      ref = await loadImageData('./golden/' + s.name + '?t=' + Date.now());
    } catch {
      rows.push('THIẾU ' + s.name);
      fail++;
      continue;
    }
    const d = diffImages(cur, ref);
    if (d.sizeMismatch) {
      rows.push(`KHÔNG SO ĐƯỢC ${s.name}: canvas ${cur.width}×${cur.height} ≠ golden ${ref.width}×${ref.height} (DPR khác lúc chụp)`);
      skipped++;
      continue;
    }
    worstMean = Math.max(worstMean, d.mean);
    worstBlocks = Math.max(worstBlocks, d.badBlocks);
    const ok = d.mean <= tol.mean && d.badBlocks <= tol.blocks;
    if (ok) pass++;
    else fail++;
    rows.push(`${ok ? 'PASS' : 'FAIL'} ${s.name}: byte khác ${d.bytes} · lệch TB ${d.mean.toFixed(3)} · ô 4×4 lệch > 8: ${d.badBlocks}` +
      (ok ? '' : ` (vùng ${d.bbox}) · việc nền: ${am.manager.allReady() ? 'xong' : 'đang chạy'}`));
  }
  f.remove();
  // In cả môi trường LÚC CHỤP và HIỆN TẠI: một lần chạy từng lệch đều khắp (bướm 59, husky 159 ô) rồi chạy
  // lại khớp 0–1 ô, code không đổi → nghi GPU/trình duyệt đổi giữa chừng (máy có Intel + NVIDIA). Có hai dòng
  // này thì lần sau thấy ngay có phải do môi trường không.
  /** @param {any} e */
  const envTxt = (e) => e ? `${String(e.renderer).replace(/^ANGLE \((\w+), ([^(]+?) \(.*$/, '$1 $2')} · ${String(e.userAgent).replace(/.*Claude\//, 'Claude/').slice(0, 40)}` : 'không có meta.json';
  const tier = sameEnv ? 'ngưỡng chặt (cùng môi trường lúc chụp)'
    : `ngưỡng nhiễu TB ≤ ${tol.mean}, ≤ ${tol.blocks} ô (môi trường KHÁC — lúc chụp: ${envTxt(meta0 && meta0.env)} · hiện tại: ${envTxt(envNow)})`;
  const summary = `${specimen}: ${pass} khớp · ${fail} lệch · ${skipped} không so được · lệch TB lớn nhất ${worstMean.toFixed(3)} · ô xấu nhiều nhất ${worstBlocks} · ${tier}`;
  return { pass, fail, skipped, worstMean, worstBlocks, rows, summary, env: envNow, meta: meta0, sameEnv };
}

/**
 * So hai ảnh: sai khác trung bình (thang 0–255) và số ô 4×4 lệch trung bình > ngưỡng, cùng số byte khác.
 *
 * So trên giá trị PREMULTIPLIED (RGB × alpha) + kênh alpha — tức phần thật sự hiện lên màn hình.
 * getImageData trả RGB đã CHIA alpha: một pixel alpha = 1/255 lệch ±1 thành lệch RGB tới 64, nên so RGB
 * thô biến nhiễu vô hình ở mép nét mờ thành "ô xấu" (bản đầu của hàm này mắc đúng lỗi đó).
 * @param {ImageData} a @param {ImageData} b @param {number} blockLimit
 */
export function diffImages(a, b, blockLimit = 8) {
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: true, mean: Infinity, badBlocks: Infinity, bytes: Infinity, bbox: '' };
  const W = a.width, H = a.height, A = a.data, B = b.data;
  let sum = 0;
  let badBlocks = 0;
  let bytes = 0;
  // Khung bao các ô lệch — để biết lệch nằm ở ĐÂU (một cụm = một vật thể khác; rải khắp = khung hình dịch)
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) bytes++;
  for (let by = 0; by < H; by += 4)
    for (let bx = 0; bx < W; bx += 4) {
      let bs = 0, n = 0;
      for (let y = by; y < Math.min(by + 4, H); y++)
        for (let x = bx; x < Math.min(bx + 4, W); x++) {
          const i = (y * W + x) * 4;
          const ka = A[i + 3] / 255, kb = B[i + 3] / 255;
          const d = (Math.abs(A[i] * ka - B[i] * kb) + Math.abs(A[i + 1] * ka - B[i + 1] * kb) +
            Math.abs(A[i + 2] * ka - B[i + 2] * kb) + Math.abs(A[i + 3] - B[i + 3])) / 4;
          bs += d;
          n++;
        }
      sum += bs;
      if (bs / n > blockLimit) {
        badBlocks++;
        bx0 = Math.min(bx0, bx); by0 = Math.min(by0, by); bx1 = Math.max(bx1, bx + 4); by1 = Math.max(by1, by + 4);
      }
    }
  const bbox = badBlocks ? `x ${bx0}–${bx1}, y ${by0}–${by1}` : '';
  return { sizeMismatch: false, mean: sum / (W * H), badBlocks, bytes, bbox };
}

/**
 * A/B trực tiếp: app hiện tại và bản tham chiếu chạy CÙNG phiên, cùng GPU, cùng cấu hình, qua đủ 16
 * trạng thái golden. Không phụ thuộc ảnh đã chụp → không bị ảnh hưởng khi driver/GPU đổi.
 * @param {HTMLElement} stage
 */
export async function compareWithReference(stage) {
  const cur = await loadApp(stage, 1440, 900);
  const ref = await loadApp(stage, 1440, 900, GOLDEN_QUERY, REFERENCE_PAGE);
  let pass = 0, fail = 0, bytes = 0, worstMean = 0, worstBlocks = 0;
  /** @type {string[]} */
  const rows = [];
  for (const s of goldenStates()) {
    applyGoldenState(cur.am, s);
    const a = grab(cur.win.document.getElementById('gl')).data;
    applyGoldenState(ref.am, s);
    const b = grab(ref.win.document.getElementById('gl')).data;
    const d = diffImages(a, b);
    const ok = !d.sizeMismatch && d.mean <= 1 && d.badBlocks === 0;
    if (ok) pass++;
    else fail++;
    bytes += d.bytes;
    worstMean = Math.max(worstMean, d.mean);
    worstBlocks = Math.max(worstBlocks, d.badBlocks);
    rows.push(`${ok ? 'PASS' : 'FAIL'} ${s.name}: byte khác ${d.bytes} · lệch TB ${d.mean.toFixed(3)} · ô xấu ${d.badBlocks}`);
  }
  cur.f.remove();
  ref.f.remove();
  const summary = `A/B: ${pass}/16 trạng thái khớp · tổng byte khác ${bytes} · lệch TB lớn nhất ${worstMean.toFixed(3)} · ô xấu nhiều nhất ${worstBlocks}`;
  return { pass, fail, bytes, rows, summary };
}

/** Thông tin GPU/trình duyệt để ghi kèm golden (đổi GPU → biết ngay vì sao ảnh lệch). @param {any} am @param {Window} win */
export function renderEnv(am, win) {
  const gl = am.view.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'không rõ',
    antialias: gl.getContextAttributes().antialias,
    dpr: am.view.dpr,
    canvas: [am.view.renderer.domElement.width, am.view.renderer.domElement.height],
    userAgent: win.navigator.userAgent,
    // DPR của MÁY (khác DPR vẽ = 1 bị ép): khung trình duyệt đổi 1 ↔ 1.25 tuỳ đang ẩn/hiện. Chỉ để chẩn đoán —
    // vùng an toàn đã làm tròn nên ảnh không còn phụ thuộc nó (tests/dprcheck.html).
    hostDpr: win.devicePixelRatio,
  };
}
