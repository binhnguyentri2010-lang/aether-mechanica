// @ts-check
// Hằng số của SÂN KHẤU (khung W, plan đợt 3 §6) — nguồn DUY NHẤT, mọi nơi đọc từ đây.

/** Mặt sàn: đáy blueprint, bóng đổ, đế bàn chân husky đều nằm trên mặt này (toạ độ root). */
export const GROUND_Y = -0.95;

/** Bóng đổ nhấc lên một chút so với sàn để không z-fighting với nét blueprint. */
export const SHADOW_Y = GROUND_Y + 0.002;
