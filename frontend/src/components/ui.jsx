import { LINE } from '../theme'

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
      className={`rounded-3xl shadow-card ${ink ? 'bg-ink text-white' : 'bg-card border border-line'} ${className}`}
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

// ── Badge ───────────────────────────────────────────────────────────────────────

const BADGE_TONES = {
  neutral: 'bg-paper text-ink-2',
  accent: 'bg-accent-soft text-accent',
  good: 'bg-good-soft text-good',
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
// the app: no ink-black pills.
export function PrimaryButton({ children, className = '', ...rest }) {
  return (
    <button
      className={`bg-accent hover:bg-accent-hover text-white font-semibold rounded-2xl py-3 px-4 disabled:opacity-40 active:scale-[0.98] transition-transform ${className}`}
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
      className={`bg-accent-soft text-accent font-semibold rounded-2xl py-3 px-4 disabled:opacity-40 active:scale-[0.98] transition-transform ${className}`}
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

// ── Segmented (2-way tab toggle) ─────────────────────────────────────────────

export function Segmented({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1 bg-paper rounded-xl p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            value === opt.value ? 'bg-white text-ink shadow-sm' : 'text-ink-3'
          }`}
        >
          {opt.icon}{opt.label}
        </button>
      ))}
    </div>
  )
}
