// @ts-check

export const isCoarsePointer = () => window.matchMedia('(pointer: coarse)').matches;

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** DPR khởi đầu: không vượt 2 (iPhone DPR 3 → 2) để GPU di động không quá tải. */
export const initialDpr = () => Math.min(window.devicePixelRatio || 1, 2);

/**
 * @param {number} w @param {number} h
 * @returns {'desktop'|'tablet'|'mobile'|'phone-landscape'}
 */
export function viewportClass(w, h) {
  if (h < 500 && w > h) return 'phone-landscape';
  if (w < 700) return 'mobile';
  if (w < 1280) return 'tablet';
  return 'desktop';
}
