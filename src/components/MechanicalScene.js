// @ts-check
// Renderer, camera, ánh sáng theo chủ đề, env map procedural, bóng đổ mềm, resize, mất context.
import {
  WebGLRenderer, Scene, PerspectiveCamera, ACESFilmicToneMapping, SRGBColorSpace,
  HemisphereLight, DirectionalLight, PMREMGenerator, BoxGeometry, PlaneGeometry, Mesh,
  MeshBasicMaterial, BackSide, Color, CanvasTexture,
} from 'three';
import { initialDpr } from '../core/device.js';

/** "Studio" dựng bằng code: phòng tối + vài tấm sáng ấm → phản chiếu nhẹ, sang trên kim loại. */
function studioScene() {
  const s = new Scene();
  const room = new Mesh(new BoxGeometry(20, 20, 20), new MeshBasicMaterial({ color: 0x0b0908, side: BackSide }));
  s.add(room);
  /** @param {number} w @param {number} h @param {Color} c @param {[number, number, number]} p */
  const panel = (w, h, c, p) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: c, side: 2 }));
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(8, 5, new Color(3.2, 2.7, 2.1), [-5, 8, 3]); // softbox chính trên-trái, ấm
  panel(1.2, 12, new Color(1.5, 1.5, 1.55), [7, 2, -5]); // dải sáng viền sau-phải
  panel(10, 2, new Color(0.45, 0.36, 0.26), [0, -7, 2]); // hắt đáy
  panel(3, 3, new Color(1.0, 0.85, 0.65), [2, 5, 8]); // phụ trước
  return s;
}

/** Bóng đổ mềm dưới specimen (một tấm phẳng có gradient — gần như miễn phí). */
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(60,48,36,0.55)');
  grd.addColorStop(0.45, 'rgba(60,48,36,0.22)');
  grd.addColorStop(1, 'rgba(60,48,36,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Ánh sáng theo chủ đề: [hemi sky, hemi ground, hemi I, key color, key I, rim color, rim I, exposure]. */
const LIGHTS = {
  azure: { sky: 0xffffff, ground: 0xd9cfbf, hemi: 1.05, key: 0xfff3e2, keyI: 2.6, rim: 0xe6ebff, rimI: 1.3, exposure: 1.0, shadow: 0.9 },
  obsidian: { sky: 0xfff1dd, ground: 0x0a0806, hemi: 0.3, key: 0xffd9a8, keyI: 3.0, rim: 0xd8d2c8, rimI: 1.6, exposure: 0.92, shadow: 0 },
};

export class MechanicalScene {
  /** @param {HTMLCanvasElement} canvas @param {{antialias?: boolean, dpr?: number}} [o] */
  constructor(canvas, o = {}) {
    this.canvas = canvas;
    // o.dpr: ép DPR cố định (tham số test ?dpr=) — ảnh golden không phụ thuộc màn hình đang dùng.
    const dpr = o.dpr ?? initialDpr();
    // MSAA chỉ trên màn DPR 1 (răng cưa lộ rõ nhất). Đo thật ở 1440×900: MSAA tốn ~4 ms/khung
    // (9 ms → 5 ms khi tắt). Màn scale ≥ 125% (hầu hết laptop, điện thoại, iPad) đã đủ mịn nhờ mật
    // độ điểm ảnh. ?aa=0 để tắt hẳn khi đo hiệu năng.
    const aa = o.antialias ?? (o.dpr ?? (window.devicePixelRatio || 1)) < 1.25;
    this.renderer = new WebGLRenderer({ canvas, antialias: aa, alpha: true, powerPreference: 'high-performance' });
    this.dpr = dpr;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(30, 1, 0.05, 400);

    // 3 đèn (bản đầu có 5): mỗi đèn thêm chi phí cho mọi pixel của model
    this.hemi = new HemisphereLight(0xffffff, 0x000000, 1);
    this.key = new DirectionalLight(0xffffff, 1);
    this.key.position.set(-4, 7, 3);
    this.rim = new DirectionalLight(0xffffff, 1);
    this.rim.position.set(5, 2.5, -6);
    this.lights = [this.hemi, this.key, this.rim];
    this.baseIntensity = [1, 1, 1];
    this.scene.add(...this.lights);

    this.shadowMat = new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    this.shadow = new Mesh(new PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = -1;
    this.scene.add(this.shadow);
    this.shadowBase = 0;

    this.buildEnvironment();
    this.introK = 1;
    this.setTheme('azure');

    this.width = 1;
    this.height = 1;
    this.contextLost = false;
  }

  buildEnvironment() {
    const pm = new PMREMGenerator(this.renderer);
    const studio = studioScene();
    const rt = pm.fromScene(studio, 0.04);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    studio.traverse((o) => {
      const m = /** @type {Mesh} */ (o);
      if (m.isMesh) {
        m.geometry.dispose();
        /** @type {any} */ (m.material).dispose();
      }
    });
    pm.dispose();
  }

  /** @param {'azure'|'obsidian'} theme */
  setTheme(theme) {
    const L = LIGHTS[theme];
    this.hemi.color.setHex(L.sky);
    this.hemi.groundColor.setHex(L.ground);
    this.key.color.setHex(L.key);
    this.rim.color.setHex(L.rim);
    this.baseIntensity = [L.hemi, L.keyI, L.rimI];
    this.renderer.toneMappingExposure = L.exposure;
    this.shadowBase = L.shadow;
    this.setIntro(this.introK);
  }

  /** Đặt bóng đổ dưới model. @param {import('three').Vector3} center @param {number} y @param {number} w @param {number} d */
  placeShadow(center, y, w, d) {
    this.shadow.position.set(center.x, y, center.z);
    this.shadow.scale.set(w, d, 1);
  }

  /** @param {number} k 0..1 */
  setIntro(k) {
    this.introK = k;
    this.lights.forEach((l, i) => (l.intensity = this.baseIntensity[i] * k));
    this.shadowMat.opacity = this.shadowBase * k;
    this.shadow.visible = this.shadowBase > 0;
  }

  /** @param {number} w @param {number} h */
  resize(w, h) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
  }

  /** @param {number} dpr */
  setDpr(dpr) {
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
  }

  render() {
    if (!this.contextLost) this.renderer.render(this.scene, this.camera);
  }
}
