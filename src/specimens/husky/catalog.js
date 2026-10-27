// @ts-check
// NGUỒN SỰ THẬT cho nội dung từng bộ phận của husky: số, tên, mô tả, vật liệu (theo chủ đề), số lượng,
// ưu tiên nhãn. Hình học/neo nằm ở parts/*; ở đây chỉ có chữ.
//
// priority: 1 = luôn hiện (kể cả điện thoại), 2 = tablet trở lên, 3 = chỉ desktop.
// Thông số tổng: SHOULDER đo từ hình học (sàn → đỉnh vai), STRIDE/CADENCE đọc từ GaitSpec. MASS là
// thông số DANH NGHĨA, không tính từ thể tích.

/** @typedef {import('../../model/types.js').CatalogEntry} CatalogEntry */

/** @type {CatalogEntry[]} */
export const CATALOG = [
  { id: 'ear', no: '01', name: 'Ear Vanes', short: 'Ears', priority: 2, annotate: true,
    mat: { azure: 'Azure enamel · Pearl lining', obsidian: 'Oxidized steel · Ivory lining' }, qty: '2',
    desc: 'Pivoting acoustic vanes. Each tilts on its own bearing to track sound while trotting.' },
  { id: 'skull', no: '02', name: 'Cranial Housing', short: 'Cranium', priority: 1, annotate: true,
    mat: { azure: 'Porcelain · Azure cap', obsidian: 'Oxidized steel' }, qty: '1',
    desc: 'Turned head shell carrying the optics, both ear bearings and the jaw hinge.' },
  { id: 'optic', no: '03', name: 'Optic Pair', short: 'Optics', priority: 2, annotate: true,
    mat: { azure: 'Azure glass · Gold bezel', obsidian: 'Smoked glass · Bronze bezel' }, qty: '2',
    desc: 'Faceted lenses in almond bezels, set forward for overlapping depth vision.' },
  { id: 'jaw', no: '04', name: 'Articulated Jaw', short: 'Jaw', priority: 2, annotate: true,
    mat: { azure: 'Porcelain · Navy lacquer', obsidian: 'Oxidized steel · Carbon' }, qty: '1',
    desc: 'Lower mandible on a single hinge pin. Opens a few degrees with each stride to vent the core.' },
  { id: 'neck', no: '05', name: 'Cervical Coupling', short: 'Neck', priority: 3, annotate: true,
    mat: { azure: 'Porcelain · Gold rings', obsidian: 'Oxidized steel · Bronze rings' }, qty: '1 + 3 rings',
    desc: 'Ringed collar joining head to chassis. Carries the nod of the head at twice the stride rate.' },
  { id: 'chassis', no: '06', name: 'Thoracic Chassis', short: 'Chassis', priority: 1, annotate: true,
    mat: { azure: 'Porcelain · Gold seams', obsidian: 'Oxidized steel · Bronze seams' }, qty: '1',
    desc: 'Deep keel-shaped chest shell. Every limb, the spine and the tail are clevised to it.' },
  { id: 'core', no: '07', name: 'Power Cell', short: 'Core', priority: 1, annotate: true,
    mat: { azure: 'Amber cell · Gold bezel', obsidian: 'Amber cell · Bronze bezel' }, qty: '1',
    desc: 'Energy cell on the breastbone. Glows brighter as the gait engages.' },
  { id: 'spine', no: '08', name: 'Dorsal Spine', short: 'Spine', priority: 2, annotate: true,
    mat: { azure: 'Gold · Azure keys', obsidian: 'Bronze · Azure steel' }, qty: '6',
    desc: 'Six keyed vertebrae along the saddle, linking shoulder and hip carriers.' },
  { id: 'shoulder', no: '09', name: 'Shoulder Actuator', short: 'Shoulder', priority: 2, annotate: true,
    mat: { azure: 'Azure enamel · Gold drum', obsidian: 'Azure steel · Bronze drum' }, qty: '2',
    desc: 'Scapula plate and drive drum. Swings the whole foreleg about the shoulder pin.' },
  { id: 'humerus', no: '10', name: 'Upper Arm Strut', short: 'Upper arm', priority: 3, annotate: true,
    mat: { azure: 'Porcelain · Gold barrel', obsidian: 'Oxidized steel · Bronze barrel' }, qty: '2',
    desc: 'Tapered strut from shoulder to elbow. Holds the barrel of the elbow piston.' },
  { id: 'forearm', no: '11', name: 'Forearm Piston', short: 'Forearm', priority: 3, annotate: true,
    mat: { azure: 'Porcelain · Gold rod', obsidian: 'Oxidized steel · Warm silver rod' }, qty: '2',
    desc: 'Lower foreleg with the piston rod. Elbow bends backwards, as in the living animal.' },
  { id: 'hip', no: '12', name: 'Hip Actuator', short: 'Hip', priority: 2, annotate: true,
    mat: { azure: 'Azure enamel · Gold drum', obsidian: 'Azure steel · Bronze drum' }, qty: '2',
    desc: 'Pelvic plate and drum driving each hind leg about the hip pin.' },
  { id: 'thigh', no: '13', name: 'Thigh Strut', short: 'Thigh', priority: 3, annotate: true,
    mat: { azure: 'Porcelain · Azure plate', obsidian: 'Oxidized steel · Azure steel' }, qty: '2',
    desc: 'Heavy femur strut. The stifle points forward, opposite to the elbow.' },
  { id: 'shank', no: '14', name: 'Shank & Hock', short: 'Shank', priority: 3, annotate: true,
    mat: { azure: 'Porcelain · Gold rod', obsidian: 'Oxidized steel · Warm silver rod' }, qty: '2',
    desc: 'Lower hind leg carrying the stifle piston down to the hock joint.' },
  { id: 'paw', no: '15', name: 'Paw Assembly', short: 'Paw', priority: 1, annotate: true,
    mat: { azure: 'Porcelain · Navy pads · Gold claws', obsidian: 'Oxidized steel · Carbon pads' }, qty: '4',
    desc: 'Four toes on a sprung pad. Stays level with the ground through every stance.' },
  { id: 'tail', no: '16', name: 'Sickle Tail', short: 'Tail', priority: 1, annotate: true,
    mat: { azure: 'Azure enamel · Porcelain tip', obsidian: 'Oxidized steel · Ivory tip' }, qty: '7',
    desc: 'Seven links curled over the back. Sways with the trot and idles slowly at rest.' },
  // Không gắn nhãn, nhưng vẫn hover/click/inspect được
  { id: 'cover', no: '—', name: 'Saddle Plate', short: 'Saddle', priority: 3, annotate: false,
    mat: { azure: 'Azure enamel · Gold trim', obsidian: 'Oxidized steel · Bronze trim' }, qty: '1',
    desc: 'Dorsal plate over the drive bay — the dark saddle of the coat. Lifts away first.' },
  { id: 'belly', no: '—', name: 'Ventral Keel', short: 'Keel', priority: 3, annotate: false,
    mat: { azure: 'Navy lacquer', obsidian: 'Carbon' }, qty: '1', desc: 'Keel plate closing the underside of the chest.' },
  { id: 'nose', no: '—', name: 'Scent Sensor', short: 'Nose', priority: 3, annotate: false,
    mat: { azure: 'Navy lacquer', obsidian: 'Carbon' }, qty: '1', desc: 'Sealed sensor block at the tip of the muzzle.' },
];

/** @type {Record<string, CatalogEntry>} */
export const BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

/** Thông số danh nghĩa (không đo được từ hình học). */
export const NOMINAL = { massKg: 23.5 };

/** Mô tả tổng thể trong khối SPECIFICATION, theo chủ đề. */
export const SPEC_DESC = {
  azure: 'A mechanical sled dog in porcelain, gold and azure enamel, built on a trotting quadruped frame. Trace any component with the pointer; select it to isolate.',
  obsidian: 'A mechanical sled dog in oxidized steel, bronze and ivory, built on a trotting quadruped frame. Trace any component with the pointer; select it to isolate.',
};
