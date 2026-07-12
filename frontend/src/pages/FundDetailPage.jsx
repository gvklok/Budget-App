import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ChevronLeft, ArrowRightLeft, ShoppingBag, AlertTriangle,
  Wallet, PiggyBank, TrendingUp, RotateCcw, SlidersHorizontal,
} from 'lucide-react'
import { fmt, toCents, apiGet, apiPost, monthLabel } from '../api'
import { colorForId, LINE, LINE_STRONG, INK_3, CARD, areaGradientId } from '../theme'
import Modal from '../components/Modal'
import TransferModal from '../components/TransferModal'
import { Card, SectionLabel, Badge, PrimaryButton, EmptyState } from '../components/ui'

function c(cents) {
  return fmt(cents / 100)
}

const inputClass =
  'w-full border border-line rounded-2xl px-3.5 py-2.5 text-ink outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-shadow bg-card'
const labelClass = 'block text-sm font-medium text-ink-2 mb-1.5'

function refreshDevOverlay() {
  window.dispatchEvent(new Event('dev-refresh'))
}

// ── Balance-over-time chart ──────────────────────────────────────────────────
// Single series → no legend (the card title names it); step-after
// interpolation because a Fund's balance is flat between ledger events, not
// a smooth interpolation between them. See dataviz skill: choosing-a-form +
// marks-and-anatomy.

const VIEW_W = 320
const VIEW_H = 176
const M = { top: 14, right: 12, bottom: 30, left: 50 }
const PLOT_W = VIEW_W - M.left - M.right
const PLOT_H = VIEW_H - M.top - M.bottom

function niceNumber(range, round) {
  if (range === 0) return 1
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / Math.pow(10, exponent)
  let niceFraction
  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }
  return niceFraction * Math.pow(10, exponent)
}

// Ticks computed in whole dollars (balances are cents, but round-dollar ticks
// read cleaner), then scaled back to cents for the y-domain.
function niceTicksDollars(minDollars, maxDollars, tickCount = 4) {
  if (minDollars === maxDollars) {
    minDollars -= 1
    maxDollars += 1
  }
  const range = niceNumber(maxDollars - minDollars, false)
  const step = Math.max(1, niceNumber(range / (tickCount - 1), true))
  const niceMin = Math.floor(minDollars / step) * step
  const niceMax = Math.ceil(maxDollars / step) * step
  const ticks = []
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Math.round(v))
  return { min: niceMin, max: niceMax, ticks }
}

function tickLabel(dollars) {
  const sign = dollars < 0 ? '-' : ''
  return `${sign}$${Math.abs(dollars).toLocaleString('en-US')}`
}

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Month-only label for intermediate x-axis ticks — computed from a UTC
// timestamp (Date.parse of 'YYYY-MM-DD' is UTC), so format in UTC too or the
// month can shift by a day near midnight in negative-offset time zones.
function monthAbbrev(t) {
  return new Date(t).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}

function BalanceChart({ series, color, currentBalanceCents }) {
  const containerRef = useRef(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  // Seeded by a stable React id, not the color — `color` is a `var(--x)`
  // CSS-variable string (theme.js), which isn't safe to splice into an SVG
  // id/url() fragment. Hook called unconditionally, above the early return.
  const gradId = areaGradientId(useId().replace(/:/g, ''))

  if (!series || series.length < 2) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-ink-3">
          Not enough history yet to chart a trend — current balance is{' '}
          <span className="font-semibold text-ink-2">{c(currentBalanceCents)}</span>.
        </p>
      </div>
    )
  }

  const points = series.map((p) => ({ t: Date.parse(p.date), v: p.balance_cents, date: p.date }))
  const minT = points[0].t
  const maxT = points[points.length - 1].t
  const dataMin = Math.min(...points.map((p) => p.v))
  const dataMax = Math.max(...points.map((p) => p.v))

  // Always include $0 in the domain — it's the meaningful boundary between
  // "funded" and "Recovering" for a Fund, whether or not this series crosses it.
  const { ticks, min: domainMinDollars, max: domainMaxDollars } = niceTicksDollars(
    Math.min(0, dataMin) / 100,
    Math.max(0, dataMax) / 100
  )
  const domainMin = domainMinDollars * 100
  const domainMax = domainMaxDollars * 100
  const crossesZero = dataMin < 0 && dataMax > 0

  const x = (t) => M.left + (maxT === minT ? PLOT_W / 2 : PLOT_W * ((t - minT) / (maxT - minT)))
  const y = (v) => M.top + PLOT_H - PLOT_H * ((v - domainMin) / (domainMax - domainMin || 1))
  const rightEdge = M.left + PLOT_W

  // 2-3 intermediate month ticks between the endpoint dates, spaced far enough
  // from the edges (and each other) that labels never crowd or overlap.
  const midXTicks = []
  if (maxT > minT) {
    const minGap = 34 // px, in viewBox units
    for (const frac of [0.25, 0.5, 0.75]) {
      const t = minT + (maxT - minT) * frac
      const tx = x(t)
      if (tx - M.left < minGap || rightEdge - tx < minGap) continue
      if (midXTicks.length && tx - midXTicks[midXTicks.length - 1].tx < minGap) continue
      midXTicks.push({ tx, label: monthAbbrev(t) })
    }
  }

  // Step-after corners: hold at v[i-1] until t[i], then jump to v[i]. Extend the
  // final value to the right edge — the balance holds there until "now".
  const corners = [[x(points[0].t), y(points[0].v)]]
  for (let i = 1; i < points.length; i++) {
    corners.push([x(points[i].t), y(points[i - 1].v)])
    corners.push([x(points[i].t), y(points[i].v)])
  }
  corners.push([rightEdge, y(points[points.length - 1].v)])

  const linePath = corners.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
  const zeroY = y(0)
  const areaPath = `${linePath} L ${rightEdge.toFixed(1)} ${zeroY.toFixed(1)} L ${corners[0][0].toFixed(1)} ${zeroY.toFixed(1)} Z`

  function handleMove(clientX) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const relX = ((clientX - rect.left) / rect.width) * VIEW_W
    // Nearest point by x among the actual data points (not the extended edge).
    let nearest = 0
    let best = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(x(p.t) - relX)
      if (d < best) { best = d; nearest = i }
    })
    setHoverIdx(nearest)
  }

  const hover = hoverIdx != null ? points[hoverIdx] : null
  const hoverX = hover ? x(hover.t) : 0
  const hoverY = hover ? y(hover.v) : 0

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchStart={(e) => handleMove(e.touches[0].clientX)}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      onTouchEnd={() => setHoverIdx(null)}
    >
      <svg width="100%" height={VIEW_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines + y ticks */}
        {ticks.map((t) => {
          const ty = y(t * 100)
          return (
            <g key={t}>
              <line x1={M.left} x2={rightEdge} y1={ty} y2={ty} stroke={LINE} strokeWidth="1" />
              <text x={M.left - 6} y={ty} textAnchor="end" dominantBaseline="middle" fontSize="9" fill={INK_3}>
                {tickLabel(t)}
              </text>
            </g>
          )
        })}
        {/* dashed zero line — only meaningful when the series actually crosses it */}
        {crossesZero && (
          <line x1={M.left} x2={rightEdge} y1={zeroY} y2={zeroY} stroke={LINE_STRONG} strokeWidth="1" strokeDasharray="3 3" />
        )}
        {/* x-axis endpoints (full date) + intermediate month ticks */}
        <text x={M.left} y={VIEW_H - 8} textAnchor="start" fontSize="9" fill={INK_3}>
          {shortDate(points[0].date)}
        </text>
        {midXTicks.map((mt) => (
          <text key={mt.tx} x={mt.tx} y={VIEW_H - 8} textAnchor="middle" fontSize="9" fill={INK_3}>
            {mt.label}
          </text>
        ))}
        <text x={rightEdge} y={VIEW_H - 8} textAnchor="end" fontSize="9" fill={INK_3}>
          {shortDate(points[points.length - 1].date)}
        </text>

        <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* end marker */}
        <circle cx={rightEdge} cy={y(points[points.length - 1].v)} r="4" fill={color} stroke={CARD} strokeWidth="2" />

        {/* hover crosshair */}
        {hover && (
          <>
            <line x1={hoverX} x2={hoverX} y1={M.top} y2={M.top + PLOT_H} stroke={LINE_STRONG} strokeWidth="1" strokeDasharray="2 2" />
            <circle cx={hoverX} cy={hoverY} r="4" fill={color} stroke={CARD} strokeWidth="2" />
          </>
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute bg-ink text-on-ink text-[11px] rounded-lg px-2 py-1 shadow-pop whitespace-nowrap -translate-x-1/2"
          style={{
            left: `${(hoverX / VIEW_W) * 100}%`,
            top: Math.max(0, hoverY - 34),
          }}
        >
          <span className="font-semibold">{c(hover.v)}</span>
          <span className="text-on-ink/60 ml-1.5">{shortDate(hover.date)}</span>
        </div>
      )}
    </div>
  )
}

// ── Activity feed helpers ────────────────────────────────────────────────────

const KIND_ICON = {
  paycheck: Wallet,
  transfer: ArrowRightLeft,
  top_off: TrendingUp,
  distribute: PiggyBank,
  spend: ShoppingBag,
  spend_reversal: RotateCcw,
  adjustment: SlidersHorizontal,
}

function bucketLabel(bucketId, fundNameById) {
  if (bucketId === 'savings') return 'Savings'
  if (bucketId === 'mr') return 'Monthly Reserve'
  if (bucketId === 'external') return 'External'
  if (bucketId?.startsWith('fund:')) {
    const id = bucketId.slice(5)
    return fundNameById[id] ?? 'a Fund'
  }
  return bucketId ?? 'Unknown'
}

function describeEntry(entry, bucket, fundNameById) {
  const isIn = entry.to_bucket === bucket
  const other = isIn ? entry.from_bucket : entry.to_bucket

  switch (entry.kind) {
    case 'distribute':
      return 'Monthly contribution'
    case 'transfer':
    case 'top_off':
      return `Transfer ${isIn ? 'from' : 'to'} ${bucketLabel(other, fundNameById)}`
    case 'spend':
      return entry.label || 'Spend'
    case 'spend_reversal':
      return `Reversed: ${entry.label || 'spend'}`
    case 'adjustment':
      return 'Manual adjustment'
    case 'paycheck':
      return entry.label || 'Paycheck'
    default:
      return entry.label || 'Activity'
  }
}

function ActivityRow({ entry, bucket, fundNameById }) {
  const isIn = entry.to_bucket === bucket
  const Icon = KIND_ICON[entry.kind] || SlidersHorizontal
  const text = describeEntry(entry, bucket, fundNameById)

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-9 h-9 rounded-full bg-paper flex items-center justify-center shrink-0">
        <Icon size={15} className="text-ink-2" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink truncate">{text}</p>
        <p className="text-xs text-ink-3 mt-0.5">{shortDate(entry.date)}</p>
      </div>
      <p className={`text-sm font-semibold tabular shrink-0 ${isIn ? 'text-good-ink' : 'text-ink'}`}>
        {isIn ? '+' : '−'}{c(Math.abs(entry.amount_cents))}
      </p>
    </div>
  )
}

function groupByMonth(activity) {
  const groups = []
  for (const entry of activity) {
    const ym = entry.date.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.ym === ym) {
      last.entries.push(entry)
    } else {
      groups.push({ ym, entries: [entry] })
    }
  }
  return groups
}

// ── Log spend modal ──────────────────────────────────────────────────────────

function LogSpendModal({ fund, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10)
  const [amount, setAmount] = useState('')
  const [merchant, setMerchant] = useState('')
  const [date, setDate] = useState(today)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const amountCents = toCents(amount)
  const amountInvalid = !amount || amountCents <= 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (amountInvalid) return setError('Enter an amount greater than $0')
    setSaving(true)
    setError('')
    try {
      await onSave({ amount_cents: amountCents, date, merchant: merchant.trim() || undefined, fund_id: fund.id })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Log spend — ${fund.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Amount</label>
          <input
            autoFocus
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            Merchant <span className="text-ink-3 font-normal">(optional)</span>
          </label>
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="e.g. Target"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving || amountInvalid} className="w-full">
          {saving ? 'Logging…' : 'Log Spend'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FundDetailPage() {
  const { id } = useParams()
  const [detail, setDetail] = useState(null)
  const [appState, setAppState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)
  const [showLogSpend, setShowLogSpend] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    setNotFound(false)
    try {
      const [d, s] = await Promise.all([apiGet(`/funds/${id}/detail`), apiGet('/state')])
      setDetail(d)
      setAppState(s)
    } catch (err) {
      if (/not found/i.test(err.message || '')) setNotFound(true)
      else setLoadError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  async function handleTransfer(data) {
    await apiPost('/transfers/', data)
    await load()
    refreshDevOverlay()
  }

  async function handleLogSpend(data) {
    await apiPost('/transactions/', data)
    await load()
    refreshDevOverlay()
  }

  if (notFound) {
    return (
      <div className="px-4 pt-6 pb-6">
        <Link to="/funds" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2 mb-4">
          <ChevronLeft size={16} /> Funds
        </Link>
        <EmptyState title="This fund doesn't exist — it may have been deleted." />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="px-4 pt-6 pb-6">
        <Link to="/funds" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2 mb-4">
          <ChevronLeft size={16} /> Funds
        </Link>
        <Card className="p-6 text-center">
          <p className="text-sm text-critical mb-4">{loadError}</p>
          <PrimaryButton onClick={load}>Retry</PrimaryButton>
        </Card>
      </div>
    )
  }

  if (loading || !detail || !appState) {
    return <div className="flex items-center justify-center h-64 text-ink-3">Loading…</div>
  }

  const { fund, activity, balance_series } = detail
  const color = colorForId(fund.id)
  const negative = fund.balance_cents < 0
  const bucket = `fund:${fund.id}`
  const fundNameById = Object.fromEntries(appState.funds.map((f) => [String(f.id), f.name]))
  const groups = groupByMonth(activity)

  const recoveryNote = fund.monthly_contribution_cents > 0
    ? `At ${c(fund.monthly_contribution_cents)}/mo, back to $0 in ~${Math.ceil(Math.abs(fund.balance_cents) / fund.monthly_contribution_cents)} months`
    : 'No contribution set — will not recover automatically'

  return (
    <div className="px-4 pt-6 pb-6">
      <Link to="/funds" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2 mb-4">
        <ChevronLeft size={16} /> Funds
      </Link>

      {/* Header */}
      <Card className="p-5 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          <p className="text-xs uppercase tracking-wide text-ink-3">Fund</p>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {negative && <AlertTriangle size={16} className="text-critical shrink-0" />}
          <h1 className="text-xl font-bold text-ink truncate">{fund.name}</h1>
        </div>
        <p className={`hero-figure text-5xl font-bold mt-2 ${negative ? 'text-critical' : 'text-ink'}`}>{c(fund.balance_cents)}</p>

        {negative && (
          <div className="mt-2">
            <Badge tone="critical">Recovering</Badge>
            <p className="text-xs text-ink-3 mt-1.5">{recoveryNote}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mt-3">
          {fund.destination_type === 'transfer_out' && <Badge tone="transfer">Transfer Out</Badge>}
          {fund.allow_negative_balance && <Badge tone="neutral">Allows negative</Badge>}
        </div>

        <p className="text-xs text-ink-3 mt-3">
          {fund.monthly_contribution_cents > 0
            ? `${c(fund.monthly_contribution_cents)} / month contribution`
            : 'No monthly contribution set'}
        </p>
      </Card>

      {/* Quick actions — Log spend is the one clear primary action */}
      <div className="flex items-center gap-2.5 mb-3">
        <button
          onClick={() => setShowTransfer(true)}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-ink-2 border border-line bg-card rounded-2xl py-2.5 active:scale-[0.98] transition-transform"
        >
          <ArrowRightLeft size={14} />
          Transfer
        </button>
        {/* Ink-black — the one sanctioned black pill, reserved for buttons
            that LOG money, deliberately distinct from the accent language. */}
        <button
          onClick={() => setShowLogSpend(true)}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-on-ink bg-ink hover:bg-ink/90 rounded-2xl py-2.5 active:scale-[0.98] transition-transform"
        >
          <ShoppingBag size={14} />
          Log spend
        </button>
      </div>

      {/* Balance over time */}
      <SectionLabel>Balance over time</SectionLabel>
      <Card className="p-4 mb-3">
        <BalanceChart series={balance_series} color={color} currentBalanceCents={fund.balance_cents} />
      </Card>

      {/* Activity */}
      <SectionLabel>Activity</SectionLabel>
      {groups.length === 0 ? (
        <EmptyState title="No activity yet for this fund" />
      ) : (
        <Card className="px-4 mb-3">
          {groups.map((group, gi) => (
            <div key={group.ym} className={gi > 0 ? 'border-t border-line pt-1' : ''}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 pt-3">
                {monthLabel(group.ym)}
              </p>
              <div className="divide-y divide-line">
                {group.entries.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} bucket={bucket} fundNameById={fundNameById} />
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      {showTransfer && (
        <TransferModal
          state={appState}
          initialTo={bucket}
          onClose={() => setShowTransfer(false)}
          onTransfer={handleTransfer}
        />
      )}
      {showLogSpend && (
        <LogSpendModal
          fund={fund}
          onClose={() => setShowLogSpend(false)}
          onSave={handleLogSpend}
        />
      )}
    </div>
  )
}
