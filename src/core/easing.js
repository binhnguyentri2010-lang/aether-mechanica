// @ts-check

/** @param {number} x @param {number} [a] @param {number} [b] */
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

/** @param {number} a @param {number} b @param {number} t */
export const lerp = (a, b, t) => a + (b - a) * t;

/** @param {number} t */
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** @param {number} t */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** @param {number} a @param {number} b @param {number} x */
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Góc ngắn nhất từ a tới b (radian). @param {number} a @param {number} b */
export const angleDelta = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const DEG = Math.PI / 180;
