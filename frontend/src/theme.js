// Design tokens as raw hex — for contexts Tailwind classes can't reach
// (SVG stroke/fill, canvas, inline gradients). Keep in sync with tailwind.config.js.

export const INK = '#17140f'
export const INK_2 = '#5c574a'
export const INK_3 = '#9c9484'
export const PAPER = '#f6f4ef'
export const CARD = '#ffffff'
export const LINE = '#eae5d9'
export const LINE_STRONG = '#ddd5c4'

export const ACCENT = '#0f5c52'
export const ACCENT_SOFT = '#e4efea'

export const GOOD = '#1f8a4c'
export const WARN = '#a8791f'
export const CRITICAL = '#b23b2e'

// Fixed-order categorical palette for chart segments (fund/category identity).
// Validated: OKLCH lightness band + chroma floor + CVD adjacent-pair separation
// all pass at 8 slots (aqua-led order). Never cycle — an nth category beyond
// this list should fold into an "Other" slot rather than repeating a color.
export const CHART_COLORS = [
  '#1baf7a', // aqua/teal
  '#2a78d6', // blue
  '#4a3aa7', // violet
  '#008300', // green
  '#e87ba4', // magenta
  '#eda100', // gold
  '#e34948', // red
  '#eb6834', // orange
]

export function statusColor(pct) {
  if (pct > 100) return CRITICAL
  if (pct >= 85) return WARN
  return GOOD
}

export function statusSoft(pct) {
  if (pct > 100) return '#f8e7e4'
  if (pct >= 85) return '#fbf1de'
  return '#e7f4ec'
}

// Dedicated swatches for Savings/Monthly Reserve in the Real Cash breakdown —
// kept out of CHART_COLORS so they never collide with a Fund's assigned color.
export const SAVINGS_SWATCH = '#9c9484'
export const RESERVE_SWATCH = '#3e7c8c'
