// @ts-check
// Gyroscopic core: tế bào amber trong lồng đồng + 3 vòng gimbal. Nằm trong thorax, thấy qua cửa sổ lưng.
import {
  SphereGeometry, TorusGeometry, CylinderGeometry, Group, Vector3, Sprite, SpriteMaterial,
  CanvasTexture, AdditiveBlending, SRGBColorSpace,
} from 'three';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,196,128,1)');
  grd.addColorStop(0.18, 'rgba(255,160,80,0.55)');
  grd.addColorStop(0.45, 'rgba(255,130,50,0.12)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** @param {import('../../../model/MechanicalModel.js').BuildContext} ctx */
export function buildCore(ctx) {
  const core = ctx.top(ctx.part('core', 'core')).at(0, 0.02, 0.02).explode(0, 1, 0, 0.6, 0.2);

  ctx.mesh(core, new SphereGeometry(0.092, 40, 24), 'amber');

  const cage = [];
  for (let k = 0; k < 4; k++) {
    const t = new TorusGeometry(0.116, 0.0042, 4, 48);
    t.rotateY((k * Math.PI) / 4);
    cage.push(t);
  }
  const eq = new TorusGeometry(0.116, 0.005, 4, 48);
  eq.rotateX(Math.PI / 2);
  cage.push(eq);
  for (const y of [0.118, -0.118]) {
    const cap = new CylinderGeometry(0.02, 0.02, 0.012, 16);
    cap.translate(0, y, 0);
    cage.push(cap);
  }
  ctx.merge(core, 'brass', cage);
  core.anchor = new Vector3(0, 0.125, 0);

  const glowMat = new SpriteMaterial({
    map: glowTexture(), color: 0xffffff, blending: AdditiveBlending, depthWrite: false,
    transparent: true, toneMapped: false, opacity: 0.85,
  });
  const glow = new Sprite(glowMat);
  glow.scale.setScalar(0.62);
  core.pivot.add(glow);

  // Không dùng PointLight: một đèn điểm cộng thêm chi phí cho MỌI pixel của model. Quầng sáng
  // đã có sprite glow + vật liệu phát sáng.

  // Ba vòng gimbal lồng nhau, mỗi vòng quay quanh một trục riêng
  const specs = [
    { r: 0.158, tube: 0.0068, mat: 'azure', tilt: [Math.PI / 2, 0, 0.3], axis: 'y', speed: 0.22 },
    { r: 0.19, tube: 0.0062, mat: 'brass', tilt: [0.2, 0.9, 0], axis: 'x', speed: -0.16 },
    { r: 0.224, tube: 0.0075, mat: 'azure', tilt: [0.5, 0, 0.1], axis: 'z', speed: 0.1 },
  ];
  /** @type {{spin: Group, axis: 'x'|'y'|'z', speed: number}[]} */
  const rings = [];
  specs.forEach((sp, i) => {
    const p = core.add(ctx.part('core', 'gimbal-' + i)).explode(0, 1, 0, 0.16 * (i + 1), 0.25 + i * 0.03);
    p.pivot.rotation.set(sp.tilt[0], sp.tilt[1], sp.tilt[2]);
    const spin = new Group();
    p.pivot.add(spin);
    const ring = new TorusGeometry(sp.r, sp.tube, 6, 72);
    const pins = [];
    for (const sx of [1, -1]) {
      const pin = new CylinderGeometry(0.008, 0.008, 0.03, 10);
      pin.rotateZ(Math.PI / 2);
      pin.translate(sx * (sp.r + 0.012), 0, 0);
      pins.push(pin);
    }
    ctx.mesh(p, ring, /** @type {any} */ (sp.mat), { parent: spin });
    ctx.merge(p, 'brass', pins, { parent: spin });
    rings.push({ spin, axis: /** @type {'x'|'y'|'z'} */ (sp.axis), speed: sp.speed });
  });

  return { core, glow, glowMat, rings };
}
