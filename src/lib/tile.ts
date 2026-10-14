// Puzzle tiling for open (non-maximized) applets inside the safe area. No overlap, equal gutters.
// 1 → full, 2 → side by side, 3 → 1 large left + 2 stacked right, 4 → 2×2, 5+ → balanced grid (last row stretched).
export interface R { x: number; y: number; w: number; h: number }
export function tile(n: number, a: R, g = 12, stack = false): R[] {
  if (n <= 0) return []; const out: R[] = [];
  const cell = (x: number, y: number, w: number, h: number) => out.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  if (stack) { const h = (a.h - g * (n - 1)) / n; for (let i = 0; i < n; i++) cell(a.x, a.y + i * (h + g), a.w, h); return out; }
  if (n === 1) { cell(a.x, a.y, a.w, a.h); return out; }
  if (n === 2) { const w = (a.w - g) / 2; cell(a.x, a.y, w, a.h); cell(a.x + w + g, a.y, w, a.h); return out; }
  if (n === 3) { const w = (a.w - g) / 2, h = (a.h - g) / 2; cell(a.x, a.y, w, a.h); cell(a.x + w + g, a.y, w, h); cell(a.x + w + g, a.y + h + g, w, h); return out; }
  const cols = Math.ceil(Math.sqrt(n * (a.w / a.h) / 1.6)) || 1, c = Math.max(2, Math.min(n, cols)), rows = Math.ceil(n / c), h = (a.h - g * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) { const k = r === rows - 1 ? n - c * (rows - 1) : c, w = (a.w - g * (k - 1)) / k; for (let i = 0; i < k; i++) cell(a.x + i * (w + g), a.y + r * (h + g), w, h); }
  return out;
}
export const overlaps = (p: R, q: R) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
