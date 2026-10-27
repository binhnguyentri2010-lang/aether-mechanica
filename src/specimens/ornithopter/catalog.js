// @ts-check
// NGUỒN SỰ THẬT cho nội dung từng bộ phận: số, tên, mô tả, vật liệu (theo chủ đề), số lượng, ưu tiên nhãn.
// Vị trí điểm neo và vector explode nằm cùng hình học trong assemblies/* (chúng phụ thuộc kích thước
// thật), còn ở đây chỉ có chữ — sửa nội dung không bao giờ phải đụng vào hình học.
//
// priority: 1 = luôn hiện (kể cả điện thoại), 2 = tablet trở lên, 3 = chỉ desktop.
// Mô tả cố ý KHÔNG nhắc tên kim loại: vật liệu đổi theo chủ đề nên chỉ nằm ở trường `mat`.
//
// Thông số tổng: WINGSPAN đo từ geometry, ANGLE/RATE đọc từ FlightRig. MASS = 2.4 kg là thông số
// DANH NGHĨA lấy từ spec, không tính từ thể tích.

/** @typedef {import('../../model/types.js').CatalogEntry} CatalogEntry */

/** @type {CatalogEntry[]} */
export const CATALOG = [
  { id: 'antenna', no: '01', name: 'Antenna Array', short: 'Antenna', priority: 2, annotate: true,
    mat: { azure: 'Gold wire · Gold beads', obsidian: 'Ivory enamel · Bronze' }, qty: '2',
    desc: 'Twin sensing whips strung with beads. Each bead is a strain gauge feeding the control unit.' },
  { id: 'cranial', no: '02', name: 'Cranial Housing', short: 'Cranium', priority: 3, annotate: true,
    mat: { azure: 'Azure enamel', obsidian: 'Oxidized steel' }, qty: '1',
    desc: 'Turned capsule carrying the optic pair and both antenna roots on one sealed bearing.' },
  { id: 'optic', no: '03', name: 'Compound Optic', short: 'Optic', priority: 3, annotate: true,
    mat: { azure: 'Iridescent azure glass', obsidian: 'Smoked glass · Bronze' }, qty: '2',
    desc: 'Faceted lenses in ringed bezels, ground flat so the horizon reads cleanly at any wing angle.' },
  { id: 'housing', no: '04', name: 'Central Housing', short: 'Housing', priority: 1, annotate: true,
    mat: { azure: 'Azure enamel · Gold rings', obsidian: 'Oxidized steel' }, qty: '1',
    desc: 'Lathe-turned thorax shell. Carries the four wing hinges, their servos and the gyroscopic core.' },
  { id: 'core', no: '05', name: 'Gyroscopic Core', short: 'Core', priority: 1, annotate: true,
    mat: { azure: 'Amber cell · Azure rings', obsidian: 'Amber cell · Azure steel' }, qty: '1 + 3 rings',
    desc: 'Energy cell suspended in three gimbal rings. Holds attitude while the wings beat.' },
  { id: 'fcu', no: '06', name: 'Flight Control Unit', short: 'Control', priority: 2, annotate: true,
    mat: { azure: 'Gold · Pearl dial', obsidian: 'Bronze · Ivory dial' }, qty: '1',
    desc: 'Dorsal governor with an engraved dial. Sets stroke amplitude and beat rate.' },
  { id: 'servo', no: '07', name: 'Primary Servo', short: 'Servo', priority: 2, annotate: true,
    mat: { azure: 'Porcelain · Rose gold', obsidian: 'Oxidized steel · Copper' }, qty: '4',
    desc: 'One per wing. A geared motor swings the horn that drives the stroke through the linkage.' },
  { id: 'hinge', no: '08', name: 'Hinge Assembly', short: 'Hinge', priority: 3, annotate: true,
    mat: { azure: 'Gold · Azure enamel', obsidian: 'Bronze · Azure steel' }, qty: '4',
    desc: 'Knuckle and bearing stack at each wing root, clevised to the housing.' },
  { id: 'pivot', no: '09', name: 'Brass Pivot', short: 'Pivot', priority: 2, annotate: true,
    mat: { azure: 'Gold', obsidian: 'Bronze' }, qty: '4',
    desc: 'Hardened hinge pin. Both wings on a side turn about this same line, so they can never meet.' },
  { id: 'linkage', no: '10', name: 'Torsion Linkage', short: 'Linkage', priority: 3, annotate: true,
    mat: { azure: 'Gold', obsidian: 'Warm silver · Bronze' }, qty: '4',
    desc: 'Servo horn and fixed-length connecting rod turning motor travel into a 112° stroke.' },
  { id: 'spar', no: '11', name: 'Wing Spar', short: 'Spar', priority: 1, annotate: true,
    mat: { azure: 'Gold · Pearl tip', obsidian: 'Warm silver · Ivory tip' }, qty: '4',
    desc: 'Leading-edge tube carrying bending load from tip to root.' },
  { id: 'carpal', no: '12', name: 'Carpal Joint', short: 'Carpal', priority: 2, annotate: true,
    mat: { azure: 'Gold · Azure enamel', obsidian: 'Bronze · Azure steel' }, qty: '4',
    desc: 'Mid-spar joint letting the outer panel feather through each stroke.' },
  { id: 'membrane', no: '13', name: 'Membrane Frame', short: 'Membrane', priority: 1, annotate: true,
    mat: { azure: 'Gold lattice · Lavender film', obsidian: 'Ivory lattice · Smoked film' }, qty: '8 panels',
    desc: 'Fan of ribs radiating from the root under a translucent skin, split at the carpal line into two panels.' },
  { id: 'coupling', no: '14', name: 'Power Coupling', short: 'Coupling', priority: 3, annotate: true,
    mat: { azure: 'Rose gold', obsidian: 'Copper' }, qty: '1 + 2 cables',
    desc: 'Collar and twin cables carrying power from the core into the spine.' },
  { id: 'spine', no: '15', name: 'Articulated Spine', short: 'Spine', priority: 1, annotate: true,
    mat: { azure: 'Porcelain · Gold bands', obsidian: 'Oxidized steel · Bronze' }, qty: '8',
    desc: 'Eight tapering segments on ball joints. Shifts the balance point in flight.' },
  { id: 'caudal', no: '16', name: 'Caudal Stabilizer', short: 'Caudal', priority: 2, annotate: true,
    mat: { azure: 'Navy lacquer', obsidian: 'Carbon · Steel' }, qty: '1',
    desc: 'Tail spike with twin fins; damps yaw at high beat rates.' },
  // Không gắn nhãn, nhưng vẫn hover/click/inspect được
  { id: 'cover', no: '—', name: 'Inspection Cover', short: 'Cover', priority: 3, annotate: false,
    mat: { azure: 'Satin gold', obsidian: 'Oxidized steel · Bronze trim' }, qty: '1',
    desc: 'Dorsal panel over the core bay. Lifts away first in the exploded view.' },
  { id: 'belly', no: '—', name: 'Ventral Plate', short: 'Ventral', priority: 3, annotate: false,
    mat: { azure: 'Navy lacquer', obsidian: 'Carbon' }, qty: '1', desc: 'Keel plate closing the underside of the housing.' },
  { id: 'gears', no: '—', name: 'Drive Gear Train', short: 'Gears', priority: 3, annotate: false,
    mat: { azure: 'Gold', obsidian: 'Bronze' }, qty: '11',
    desc: 'Dorsal train and root gears. Counter-rotating pairs, speed inverse to tooth count.' },
  { id: 'legs', no: '—', name: 'Articulated Legs', short: 'Legs', priority: 3, annotate: false,
    mat: { azure: 'Gold', obsidian: 'Oxidized steel · Bronze' }, qty: '6', desc: 'Folded landing legs, tucked inside the wing sweep.' },
];

/** @type {Record<string, CatalogEntry>} */
export const BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

/** Thông số danh nghĩa theo spec (không đo được từ hình học). */
export const NOMINAL = { massKg: 2.4 };

/** Mô tả tổng thể trong khối SPECIFICATION, theo chủ đề. */
export const SPEC_DESC = {
  azure: 'A four-winged clockwork flyer in gold, azure enamel and porcelain over lavender film. Trace any component with the pointer; select it to isolate.',
  obsidian: 'A four-winged clockwork flyer in aged bronze, oxidized steel and ivory enamel. Trace any component with the pointer; select it to isolate.',
};
