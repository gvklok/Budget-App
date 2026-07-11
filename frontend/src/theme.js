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

// ── Semantic money-concept colors ──────────────────────────────────────────
// Every color that represents a money CONCEPT (not a UI affordance like a
// button) does exactly one of these four jobs, app-wide. A hue is never
// reused for a different concept — that's what made the old palette read as
// "everything is a shade of green." See CLAUDE.md's money model: three
// buckets (Savings, Monthly Reserve, Funds) plus the honest transfer-out /
// critical states.
//
//   SAVING       money kept/saved — the Savings bucket, "% saved" chips,
//                +contribution amounts, savings-rate visuals. The ONLY green
//                in the app.
//   BILLS        Bills AND Monthly Reserve (bills route to MR — one concept,
//                one hue) — the Bills ring/bars, the MR card, bills-spent
//                chart segments.
//   FUNDS_HUE    fund AGGREGATES — the Funds ring, fund progress bars,
//                funds-spent chart segments. Individual funds keep their
//                per-id colorForId identity in lists/legends/donuts; this
//                hue is only for the semantic/aggregate reading.
//   TRANSFER_OUT money moved to another account you own (401k, Roth, HSA) —
//                visibly NOT spending, and never wears warn/critical.
//   CRITICAL     overspend and negative balances only — the one true alarm.
//
// SAVING is deliberately decoupled from ACCENT: ACCENT is the interactive
// language (buttons, nav, focus rings); SAVING is the calm "money kept" hue
// — lighter and friendlier so Savings never reads as just "another button
// color." Validated with the dataviz skill's validator (mark contrast
// >=3:1 on both #ffffff and #f6f4ef paper). Small/thin TEXT rendered in the
// SAVING family (chips, "+$150.00" amounts, "covered") uses SAVING_TEXT
// instead — a darker step of the same hue that clears 4.5:1 text contrast
// on white, paper, AND the saving-soft chip background.
export const SAVING = '#3a9c69' // lighter, friendlier green — mark/fill use (bars, swatches, dots, large stat text)
export const SAVING_TEXT = '#286b49' // darker text-safe variant — small text, chips, contribution amounts
export const SAVING_SOFT = '#e7f3ed' // light tint for chip/badge backgrounds
export const BILLS = '#3e6c8c' // slate-blue
export const FUNDS_HUE = '#c1652f' // warm terracotta
export const TRANSFER_OUT = '#9c9484' // neutral stone

// GOOD is a deliberate alias of SAVING, not a second green — the app has
// exactly one green and it always means "kept/saved."
export const GOOD = SAVING
export const GOOD_TEXT = SAVING_TEXT
export const WARN = '#a8791f'
export const CRITICAL = '#b23b2e'

// On-plan fills for Bills/Funds sitting at or under their budget — 100%
// spent is normal, not a warning, so it must never read as heavy or
// alarming. Overspend still escalates to CRITICAL; these are only ever the
// calm, in-plan state, one hue per concept (see semantic colors above).
export function billStatusColor(pct) {
  return pct > 100 ? CRITICAL : BILLS
}
export function fundStatusColor(pct) {
  return pct > 100 ? CRITICAL : FUNDS_HUE
}

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

// Dedicated swatches for Savings/Monthly Reserve in the Real Cash breakdown —
// kept out of CHART_COLORS so they never collide with a Fund's assigned
// color. These now just alias the semantic concept colors above: Savings is
// SAVING green, Monthly Reserve is BILLS slate (bills route to MR).
export const SAVINGS_SWATCH = SAVING
export const RESERVE_SWATCH = BILLS

// Adds a `<linearGradient>` def (top color → transparent) and returns the
// fill url() to reference it — the shared "soft area under a line" treatment
// used by both the fund-detail balance chart and Balance Trends' Real Cash
// line. Keep the id unique per chart instance (component-scoped) so multiple
// gradient charts on one page never collide.
export function areaGradientId(seed) {
  return `area-grad-${seed}`
}
