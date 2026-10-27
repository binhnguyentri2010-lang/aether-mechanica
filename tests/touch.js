// @ts-check
// Cử chỉ chạm (plan §11 — phần "pinch/vuốt trên iPhone/iPad" TỰ ĐỘNG HOÁ được).
//
// Phát PointerEvent pointerType 'touch' tổng hợp lên canvas ở kích thước iPhone (390×844) và iPad (834×1194),
// kiểm đúng các cử chỉ ghi trong legend: 1 ngón xoay · chụm zoom · 2 ngón pan · chạm chọn part · chạm đôi
// chỗ trống về ISO; cộng thêm hai lớp chặn trình duyệt tự cuộn/phóng cả trang.
//
// Giới hạn trung thực: sự kiện tổng hợp không có pointer capture thật (setPointerCapture ném NotFoundError
// với pointerId không có thật → thay bằng hàm rỗng trên đúng canvas này) và không đi qua bộ nhận cử chỉ của
// Safari. Test chứng minh LOGIC xử lý cử chỉ của app đúng; cảm giác tay trên máy thật vẫn là kiểm tay.
import { Vector2, Vector3, Raycaster, Spherical } from 'three';
import { frames } from './harness.js';

const DEG = 180 / Math.PI;

/**
 * @param {{
 *   report: (ok: boolean|null, name: string, detail?: any) => void,
 *   guard: (name: string, fn: () => any) => Promise<void>,
 *   load: (query: string, w: number, h: number) => Promise<{f: HTMLIFrameElement, am: any, win: any}>,
 * }} t
 */
export async function touchTests(t) {
  /** @type {[string, number, number, string][]} */
  const devices = [['ornithopter', 390, 844, 'iPhone'], ['husky', 834, 1194, 'iPad']];
  for (const [sp, w, h, dev] of devices)
    await t.guard(`Cảm ứng ${dev}`, async () => {
      const { f, am, win } = await t.load(`still&theme=azure&dpr=1&specimen=${sp}`, w, h);
      oneDevice(t, am, win, `Cảm ứng ${dev} ${w}×${h} (${sp})`);
      f.remove();
    });
}

/** @param {Parameters<typeof touchTests>[0]} t @param {any} am @param {any} win @param {string} tag */
function oneDevice(t, am, win, tag) {
  const canvas = /** @type {HTMLCanvasElement} */ (win.document.getElementById('gl'));
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  const W = am.layout.W, H = am.layout.H;
  const cam = am.view.camera;
  const ctl = am.cam.controls;
  const st = () => am.store.state;
  const sph = new Spherical();
  const pose = () => {
    sph.setFromVector3(new Vector3().copy(cam.position).sub(ctl.target));
    return { az: sph.theta, el: sph.phi, r: sph.radius, pos: new Vector3().copy(cam.position), target: new Vector3().copy(ctl.target) };
  };

  /** @param {string} type @param {number} id @param {number} x @param {number} y @param {boolean} primary */
  const ev = (type, id, x, y, primary) => canvas.dispatchEvent(new win.PointerEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: y,
    button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true,
  }));
  /** Mỗi ngón: [x0, y0, x1, y1]; 12 bước di chuyển, mỗi bước một khung, rồi để quán tính tắt hẳn. @param {number[][]} tracks */
  const gesture = (tracks) => {
    tracks.forEach(([x, y], i) => ev('pointerdown', 11 + i, x, y, i === 0));
    for (let s = 1; s <= 12; s++) {
      const k = s / 12;
      tracks.forEach(([x0, y0, x1, y1], i) => ev('pointermove', 11 + i, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, i === 0));
      am.renderOnce(1 / 60);
    }
    tracks.forEach(([, , x1, y1], i) => ev('pointerup', 11 + i, x1, y1, i === 0));
    frames(am, 90);
  };
  /** @param {number} x @param {number} y */
  const tap = (x, y) => {
    ev('pointerdown', 21, x, y, true);
    ev('pointerup', 21, x, y, true);
  };

  // Điểm trúng / trượt model — dùng đúng cách app chọn (picker của app, cùng công thức NDC)
  const rc = new Raycaster();
  /** @param {number} x @param {number} y */
  const hit = (x, y) => {
    rc.setFromCamera(new Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), cam);
    const r = am.picker.first(rc.ray);
    return r ? r.object.userData.part : null;
  };
  const emptySpot = () => {
    for (let gy = 0.3; gy <= 0.7; gy += 0.05)
      for (const gx of [0.08, 0.92, 0.15, 0.85])
        if (!hit(W * gx, H * gy)) return [W * gx, H * gy];
    return null;
  };

  const p0 = pose();

  // 1. Một ngón kéo ngang → xoay quanh model, không chọn nhầm part
  gesture([[W * 0.4, H * 0.5, W * 0.4 + H * 0.12, H * 0.5]]);
  const p1 = pose();
  const dAz = Math.abs(p1.az - p0.az) * DEG;
  t.report(dAz > 10 && Math.abs(p1.el - p0.el) * DEG < 2 && st().selectedPartId === null, `${tag}: 1 ngón kéo → xoay`,
    `phương vị đổi ${dAz.toFixed(1)}° · góc ngẩng đổi ${(Math.abs(p1.el - p0.el) * DEG).toFixed(2)}° · không chọn nhầm part`);

  // 2. Chụm/giãn hai ngón đối xứng → zoom vào (tâm đứng yên), không chọn part
  gesture([[W * 0.4, H * 0.5, W * 0.3, H * 0.5], [W * 0.6, H * 0.5, W * 0.7, H * 0.5]]);
  const p2 = pose();
  const ratio = p2.r / p1.r;
  t.report(ratio < 0.8 && p2.target.distanceTo(p1.target) < 0.02 && st().selectedPartId === null, `${tag}: giãn 2 ngón → zoom vào`,
    `khoảng cách camera × ${ratio.toFixed(3)} · tâm xoay dịch ${p2.target.distanceTo(p1.target).toFixed(4)}`);

  // 3. Hai ngón kéo song song → pan (dịch tâm), không đổi khoảng cách
  gesture([[W * 0.35, H * 0.5, W * 0.45, H * 0.5], [W * 0.65, H * 0.5, W * 0.75, H * 0.5]]);
  const p3 = pose();
  const shift = p3.target.distanceTo(p2.target);
  t.report(shift > 0.02 && Math.abs(p3.r / p2.r - 1) < 0.02 && st().selectedPartId === null, `${tag}: 2 ngón kéo song song → pan`,
    `tâm xoay dịch ${shift.toFixed(3)} · khoảng cách đổi ${((p3.r / p2.r - 1) * 100).toFixed(2)}%`);

  // 4. Chạm đôi vào chỗ trống → về preset ISO đúng như lúc mở
  const e1 = emptySpot();
  const nonce = st().viewNonce;
  if (e1) {
    tap(e1[0], e1[1]);
    tap(e1[0], e1[1]);
  }
  frames(am, 90);
  const p4 = pose();
  const errPos = p4.pos.distanceTo(p0.pos), errTgt = p4.target.distanceTo(p0.target);
  t.report(!!e1 && st().viewNonce === nonce + 1 && errPos < 1e-3 && errTgt < 1e-3, `${tag}: chạm đôi chỗ trống → về ISO`,
    e1 ? `lệch vị trí camera ${errPos.toExponential(2)} · lệch tâm ${errTgt.toExponential(2)}` : 'không tìm được chỗ trống để chạm');

  // 5. Chạm một part → chọn đúng part đó; chạm chỗ trống → bỏ chọn
  const c = am.model.centerAt(0, new Vector3());
  am.model.root.localToWorld(c);
  c.project(cam);
  const cx = ((c.x + 1) / 2) * W, cy = ((1 - c.y) / 2) * H;
  const want = hit(cx, cy);
  tap(cx, cy);
  const picked = st().selectedPartId;
  frames(am, 90); // chờ tween focus xong: trong tween app bỏ qua cú chạm (luật khoá OrbitControls)
  const e2 = emptySpot();
  if (e2) tap(e2[0], e2[1]);
  frames(am, 90);
  t.report(!!want && picked === want.name && !!e2 && st().selectedPartId === null, `${tag}: chạm part → chọn · chạm chỗ trống → bỏ chọn`,
    `chạm (${cx.toFixed(0)}, ${cy.toFixed(0)}) → ${picked} (đúng part dưới ngón: ${want ? want.name : '—'}) · sau khi chạm trống: ${st().selectedPartId}`);

  // 6. Trình duyệt không được tự cuộn / phóng cả trang khi thao tác trên model
  if (tag.includes('iPhone')) {
    const g = new win.Event('gesturestart', { cancelable: true });
    win.document.dispatchEvent(g);
    const ta = win.getComputedStyle(canvas).touchAction;
    t.report(g.defaultPrevented && ta === 'none', 'Cảm ứng: canvas touch-action none + chặn gesturestart (iOS không phóng/cuộn cả trang)',
      `touch-action: ${ta} · gesturestart bị chặn: ${g.defaultPrevented}`);
  }
}
