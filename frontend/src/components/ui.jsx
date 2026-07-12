import { useState, useEffect, useRef } from 'react'
import { MoreHorizontal, Check } from 'lucide-react'
import { LINE, CHART_COLORS_HEX, EXTRA_SWATCH_COLORS } from '../theme'

// ── Ring — single-value circular progress ─────────────────────────────────────
// Used for "how much of this budget/target have I used" at a glance. Rounded
// caps, animates in on mount, clamps the drawn arc at 100% but callers can still
// pass >100 for color/label purposes (an overspent ring reads full + critical).

// Drawn as two arcs (progress + remaining track) with a small gap at each seam —
// same technique the category donut uses — so progress reads as its own piece
// instead of bleeding into the track color around it.
export function Ring({ pct, size = 72, stroke = 8, color, trackColor = LINE, children, animate = true }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const drawn = Math.min(Math.max(pct, 0), 100)
  const remaining = 100 - drawn
  const GAP = 4 // px gap at each seam between the progress arc and the track arc

  const segments = []
  if (drawn > 0) segments.push({ frac: drawn / 100, color })
  if (remaining > 0) segments.push({ frac: remaining / 100, color: trackColor })
  const twoSegments = segments.length > 1

  let cum = 0

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((seg, i) => {
          const full = seg.frac * circ
          const dash = twoSegments ? Math.max(0, full - GAP) : full
          const rot = -90 + cum * 360
          cum += seg.frac
          const isProgress = i === 0
          return (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={seg.color} strokeWidth={stroke} strokeLinecap="butt"
              strokeDasharray={`${dash} ${circ}`}
              transform={`rotate(${rot} ${size / 2} ${size / 2})`}
              style={isProgress && animate ? { '--ring-circ': dash, strokeDashoffset: 0 } : undefined}
              className={isProgress && animate ? 'ring-animate' : ''}
            />
          )
        })}
      </svg>
      {children != null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
      )}
    </div>
  )
}

// ── Bar — linear progress ──────────────────────────────────────────────────────

export function Bar({ pct, color, trackColor = LINE, height = 7, animate = true }) {
  const drawn = Math.min(Math.max(pct, 0), 100)
  return (
    <div className="rounded-full overflow-hidden w-full" style={{ height, background: trackColor }}>
      <div
        className={`h-full ${animate ? 'bar-animate' : ''}`}
        style={{ width: `${drawn}%`, background: color }}
      />
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────────────────────────

export function Card({ children, className = '', ink = false, as: As = 'div', ...rest }) {
  return (
    <As
      className={`rounded-3xl shadow-card ${ink ? 'bg-ink text-on-ink' : 'bg-card border border-line'} ${className}`}
      {...rest}
    >
      {children}
    </As>
  )
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

export function SectionLabel({ children, action }) {
  return (
    <div className="flex items-center justify-between px-1 mb-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{children}</p>
      {action}
    </div>
  )
}

// ── GroupDivider ──────────────────────────────────────────────────────────────
// A quiet, card-less label that groups a run of cards into a named cluster
// (e.g. Overview's "This Month" vs "Over This Period" story split) — ambient
// structure, not another card, so it never competes with the cards around it.

export function GroupDivider({ children }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 px-1 pt-1 mb-2">
      {children}
    </p>
  )
}

// ── Badge ───────────────────────────────────────────────────────────────────────

const BADGE_TONES = {
  neutral: 'bg-paper text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  // alias of `saving` — the app's one green. `-ink` is the darker text-safe
  // step (>=4.5:1 on the soft chip background), never the lighter fill hue.
  good: 'bg-good-soft text-good-ink',
  saving: 'bg-saving-soft text-saving-ink',
  // `-ink` is the darker text-safe step (>=4.5:1 on the soft chip
  // background) — same pattern as good/saving above; DEFAULT is reserved
  // for fills/marks, never small text.
  bills: 'bg-bills-soft text-bills-ink',
  funds: 'bg-funds-soft text-funds-ink',
  transfer: 'bg-transfer-soft text-transfer',
  warn: 'bg-warn-soft text-warn',
  critical: 'bg-critical-soft text-critical',
}

export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}

// ── IconButton ────────────────────────────────────────────────────────────────

export function IconButton({ children, className = '', compact = false, ...rest }) {
  const size = compact ? 'w-7 h-7' : 'w-8 h-8'
  return (
    <button
      className={`${size} flex items-center justify-center rounded-full text-ink-3 hover:bg-paper hover:text-ink-2 transition-colors ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

// ── Buttons ───────────────────────────────────────────────────────────────────

// Solid accent — THE primary action on a screen. One button language across
// the app, with one deliberate exception: `variant="ink"` — the sanctioned
// black pill reserved for buttons that LOG money (Expenses "Log", Fund
// "Log spend"), so they read as a distinct, weightier action against the
// accent language everywhere else. Never flip the default to ink.
// `text-on-ink` (not `text-white`) — in dark mode `ink` inverts to a light
// pill, so its label must invert too (dark text) to stay the standout.
const PRIMARY_BUTTON_VARIANTS = {
  accent: 'bg-accent hover:bg-accent-hover text-white',
  ink: 'bg-ink hover:bg-ink/90 text-on-ink',
}

export function PrimaryButton({ children, className = '', variant = 'accent', ...rest }) {
  return (
    <button
      className={`${PRIMARY_BUTTON_VARIANTS[variant]} font-semibold rounded-2xl py-3 px-4 disabled:opacity-40 active:scale-[0.98] transition-transform ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

// Soft accent — a secondary action that still reads as "on brand" without
// competing with PrimaryButton for attention.
export function AccentButton({ children, className = '', ...rest }) {
  return (
    <button
      className={`bg-accent-soft text-accent-ink font-semibold rounded-2xl py-3 px-4 disabled:opacity-40 active:scale-[0.98] transition-transform ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────

export function EmptyState({ title, action }) {
  return (
    <div className="rounded-3xl border border-dashed border-line-strong p-8 text-center">
      <p className="text-ink-3 text-sm mb-2">{title}</p>
      {action}
    </div>
  )
}

// ── OverflowMenu — "⋯" popover for secondary section-header actions ─────────
// Section headers accumulate controls fast (Add, Distribute, Categories,
// Reorder, ...); the primary 1-2 actions stay inline, everything else
// collapses behind one MoreHorizontal icon button. Calm ink-text rows, no
// icons required. Closes on outside tap or Escape — no other affordance.
export function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('touchstart', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <IconButton compact onClick={() => setOpen((v) => !v)} aria-label="More actions" aria-expanded={open}>
        <MoreHorizontal size={16} />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 min-w-[168px] rounded-2xl bg-card border border-line shadow-pop py-1.5">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); item.onClick() }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-ink text-left hover:bg-paper transition-colors"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ColorSwatchPicker — custom identity color for a Fund/Bill ────────────────
// "Auto" (dashed ring, filled with the computed fallback color) + the 7
// CHART_COLORS identity hues + 5 curated extras — one compact, wrapping row.
// No free-form color wheel, by design (see CLAUDE.md-adjacent task spec).
// `value` is a hex string or null (null === Auto); `onChange(hex | null)`.
const SWATCH_COLORS = [...CHART_COLORS_HEX, ...EXTRA_SWATCH_COLORS]

export function ColorSwatchPicker({ value, onChange, autoColor, label = 'Color' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink-2 mb-1.5">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Auto"
          aria-label="Auto color"
          aria-pressed={value == null}
          className="w-7 h-7 rounded-full shrink-0 border-2 border-dashed border-line-strong flex items-center justify-center transition-transform active:scale-90"
          style={{ background: autoColor }}
        >
          {value == null && <Check size={13} className="text-white" strokeWidth={3} style={{ filter: 'drop-shadow(0 0 1.5px rgb(0 0 0 / 0.5))' }} />}
        </button>
        {SWATCH_COLORS.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onChange(hex)}
            title={hex}
            aria-label={`Color ${hex}`}
            aria-pressed={value === hex}
            className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center transition-transform active:scale-90 ${
              value === hex ? 'ring-2 ring-ink ring-offset-2 ring-offset-card' : ''
            }`}
            style={{ background: hex }}
          >
            {value === hex && <Check size={13} className="text-white" strokeWidth={3} style={{ filter: 'drop-shadow(0 0 1.5px rgb(0 0 0 / 0.5))' }} />}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Segmented (2-way tab toggle) ─────────────────────────────────────────────

export function Segmented({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1 bg-paper rounded-xl p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            value === opt.value ? 'bg-card text-ink shadow-sm' : 'text-ink-3'
          }`}
        >
          {opt.icon}{opt.label}
        </button>
      ))}
    </div>
  )
}
