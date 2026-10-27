// @ts-check
// Một bộ phận có thể nổ ra (exploded view).
//
// Cây node: group (dịch explode) → pivot (quay khi bay) → mesh.
// Hai chuyển động nằm ở hai node khác nhau nên không bao giờ ghi đè nhau.
import { Group, Vector3, Quaternion } from 'three';
import { clamp, easeInOutCubic } from '../core/easing.js';

export class Part {
  /** @param {string} kind id trong catalog @param {string} name tên duy nhất */
  constructor(kind, name) {
    this.kind = kind;
    this.name = name;
    this.group = new Group();
    this.group.name = name;
    this.pivot = new Group();
    this.group.add(this.pivot);
    this.home = new Vector3();
    this.homeQuat = new Quaternion();
    /** @type {Quaternion|null} */ this.rotTarget = null;
    this.dir = new Vector3();
    this.dist = 0;
    this.delay = 0;
    this.progress = 0;
    /** @type {Part[]} */ this.children = [];
    /** @type {Part|null} */ this.parent = null;
    /** Điểm neo annotation, trong hệ toạ độ pivot. @type {Vector3|null} */
    this.anchor = null;
    /** @type {import('three').Mesh[]} */ this.meshes = [];
    /** Dữ liệu riêng của từng loại part (số răng, chiều quay...). @type {Record<string, any>} */
    this.userData = {};
  }

  /** @param {number} x @param {number} y @param {number} z */
  at(x, y, z) {
    this.home.set(x, y, z);
    this.group.position.copy(this.home);
    return this;
  }

  /** @param {number} x @param {number} y @param {number} z @param {number} dist @param {number} [delay] */
  explode(x, y, z, dist, delay = 0) {
    this.dir.set(x, y, z).normalize();
    this.dist = dist;
    this.delay = delay;
    return this;
  }

  /**
   * Gắn part con. Mặc định vào pivot của part này; truyền container để gắn vào một node khác
   * nằm bên trong part (ví dụ nhóm feathering của cánh). Part con vẫn được explode đệ quy.
   * @param {Part} child @param {import('three').Object3D} [container]
   */
  add(child, container) {
    (container || this.pivot).add(child.group);
    this.children.push(child);
    child.parent = this;
    return child;
  }

  /** Hàm thuần: vị trí chỉ phụ thuộc e (plan §9) → test được. @param {number} e */
  applyExplode(e) {
    const t = this.dist > 0 || this.rotTarget ? clamp((e - this.delay) / (1 - this.delay)) : 0;
    const p = easeInOutCubic(t);
    this.progress = p;
    this.group.position.copy(this.home).addScaledVector(this.dir, this.dist * p);
    if (this.rotTarget) this.group.quaternion.slerpQuaternions(this.homeQuat, this.rotTarget, p);
    for (const c of this.children) c.applyExplode(e);
  }
}
