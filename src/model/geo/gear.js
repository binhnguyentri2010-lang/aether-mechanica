// @ts-check
import { Shape, Path, ExtrudeGeometry } from 'three';

/**
 * Bánh răng thật: răng hình thang, vành, nan hoa, lỗ trục, vát mép. Trục quay = Z, tâm ở gốc.
 * @param {{
 *   teeth?: number, radius?: number, toothDepth?: number, thickness?: number,
 *   bore?: number, hub?: number, spokes?: number, rim?: number,
 * }} o
 */
export function gearGeometry(o = {}) {
  const teeth = o.teeth ?? 24;
  const R = o.radius ?? 0.1;
  const td = o.toothDepth ?? R * 0.12;
  const th = o.thickness ?? 0.012;
  const bore = o.bore ?? R * 0.12;
  const hub = o.hub ?? R * 0.3;
  const spokes = o.spokes ?? 5;
  const rim = o.rim ?? R * 0.16;
  const rRoot = R - td;

  const shape = new Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [rRoot, a],
      [R, a + step * 0.2],
      [R, a + step * 0.48],
      [rRoot, a + step * 0.68],
    ];
    pts.forEach(([r, ang], k) => {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();

  const boreHole = new Path();
  boreHole.absarc(0, 0, bore, 0, Math.PI * 2, true);
  shape.holes.push(boreHole);

  const rOut = rRoot - rim;
  if (spokes > 0 && rOut - hub > R * 0.12) {
    const half = (Math.PI / spokes) * 0.36; // nửa bề rộng nan hoa (radian ở vành trong)
    for (let j = 0; j < spokes; j++) {
      const a1 = (j / spokes) * Math.PI * 2 + half;
      const a2 = ((j + 1) / spokes) * Math.PI * 2 - half;
      const w = new Path();
      w.absarc(0, 0, rOut, a1, a2, false);
      w.absarc(0, 0, hub, a2 - half * 0.4, a1 + half * 0.4, true);
      w.closePath();
      shape.holes.push(w);
    }
  }

  const g = new ExtrudeGeometry(shape, {
    depth: th,
    bevelEnabled: true,
    bevelThickness: Math.min(0.002, th * 0.2),
    bevelSize: Math.min(0.0016, td * 0.25),
    bevelSegments: 1,
    curveSegments: 10,
  });
  g.translate(0, 0, -th / 2);
  return g;
}
