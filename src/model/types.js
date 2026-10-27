// @ts-check
// Kiểu dữ liệu dùng chung giữa khung (model/, components/) và các mẫu vật (specimens/).
// Chỉ có JSDoc typedef — không có mã chạy. Nằm ở model/ để code dùng chung không phải import specimens/.

/**
 * Một mục trong catalog của mẫu vật. `id` = catalogId (nhóm logic, ví dụ "servo"); các part cụ thể
 * (instanceId, ví dụ "servo-R-fore") mang `kind` = catalogId.
 * priority: 1 = luôn hiện (kể cả điện thoại), 2 = tablet trở lên, 3 = chỉ desktop.
 * @typedef {{
 *   id: string, no: string, name: string, short: string, desc: string,
 *   mat: {azure: string, obsidian: string}, qty: string, priority: 1|2|3, annotate: boolean,
 * }} CatalogEntry
 */

export {};
