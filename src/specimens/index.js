// @ts-check
// REGISTRY — NGUỒN ID MẪU VẬT DUY NHẤT (plan đợt 3, §1, §10). Store, UI và test đọc danh sách ID từ
// đây, không lặp union cứng ở chỗ khác. Chỉ src/main.js (và tests/) được import file này
// (tools/check_boundaries.py kiểm).
import { ornithopter } from './ornithopter/index.js';
import { husky } from './husky/index.js';

/** @type {Record<string, import('../model/MechanicalModel.js').SpecimenDef>} */
export const REGISTRY = { ornithopter, husky };

export const SPECIMEN_IDS = Object.keys(REGISTRY);
export const DEFAULT_SPECIMEN = 'ornithopter';
