// Design tokens as CSS-variable-backed color strings — for contexts Tailwind
// classes can't reach (SVG stroke/fill, canvas, inline gradients). Every
// value here resolves a custom property defined in index.css (:root for
// light, .dark for dark) — that file is the single source of truth for the
// actual RGB values; this file just names the concepts. Modern browsers
// resolve CSS custom properties inside SVG presentation attributes
// (fill="rgb(var(--x))"), so passing these straight into SVG props/inline
// styles repaints correctly when the `.dark` class toggles — no JS
// re-render needed. The index.css custom properties are bare "R G B"
// channel triplets (Tailwind's opacity-modifier convention — see
// tailwind.config.js), so every export here wraps its variable in `rgb()`;
// never reference the bare `var(--x)` form directly, it isn't a valid color
// on its own. Keep in sync with tailwind.config.js, which points the
// matching Tailwind color tokens at the same variables.
function rgbVar(name) {
  return `rgb(var(${name}))`
}

export const INK = rgbVar('--ink')
export const INK_2 = rgbVar('--ink-2')
export const INK_3 = rgbVar('--ink-3')
export const ON_INK = rgbVar('--on-ink') // readable-on-ink-surface text/icon color — see index.css
export const PAPER = rgbVar('--paper')
export const CARD = rgbVar('--card')
export const LINE = rgbVar('--line')
export const LINE_STRONG = rgbVar('--line-strong')

export const ACCENT = rgbVar('--accent') // solid-fill use (buttons) — paired with white/on-ink text
export const ACCENT_SOFT = rgbVar('--accent-soft')
export const ACCENT_INK = rgbVar('--accent-ink') // text/border-safe step — standalone text-accent/border-accent

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
//                chart segments. Deliberately an earthy brown/umber — bills
//                are obligation, sober, not fun (owner's call).
//   FUNDS_HUE    fund AGGREGATES — the Funds ring, fund progress bars,
//                funds-spent chart segments. Individual funds keep their
//                per-id colorForId identity in lists/legends/donuts; this
//                hue is only for the semantic/aggregate reading. Deliberately
//                a dusty-confident blue — funds are fun money (owner's call).
//   TRANSFER_OUT money moved to another account you own (401k, Roth, HSA) —
//                visibly NOT spending, and never wears warn/critical.
//   CRITICAL     overspend and negative balances only — the one true alarm.
//
// SAVING is deliberately decoupled from ACCENT: ACCENT is the interactive
// language (buttons, nav, focus rings); SAVING is the calm "money kept" hue
// — lighter and friendlier so Savings never reads as just "another button
// color." Validated with the dataviz skill's validator (mark contrast
// >=3:1 on both #ffffff and #f6f4ef paper) — re-validated after a one-step
// darken (owner's call, reads less "mint" against paper): 4.28:1 on
// #ffffff, 3.89:1 on #f6f4ef. Small/thin TEXT rendered in the SAVING family
// (chips, "+$150.00" amounts, "covered") uses SAVING_TEXT instead — a
// darker step of the same hue that clears 4.5:1 text contrast on white,
// paper, AND the saving-soft chip background. Dark-mode values are a
// separately re-tuned palette (brighter marks, brighter -TEXT step) —
// dataviz-validator-checked against both dark surfaces (#191713 / #23201b);
// see index.css .dark block for the numbers.
export const SAVING = rgbVar('--saving') // green — mark/fill use (bars, swatches, dots, large stat text)
export const SAVING_TEXT = rgbVar('--saving-ink') // text-safe variant — small text, chips, contribution amounts
export const SAVING_SOFT = rgbVar('--saving-soft') // tint for chip/badge backgrounds
// BILLS: warm clay/umber — mark/fill use (bars, rings, MR card, chart
// segments). Chroma/lightness/contrast validated (dataviz validator) against
// both light and dark surfaces. BILLS_TEXT is the text-safe step of the same
// hue for small TEXT uses (the "Funded" badge).
export const BILLS = rgbVar('--bills') // clay/umber — mark/fill use
export const BILLS_TEXT = rgbVar('--bills-ink') // text-safe variant — small text (badges)
// FUNDS_HUE: dusty-confident blue — mark/fill use. Kept visually distinct
// from CHART_COLORS' own dusty-blue identity slot (nudged lighter/more
// periwinkle, see below) so a blue fund's identity dot is never confusable
// with this semantic aggregate hue when the two sit adjacent (Expenses fund
// rows, Overview donut/legend). FUNDS_TEXT is the text-safe step for small
// TEXT uses (e.g. a "funds" Badge) — equals FUNDS_HUE in light mode (already
// clears 4.5:1there) but diverges in dark mode.
export const FUNDS_HUE = rgbVar('--funds') // dusty-confident blue — mark/fill use
export const FUNDS_TEXT = rgbVar('--funds-ink') // text-safe variant — small text (badges)
export const TRANSFER_OUT = rgbVar('--transfer') // neutral stone

// GOOD is a deliberate alias of SAVING, not a second green — the app has
// exactly one green and it always means "kept/saved."
export const GOOD = SAVING
export const GOOD_TEXT = SAVING_TEXT
export const WARN = rgbVar('--warn')
export const CRITICAL = rgbVar('--critical')
export const CRITICAL_SOFT = rgbVar('--critical-soft')

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
// The dusty-blue slot is nudged lighter/more periwinkle than the semantic
// FUNDS_HUE above (ΔE ~14, re-validated) specifically so a blue fund's
// identity dot never reads as "the same blue" as the Funds aggregate hue
// when they sit side by side.
//
// Dark-mode values are a separately brightened/re-saturated 7-hue set (not
// an auto-invert), re-run through the same validator against both dark
// surfaces (#191713 / #23201b): lightness band + chroma floor pass all 7 on
// both, worst adjacent CVD ΔE 25.2 (plum↔rose), all 7 clear 3:1 contrast.
export const CHART_COLORS = [
  rgbVar('--chart-1'), // sage
  rgbVar('--chart-2'), // periwinkle blue (identity) — distinct from FUNDS_HUE's deeper dusty blue
  rgbVar('--chart-3'), // terracotta
  rgbVar('--chart-4'), // teal
  rgbVar('--chart-5'), // ochre
  rgbVar('--chart-6'), // rose
  rgbVar('--chart-7'), // plum
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
// SAVING green, Monthly Reserve is BILLS umber (bills route to MR).
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
