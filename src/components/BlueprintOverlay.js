// @ts-check
// Hình học kỹ thuật (plan §14). Opacity 5–25%, nét 1px, không bao giờ tranh với model.
//
// World-space: nằm trên mặt phẳng dưới specimen → phối cảnh thành elip như bản vẽ tham chiếu.
// Screen-space: SVG cố định — lưới (parallax nhẹ), khung viewport, góc, thước, crosshair, nhãn.
import {
  Group, BufferGeometry, BufferAttribute, LineLoop, LineSegments, Line, LineBasicMaterial,
  LineDashedMaterial, Sprite, SpriteMaterial, CanvasTexture, Mesh, SphereGeometry,
  MeshBasicMaterial, SRGBColorSpace,
} from 'three';

const INK = 0xe8e0cf;
const BRASS = 0xc09a5e;
const NS = 'http://www.w3.org/2000/svg';

/** @param {number[]} pts */
const geo = (pts) => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return g;
};

/** @param {number} r @param {number} y @param {number} [n] @param {number} [a0] @param {number} [a1] */
const circle = (r, y, n = 256, a0 = 0, a1 = Math.PI * 2) => {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    p.push(Math.cos(a) * r, y, Math.sin(a) * r);
  }
  return p;
};

/** Nhãn nhỏ dạng sprite (chữ mono). @param {string} text */
function labelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.font = '500 30px ui-monospace, Menlo, "Cascadia Mono", Consolas, monospace';
  g.fillStyle = '#ffffff'; // chữ trắng, tô màu theo chủ đề bằng material.color
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const m = new SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.3 });
  const s = new Sprite(m);
  s.scale.set(0.56, 0.14, 1);
  return s;
}

export class BlueprintOverlay {
  /**
   * @param {{scene: import('three').Scene, svg: SVGSVGElement, center: import('three').Vector3, floorY: number, fig: string}} o
   */
  constructor(o) {
    this.svg = o.svg;
    /** Chú thích bản vẽ ở mép trên — do mẫu vật cấp (SpecimenDef.fig). */
    this.fig = o.fig;
    this.group = new Group();
    this.group.position.set(o.center.x, 0, o.center.z);
    o.scene.add(this.group);
    /** layer: 'static' = lưới/trục tĩnh, 'belt' = băng chuyền — hai lớp bật/tắt bằng hệ số opacity. @type {{m: any, base: number, role: 'ink'|'brass', layer?: 'static'|'belt'}[]} */
    this.mats = [];
    /** Mẫu đang xem chạy trên băng chuyền? */
    this.beltOn = false;
    this.themeGain = 1;
    const y = o.floorY;

    /** @param {any} m @param {number} base @param {'ink'|'brass'} [role] */
    const reg = (m, base, role = 'ink') => {
      m.transparent = true;
      m.depthWrite = false;
      m.toneMapped = false;
      m.opacity = 0;
      this.mats.push({ m, base, role });
      return m;
    };
    const solid = (/** @type {number} */ base, color = INK) => reg(new LineBasicMaterial({ color }), base, color === BRASS ? 'brass' : 'ink');
    const dashed = (/** @type {number} */ base, dash = 0.05, gap = 0.06, color = INK) =>
      reg(new LineDashedMaterial({ color, dashSize: dash, gapSize: gap }), base, color === BRASS ? 'brass' : 'ink');

    // Vòng đồng tâm
    const radii = [1.25, 1.95, 2.7, 3.45, 4.2, 5.1];
    radii.forEach((r, i) => {
      const l = new LineLoop(geo(circle(r, y)), i % 2 ? dashed(0.11, 0.06, 0.05) : solid(i === 4 ? 0.2 : 0.13));
      if (i % 2) l.computeLineDistances();
      this.group.add(l);
    });

    // Thước độ (quay chậm)
    this.dial = new Group();
    const ticks = [];
    for (let d = 0; d < 360; d += 2) {
      const a = (d * Math.PI) / 180;
      const long = d % 10 === 0;
      const r0 = 4.2;
      const r1 = r0 + (long ? 0.17 : 0.07);
      ticks.push(Math.cos(a) * r0, y, Math.sin(a) * r0, Math.cos(a) * r1, y, Math.sin(a) * r1);
    }
    this.dial.add(new LineSegments(geo(ticks), solid(0.2)));
    [['000°', 0], ['090°', 90], ['180°', 180], ['270°', 270]].forEach(([t, d]) => {
      const s = labelSprite(/** @type {string} */ (t));
      const a = (/** @type {number} */ (d) * Math.PI) / 180;
      s.position.set(Math.cos(a) * 4.62, y + 0.02, Math.sin(a) * 4.62);
      this.mats.push({ m: s.material, base: 0.3, role: 'ink' });
      s.material.opacity = 0;
      this.dial.add(s);
    });
    this.group.add(this.dial);

    // Tia dựng hình mỗi 30°
    const rays = [];
    for (let d = 0; d < 360; d += 30) {
      const a = (d * Math.PI) / 180;
      rays.push(Math.cos(a) * 0.7, y, Math.sin(a) * 0.7, Math.cos(a) * 5.4, y, Math.sin(a) * 5.4);
    }
    this.group.add(new LineSegments(geo(rays), solid(0.06)));

    // Trục chữ thập dài
    const axes = new LineSegments(geo([-6.4, y, 0, 6.4, y, 0, 0, y, -6.4, 0, y, 6.4]), dashed(0.14, 0.12, 0.08));
    axes.computeLineDistances();
    this.group.add(axes);
    this.axes = axes;
    this.mats[this.mats.length - 1].layer = 'static';

    // Dấu + toạ độ
    const plus = [];
    for (let gx = -5; gx <= 5; gx++)
      for (let gz = -5; gz <= 5; gz++) {
        if (gx * gx + gz * gz > 27 || (gx === 0 && gz === 0)) continue;
        const k = 0.045;
        plus.push(gx - k, y, gz, gx + k, y, gz, gx, y, gz - k, gx, y, gz + k);
      }
    this.plus = new LineSegments(geo(plus), solid(0.16));
    this.group.add(this.plus);
    this.mats[this.mats.length - 1].layer = 'static';

    // Cung chấm
    const arc = new Line(geo(circle(2.32, y, 120, 0.35, 2.45)), dashed(0.2, 0.012, 0.045, BRASS));
    arc.computeLineDistances();
    this.group.add(arc);
    const arc2 = new Line(geo(circle(3.82, y, 120, 3.6, 5.2)), dashed(0.16, 0.012, 0.05));
    arc2.computeLineDistances();
    this.group.add(arc2);

    // Quỹ đạo elip nghiêng + chấm chạy dọc (trajectory)
    /** @type {{a: number, b: number, tilt: [number, number], line: Line, dot: Mesh, t: number, speed: number}[]} */
    this.orbits = [];
    const orbitSpecs = [
      { a: 4.7, b: 3.05, tilt: /** @type {[number, number]} */ ([0.32, 0.05]), speed: 0.045 },
      { a: 3.6, b: 2.35, tilt: /** @type {[number, number]} */ ([-0.2, 0.28]), speed: -0.07 },
    ];
    orbitSpecs.forEach((sp, i) => {
      const pts = [];
      for (let k = 0; k <= 256; k++) {
        const t = (k / 256) * Math.PI * 2;
        pts.push(Math.cos(t) * sp.a, 0, Math.sin(t) * sp.b);
      }
      const line = new Line(geo(pts), i ? dashed(0.13, 0.08, 0.06) : solid(0.1));
      if (i) line.computeLineDistances();
      const holder = new Group();
      holder.position.y = 0.1;
      holder.rotation.set(sp.tilt[0], 0, sp.tilt[1]);
      holder.add(line);
      const dm = reg(new MeshBasicMaterial({ color: i ? INK : BRASS }), 0.75, i ? 'ink' : 'brass');
      const dot = new Mesh(new SphereGeometry(0.028, 10, 8), dm);
      holder.add(dot);
      this.group.add(holder);
      this.orbits.push({ ...sp, line, dot, t: i * 2.1 });
    });

    // ── Băng chuyền G (plan đợt 3 §6): CHỈ lưới dấu + và trục Z trượt khi mẫu vật chạy trên sàn ─────
    // Hai lớp (tĩnh / băng chuyền) LUÔN được vẽ, bật tắt bằng hệ số opacity 0/1 — nên geometry của cả
    // hai đã lên GPU từ khung đầu: chuyển mẫu không phải upload gì (tiêu chí §4). Opacity 0 với blend
    // thường cho đúng màu đích → mẫu không có băng chuyền (bướm) vẽ từng pixel y hệt trước.
    // Tạo SAU mọi vật thể cũ (id lớn nhất) → không đổi thứ tự vẽ của vật thể cũ.
    // Buffer cấp sẵn, cập nhật tại chỗ: 0 cấp phát mỗi khung.
    const nMats0 = this.mats.length;
    this.belt = new Group();
    this.beltY = y;
    this.beltGrid = { x0: -5, x1: 5, z0: -6, z1: 6 };
    const nMarks = (this.beltGrid.x1 - this.beltGrid.x0 + 1) * (this.beltGrid.z1 - this.beltGrid.z0 + 1);
    this.beltPos = new Float32Array(nMarks * 4 * 3);
    this.beltPlus = new LineSegments(geo(Array.from(this.beltPos)), solid(0.16));
    this.beltPlus.frustumCulled = false;
    this.beltPosAttr = /** @type {BufferAttribute} */ (this.beltPlus.geometry.attributes.position);
    this.beltPos = /** @type {Float32Array} */ (this.beltPosAttr.array);
    const xAxis = new LineSegments(geo([-6.4, y, 0, 6.4, y, 0]), dashed(0.14, 0.12, 0.08));
    xAxis.computeLineDistances();
    this.beltZ = new LineSegments(geo([0, y, -6.4, 0, y, 6.4]), dashed(0.14, 0.12, 0.08));
    this.beltZ.computeLineDistances();
    this.beltZDist = /** @type {BufferAttribute} */ (this.beltZ.geometry.attributes.lineDistance);
    this.belt.add(this.beltPlus, xAxis, this.beltZ);
    this.group.add(this.belt);
    for (let i = nMats0; i < this.mats.length; i++) this.mats[i].layer = 'belt';
    this.beltOffset = NaN;
    // Dụng cụ đo luôn nằm quanh sân khấu và rất rẻ → KHÔNG frustum-cull (phòng hờ): mọi nét lên GPU ngay
    // từ khung đầu, kể cả sau khi mất context mà góc camera hiện tại không thấy hết → đổi góc/chuyển mẫu
    // không phải upload gì (đợt 3 §4). Pixel không đổi.
    this.group.traverse((c) => (c.frustumCulled = false));

    this.parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    this.opacity = 0;
    /** @type {Element|null} */ this.gridG = null;
    this._px = NaN;
    this._py = NaN;
  }

  /**
   * Quãng băng chuyền đã chạy (unit), hoặc null = mẫu không có băng chuyền (hiện lưới/trục tĩnh như cũ).
   * Sàn trượt về −Z (con vật chạy về +Z). Dấu + mờ dần ở mép vòng r ≈ 5 thay vì bật/tắt.
   * @param {number|null} offset
   */
  setBelt(offset) {
    const on = offset !== null;
    if (this.beltOn !== on) {
      this.beltOn = on;
      this.beltOffset = NaN;
      this._writeOpacity();
    }
    if (!on || offset === this.beltOffset) return;
    this.beltOffset = offset;
    const f = offset - Math.floor(offset);
    const { x0, x1, z0, z1 } = this.beltGrid;
    const y = this.beltY;
    const P = this.beltPos;
    let o = 0;
    for (let gx = x0; gx <= x1; gx++)
      for (let gz = z0; gz <= z1; gz++) {
        const z = gz - f;
        const r = Math.hypot(gx, z);
        // mặt nạ tròn: 1 bên trong r 4.7, 0 từ r 5.3; bỏ dấu ngay tâm như lưới tĩnh
        const t = Math.min(1, Math.max(0, (5.3 - r) / 0.6));
        const k = r < 0.5 ? 0 : 0.045 * t * t * (3 - 2 * t);
        P[o++] = gx - k; P[o++] = y; P[o++] = z;
        P[o++] = gx + k; P[o++] = y; P[o++] = z;
        P[o++] = gx; P[o++] = y; P[o++] = z - k;
        P[o++] = gx; P[o++] = y; P[o++] = z + k;
      }
    this.beltPosAttr.needsUpdate = true;
    // Vạch đứt của trục Z trôi theo: lệch lineDistance một đoạn trong chu kỳ vạch (0.12 + 0.08)
    const s = offset - Math.floor(offset / 0.2) * 0.2;
    this.beltZDist.setX(0, s);
    this.beltZDist.setX(1, 12.8 + s);
    this.beltZDist.needsUpdate = true;
  }

  /** Chế độ "lite" (bậc hạ chất lượng cuối): ẩn chấm chạy trên quỹ đạo và nhãn độ của thước. @param {boolean} on */
  setLite(on) {
    for (const o of this.orbits) o.dot.visible = !on;
    this.dial.traverse((c) => {
      if (/** @type {any} */ (c).isSprite) c.visible = !on;
    });
  }

  /** Dời tâm dụng cụ đo về dưới mẫu vật mới (chuyển mẫu). @param {import('three').Vector3} center */
  setCenter(center) {
    this.group.position.set(center.x, 0, center.z);
  }

  /** Chú thích bản vẽ của mẫu vật mới — dựng lại lớp SVG ở lần buildScreen kế tiếp. @param {string} fig */
  setFig(fig) {
    this.fig = fig;
  }

  /** @param {number} k 0..1 (intro) */
  setOpacity(k) {
    if (k === this.opacity) return;
    this.opacity = k;
    this._writeOpacity();
  }

  _writeOpacity() {
    const k = this.opacity;
    for (const { m, base, layer } of this.mats) {
      const on = layer === 'belt' ? this.beltOn : layer === 'static' ? !this.beltOn : true;
      m.opacity = on ? Math.min(1, base * k * this.themeGain) : 0;
    }
  }

  /** Mực ngà trên nền đen (obsidian) / mực nâu than trên nền kem (azure). @param {'azure'|'obsidian'} theme */
  setTheme(theme) {
    const light = theme === 'azure';
    const ink = light ? 0x3a332b : INK;
    const brass = light ? 0xa27f36 : BRASS;
    for (const { m, role } of this.mats) m.color.setHex(role === 'brass' ? brass : ink);
    this.themeGain = light ? 1.15 : 1;
    const k = this.opacity;
    this.opacity = -1;
    this.setOpacity(k);
  }

  /** @param {number} dt @param {number} flight @param {boolean} ambient */
  update(dt, flight, ambient) {
    const speed = ambient ? 1 + flight * 5 : 0;
    this.dial.rotation.y += dt * ((Math.PI * 2) / 240) * speed;
    for (const o of this.orbits) {
      o.t += dt * o.speed * speed * Math.PI * 2 * 0.25;
      o.dot.position.set(Math.cos(o.t) * o.a, 0, Math.sin(o.t) * o.b);
    }
    // Parallax lưới SVG có quán tính
    const p = this.parallax;
    const k = 1 - Math.exp(-dt / 0.35);
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
    if (this.gridG && (Math.abs(p.x - this._px) > 0.05 || Math.abs(p.y - this._py) > 0.05)) {
      this._px = p.x;
      this._py = p.y;
      this.gridG.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
    }
    return Math.abs(p.x - p.tx) > 0.05 || Math.abs(p.y - p.ty) > 0.05;
  }

  /** @param {number} nx -1..1 @param {number} ny -1..1 */
  setPointer(nx, ny) {
    this.parallax.tx = -nx * 6;
    this.parallax.ty = -ny * 6;
  }

  // ── Lớp SVG màn hình ────────────────────────────────────────────────────────────────────────

  /**
   * @param {number} W @param {number} H
   * @param {{x: number, y: number}} center điểm ghim tâm model
   * @param {string} cls lớp viewport
   * @param {DOMRect[]} [hud] khối HUD — số trên thước không được đè lên chúng
   */
  buildScreen(W, H, center, cls, hud = []) {
    /** @param {number} x @param {number} y */
    const free = (x, y) => !hud.some((r) => x > r.left - 30 && x < r.right + 30 && y > r.top - 16 && y < r.bottom + 16);
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    /** @param {string} tag @param {Record<string, string|number>} attrs @param {Element} [parent] */
    const el = (tag, attrs, parent = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      parent.appendChild(e);
      return e;
    };
    const small = cls === 'mobile' || cls === 'phone-landscape';
    const inset = small ? 12 : 20;

    const defs = el('defs', {});
    const pat = el('pattern', { id: 'bp-minor', width: 24, height: 24, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M24 0H0V24', class: 'bp-grid-minor' }, pat);
    const pat2 = el('pattern', { id: 'bp-major', width: 120, height: 120, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M120 0H0V120', class: 'bp-grid-major' }, pat2);

    const grid = el('g', { class: 'bp-grid' });
    el('rect', { x: -24, y: -24, width: W + 48, height: H + 48, fill: 'url(#bp-minor)' }, grid);
    el('rect', { x: -24, y: -24, width: W + 48, height: H + 48, fill: 'url(#bp-major)' }, grid);
    this.gridG = grid;
    this._px = NaN;
    this._py = NaN;

    const frame = el('g', { class: 'bp-frame' });
    el('rect', { x: inset, y: inset, width: Math.max(0, W - inset * 2), height: Math.max(0, H - inset * 2), pathLength: 1, class: 'bp-draw' }, frame);
    const c = 14;
    const o = inset - 6;
    const corners = [
      `M${o} ${o + c}V${o}H${o + c}`,
      `M${W - o - c} ${o}H${W - o}V${o + c}`,
      `M${o} ${H - o - c}V${H - o}H${o + c}`,
      `M${W - o - c} ${H - o}H${W - o}V${H - o - c}`,
    ];
    for (const d of corners) el('path', { d, class: 'bp-corner' }, frame);
    // (width/height của khung kẹp ≥ 0 ở dưới — viewport siêu nhỏ lúc khởi tạo từng cho số âm → lỗi SVG)

    // Thước trên và trái
    const ruler = el('g', { class: 'bp-ruler' });
    let dTop = '';
    for (let x = inset; x <= W - inset; x += 10) {
      const k = (x - inset) % 100 === 0 ? 7 : (x - inset) % 50 === 0 ? 5 : 3;
      dTop += `M${x} ${inset}v${k}`;
    }
    let dLeft = '';
    for (let yy = inset; yy <= H - inset; yy += 10) {
      const k = (yy - inset) % 100 === 0 ? 7 : (yy - inset) % 50 === 0 ? 5 : 3;
      dLeft += `M${inset} ${yy}h${k}`;
    }
    el('path', { d: dTop + dLeft }, ruler);
    if (!small) {
      for (let x = inset + 100; x < W - inset - 60; x += 100) {
        if (!free(x + 12, inset + 12)) continue;
        const t = el('text', { x: x + 3, y: inset + 15, class: 'bp-num' }, ruler);
        t.textContent = String(x - inset).padStart(4, '0');
      }
      for (let yy = inset + 100; yy < H - inset - 60; yy += 100) {
        if (!free(inset + 20, yy)) continue;
        const t = el('text', { x: inset + 10, y: yy + 3, class: 'bp-num' }, ruler);
        t.textContent = String(yy - inset).padStart(4, '0');
      }
    }

    // Crosshair tại điểm ghim + dấu đăng ký
    const cx = center.x;
    const cy = center.y;
    const ch = el('g', { class: 'bp-cross' });
    el('path', { d: `M${cx - 9} ${cy}h6M${cx + 3} ${cy}h6M${cx} ${cy - 9}v6M${cx} ${cy + 3}v6` }, ch);
    if (!small) {
      for (const [rx, ry] of [[W - inset - 34, inset + 34], [inset + 34, H - inset - 34]]) {
        el('circle', { cx: rx, cy: ry, r: 7, class: 'bp-reg' });
        el('path', { d: `M${rx - 12} ${ry}h24M${rx} ${ry - 12}v24`, class: 'bp-reg' });
      }
      const lab = el('text', { x: W / 2, y: inset - 7, class: 'bp-label', 'text-anchor': 'middle' });
      lab.textContent = this.fig;
      const coord = el('text', { x: W - inset - 4, y: H - inset + 13, class: 'bp-label', 'text-anchor': 'end' });
      coord.textContent = `VIEWPORT ${Math.round(W)} × ${Math.round(H)}  ·  ORIGIN ${Math.round(cx)}, ${Math.round(cy)}`;
    }
  }
}
