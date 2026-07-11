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

// Calm "on-plan" fill for Bills/Funds sitting at or under their budget — 100%
// spent on a Bill is normal, not a warning, so it must never read as heavy or
// alarming. A light-but-present sage keeps a filled bar legible as "done"
// without the wall-of-black-bars weight of a near-ink fill. Overspend still
// escalates to CRITICAL; this is only ever the calm state.
export const CALM = '#a8bb92'
export const CALM_SOFT = '#eef2e7'

// Fixed-order categorical palette for chart segments (fund/category identity).
// A curated 7-hue "muted-rich" family — sage, dusty blue, terracotta, teal,
// ochre, rose, plum — designed to harmonize with the warm paper surface and
// deep-green accent rather than read as a generic chart-library rainbow.
// Validated with the dataviz skill's validator against both surfaces this app
// paints on (#ffffff cards, #f6f4ef paper): lightness band + chroma floor pass
// all 7 slots on both; worst adjacent CVD ΔE 26.1 (well clear of the 12
// target). Ochre sits just under 3:1 against the paper surface (WARN, 2.95) —
// legal only because every use here pairs a swatch with a direct text label,
// never color-alone identification (the relief rule). The order below IS the
// CVD-safety mechanism
// (it keeps the two warm oranges — terracotta/ochre — from ever touching) —
// don't reorder casually; re-run the validator if you do. Never cycle — an
// nth category beyond this list should fold into an "Other" slot rather than
// repeating a color.
export const CHART_COLORS = [
  '#5f8a3f', // sage
  '#3a6bb0', // dusty blue
  '#c1652f', // terracotta
  '#0f8f79', // teal
  '#b8862b', // ochre
  '#c25a76', // rose
  '#7a4f8a', // plum
]

// Deterministic entity color — same id always maps to the same CHART_COLORS
// slot, regardless of render order or which page is looking at it. Numeric
// ids (funds, categories, ...) map directly; non-numeric ids fall back to a
// tiny string hash so this still degrades gracefully.
export function colorForId(id) {
  const n = Number(id)
  if (Number.isFinite(n)) {
    return CHART_COLORS[Math.abs(Math.trunc(n)) % CHART_COLORS.length]
  }
  const str = String(id)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length]
}

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

// Adds a `<linearGradient>` def (top color → transparent) and returns the
// fill url() to reference it — the shared "soft area under a line" treatment
// used by both the fund-detail balance chart and Balance Trends' Real Cash
// line. Keep the id unique per chart instance (component-scoped) so multiple
// gradient charts on one page never collide.
export function areaGradientId(seed) {
  return `area-grad-${seed}`
}
