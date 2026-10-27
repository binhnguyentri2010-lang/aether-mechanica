// @ts-check
// Kiểm "0 request ra ngoài": mọi tài nguyên trình duyệt đã nạp phải là nội bộ.

/** @returns {string[]} URL http(s) không thuộc localhost */
export function externalRequests() {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i;
  return performance.getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => /^https?:/i.test(u) && !local.test(u));
}
