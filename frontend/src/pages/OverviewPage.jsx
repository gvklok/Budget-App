import { useState, useEffect, useCallback, useRef } from 'react'
import { LayoutDashboard, ChevronLeft, ChevronRight } from 'lucide-react'
import { apiGet, fmt } from '../api'
import { colorForId, CHART_COLORS, SAVINGS_SWATCH, RESERVE_SWATCH, GOOD, CRITICAL, ACCENT, INK, CALM, INK_3, LINE } from '../theme'
import { Card, SectionLabel, EmptyState, Segmented, PrimaryButton, IconButton, Bar } from '../components/ui'

// ── shared money/date helpers ─────────────────────────────────────────────────

function c(cents) {
  return fmt((cents ?? 0) / 100)
}

function fmtTick(cents) {
  const dollars = Math.round(cents / 100)
  const sign = dollars < 0 ? '-' : ''
  return `${sign}$${Math.abs(dollars).toLocaleString('en-US')}`
}

function monthShortLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' })
}

function monthFullLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function shiftYM(year, month, delta) {
  let m = month - 1 + delta
  let y = year + Math.floor(m / 12)
  m = ((m % 12) + 12) % 12
  return { year: y, month: m + 1 }
}

// Standard "nice number" tick algorithm — clean rounded steps rather than raw
// division, so axis labels read as $500 / $1,000, never $487 / $974.
function niceNum(range, round) {
  if (range <= 0) return 1
  const exp = Math.floor(Math.log10(range))
  const frac = range / Math.pow(10, exp)
  let niceFrac
  if (round) {
    if (frac < 1.5) niceFrac = 1
    else if (frac < 3) niceFrac = 2
    else if (frac < 7) niceFrac = 5
    else niceFrac = 10
  } else {
    if (frac <= 1) niceFrac = 1
    else if (frac <= 2) niceFrac = 2
    else if (frac <= 5) niceFrac = 5
    else niceFrac = 10
  }
  return niceFrac * Math.pow(10, exp)
}

function niceTicks(min, max, count = 4) {
  if (min === max) {
    min -= 1
    max += 1
  }
  const range = niceNum(max - min, false)
  const step = niceNum(range / (count - 1), true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks = []
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Math.round(v))
  return ticks
}

const FUNDS_TOTAL_COLOR = CHART_COLORS[2] // violet — stable, distinct from savings/reserve swatches

// ── Kept vs Spent — stacked bar (spent + transfers out + kept), the headline ──
// Form: one stacked bar per month (spent bottom, transfers middle, kept top),
// bar height = spent + transfers + max(kept, 0). A dashed income tick marks
// where income landed, so an overspent month (kept clamped to 0) visibly rises
// above its own income line — the honest way to show a leak without a second axis.
// Real SVG plot (own margins) so ticks/bars can never escape the card, unlike the
// old absolutely-positioned div stack.

// Path for a rect with only its top two corners rounded — used for the topmost
// segment of each stack so straight seams stay flat everywhere else.
function topRoundedRectPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h, w / 2))
  if (rr < 0.5) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`
  return `M ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} H ${x} Z`
}

function KeptVsSpentChart({ months }) {
  const n = months.length
  // viewBox sized close to the real mobile card width (390 viewport − page
  // padding − card padding) so the SVG's own aspect ratio roughly matches its
  // rendered box. A large mismatch here (the old 640×214) makes the browser's
  // default "meet" scaling shrink content to fit the narrower dimension and
  // center it — which reads as dead space above the plot and eye-strain-tiny
  // text. preserveAspectRatio="none" below removes the letterboxing outright.
  const VBW = 330
  const VBH = 176
  const leftPad = 42
  const rightPad = 6
  const topPad = 10
  const bottomPad = 22
  const plotW = VBW - leftPad - rightPad
  const plotH = VBH - topPad - bottomPad
  const GAP = 1.5 // px seam between stacked segments

  // Max must cover both the tallest stack AND the tallest income tick, so an
  // overspent bar rising above its own income line never gets clipped, and a
  // high-income/low-spend month never pushes the scale past what the bars need.
  const maxTotal = Math.max(
    1,
    ...months.map((m) => Math.max(
      m.income_cents,
      m.spent_cents + m.transfers_out_cents + Math.max(m.kept_cents, 0)
    ))
  )
  const ticks = niceTicks(0, maxTotal, 4)
  const scaleMax = Math.max(ticks[ticks.length - 1], maxTotal)

  const yScale = (v) => topPad + plotH - (v / scaleMax) * plotH
  const baselineY = yScale(0)
  const bandW = plotW / Math.max(n, 1)
  const barW = bandW * 0.68

  const last = months[months.length - 1]
  let summary
  if (!last || (last.income_cents === 0 && last.spent_cents === 0 && last.transfers_out_cents === 0)) {
    summary = 'No activity yet this month.'
  } else if (last.income_cents === 0) {
    summary = `Spent ${c(last.spent_cents)} with no income recorded this month.`
  } else if (last.kept_cents < 0) {
    summary = `Overspent by ${c(-last.kept_cents)} against ${c(last.income_cents)} income this month.`
  } else {
    summary = `Kept ${c(last.kept_cents)} of ${c(last.income_cents)} income this month.`
  }

  return (
    <Card className="p-5 mb-3">
      <SectionLabel>Kept vs Spent</SectionLabel>
      <div className="relative">
        <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" height={VBH} preserveAspectRatio="none" className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={leftPad} x2={VBW - rightPad} y1={yScale(t)} y2={yScale(t)} stroke={LINE} strokeWidth={1} />
              <text x={leftPad - 6} y={yScale(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={INK_3} className="tabular">
                {fmtTick(t)}
              </text>
            </g>
          ))}

          {months.map((m, i) => {
            const cx = leftPad + (i + 0.5) * bandW
            const x = cx - barW / 2
            const spentH = (m.spent_cents / scaleMax) * plotH
            const transferH = (m.transfers_out_cents / scaleMax) * plotH
            const keptH = (Math.max(m.kept_cents, 0) / scaleMax) * plotH

            const segs = []
            if (spentH > 0) segs.push({ h: spentH, fill: CRITICAL, opacity: 0.88 })
            if (transferH > 0) segs.push({ h: transferH, fill: ACCENT, opacity: 1 })
            if (keptH > 0) segs.push({ h: keptH, fill: GOOD, opacity: 1 })

            let cursor = baselineY
            const rects = segs.map((seg, si) => {
              const topY = cursor - seg.h
              const isTop = si === segs.length - 1
              const node = isTop ? (
                <path key={si} d={topRoundedRectPath(x, topY, barW, seg.h, 2)} fill={seg.fill} fillOpacity={seg.opacity} />
              ) : (
                <rect key={si} x={x} y={topY} width={barW} height={seg.h} fill={seg.fill} fillOpacity={seg.opacity} />
              )
              cursor = topY - GAP
              return node
            })

            const incomeY = m.income_cents > 0 ? yScale(m.income_cents) : null

            return (
              <g key={`${m.year}-${m.month}`}>
                {incomeY != null && (
                  <line
                    x1={x - 4} x2={x + barW + 4} y1={incomeY} y2={incomeY}
                    stroke="#5c574a" strokeWidth={1} strokeDasharray="3 2"
                  />
                )}
                {rects}
                <text x={cx} y={VBH - 6} textAnchor="middle" fontSize="11" fill={INK_3}>
                  {monthShortLabel(m.year, m.month)}
                </text>
              </g>
            )
          })}
        </svg>

        {/* hover overlay: one column per month, clamped so the tooltip stays inside the card */}
        <div className="absolute top-0 flex" style={{ left: `${(leftPad / VBW) * 100}%`, width: `${(plotW / VBW) * 100}%`, height: VBH }}>
          {months.map((m, i) => (
            <div key={`${m.year}-${m.month}`} className="group relative flex-1 h-full">
              <div
                className={`pointer-events-none absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap rounded-xl bg-ink text-white text-[11px] px-2.5 py-2 shadow-pop ${
                  i === 0 ? 'left-0' : i === n - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                }`}
              >
                <p className="font-semibold mb-1">{monthFullLabel(m.year, m.month)}</p>
                <p>Income: <span className="tabular">{c(m.income_cents)}</span></p>
                <p>Spent: <span className="tabular">{c(m.spent_cents)}</span></p>
                <p>Transfers out: <span className="tabular">{c(m.transfers_out_cents)}</span></p>
                <p>Kept: <span className="tabular">{c(m.kept_cents)}</span></p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 pt-3 border-t border-line">
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className="w-2 h-2 rounded-full" style={{ background: CRITICAL }} />Spent</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className="w-2 h-2 rounded-full" style={{ background: ACCENT }} />Transfers out</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className="w-2 h-2 rounded-full" style={{ background: GOOD }} />Kept</span>
      </div>
      <p className="text-sm text-ink-2 mt-3">{summary}</p>
    </Card>
  )
}

// ── Balance trends — multi-line, step-after (balances change discretely) ──────

function BalanceTrendsChart({ series }) {
  const dates = series.real_cash.map((p) => p.date)
  const n = dates.length

  if (n < 2) {
    return <EmptyState title="Not enough history yet — balance trends will appear as time passes." />
  }

  // See KeptVsSpentChart above for why this viewBox is sized close to the
  // real mobile card width rather than an arbitrary round number.
  const VBW = 330
  const VBH = 184
  const leftPad = 46
  const rightPad = 8
  const topPad = 10
  const bottomPad = 12
  const plotW = VBW - leftPad - rightPad
  const plotH = VBH - topPad - bottomPad

  const allValues = [
    ...series.savings.map((p) => p.balance_cents),
    ...series.mr.map((p) => p.balance_cents),
    ...series.funds_total.map((p) => p.balance_cents),
    ...series.real_cash.map((p) => p.balance_cents),
  ]
  const rawMin = Math.min(0, ...allValues)
  const rawMax = Math.max(0, ...allValues)
  let ticks = niceTicks(rawMin, rawMax, 4)
  if (ticks.length > 4) {
    // Keep at most 4 gridlines — resample evenly across the computed range.
    const step = Math.ceil((ticks.length - 1) / 3)
    ticks = ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1)
  }
  const min = ticks[0]
  const max = ticks[ticks.length - 1]
  const range = max - min || 1

  const xScale = (i) => leftPad + ((i + 0.5) / n) * plotW
  const yScale = (v) => topPad + plotH - ((v - min) / range) * plotH

  function stepPath(points) {
    let d = `M ${points[0].x} ${points[0].y}`
    for (let i = 1; i < points.length; i++) {
      d += ` H ${points[i].x} V ${points[i].y}`
    }
    return d
  }

  const lines = [
    { key: 'savings', label: 'Savings', color: SAVINGS_SWATCH, width: 1.5, data: series.savings },
    { key: 'mr', label: 'Monthly Reserve', color: RESERVE_SWATCH, width: 1.5, data: series.mr },
    { key: 'funds_total', label: 'Funds total', color: FUNDS_TOTAL_COLOR, width: 1.5, data: series.funds_total },
    { key: 'real_cash', label: 'Real Cash', color: INK, width: 2.5, data: series.real_cash },
  ]

  const hasNegative = min < 0
  const bottomY = topPad + plotH

  return (
    <Card className="p-5 mb-3">
      <SectionLabel>Balance Trends</SectionLabel>
      <div className="relative">
        <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" height={VBH} preserveAspectRatio="none" className="block overflow-visible">
          <defs>
            <linearGradient id="overview-real-cash-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INK} stopOpacity="0.12" />
              <stop offset="100%" stopColor={INK} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={leftPad} x2={VBW - rightPad} y1={yScale(t)} y2={yScale(t)} stroke={LINE} strokeWidth={1} />
              <text x={leftPad - 8} y={yScale(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={INK_3} className="tabular">
                {fmtTick(t)}
              </text>
            </g>
          ))}
          {hasNegative && (
            <line
              x1={leftPad} x2={VBW - rightPad} y1={yScale(0)} y2={yScale(0)}
              stroke={INK_3} strokeWidth={1} strokeDasharray="4 3"
            />
          )}
          {lines.map((line) => {
            const pts = line.data.map((p, i) => ({ x: xScale(i), y: yScale(p.balance_cents) }))
            const lastPt = pts[pts.length - 1]
            const isRealCash = line.key === 'real_cash'
            const areaPath = isRealCash
              ? `${stepPath(pts)} L ${pts[pts.length - 1].x.toFixed(1)} ${bottomY} L ${pts[0].x.toFixed(1)} ${bottomY} Z`
              : null
            return (
              <g key={line.key}>
                {areaPath && <path d={areaPath} fill="url(#overview-real-cash-grad)" stroke="none" />}
                <path
                  d={stepPath(pts)}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={line.width}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {isRealCash && <circle cx={lastPt.x} cy={lastPt.y} r={3} fill={line.color} />}
              </g>
            )
          })}
        </svg>

        {/* hover overlay: per-index column, CSS-only crosshair + tooltip */}
        <div className="absolute top-0 flex" style={{ left: `${(leftPad / VBW) * 100}%`, width: `${(plotW / VBW) * 100}%`, height: VBH }}>
          {dates.map((date, i) => (
            <div key={date} className="group relative flex-1 h-full">
              <div className="absolute inset-y-0 left-1/2 w-px bg-ink/15 opacity-0 group-hover:opacity-100 pointer-events-none" />
              <div
                className={`pointer-events-none absolute top-2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap rounded-xl bg-ink text-white text-[11px] px-2.5 py-2 shadow-pop ${
                  i < n / 2 ? 'left-1/2' : 'right-1/2'
                }`}
              >
                <p className="font-semibold mb-1">{new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                {lines.map((line) => (
                  <p key={line.key} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: line.color }} />
                    {line.label}: <span className="tabular">{c(line.data[i].balance_cents)}</span>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 pt-3 border-t border-line">
        {lines.map((line) => (
          <span key={line.key} className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: line.color }} />
            {line.label}
          </span>
        ))}
      </div>
    </Card>
  )
}

// ── Where it went — spending breakdown for the effective current month ────────

// Identity stays as a small colored dot (colorForId); the bar fill itself is one
// calm, neutral tone per section so the list reads as a single system rather than
// a rainbow — the owner's explicit complaint about the old per-entity bar colors.
function SpendRow({ name, amount, dotColor, barColor, maxVal }) {
  const pct = maxVal > 0 ? (amount / maxVal) * 100 : 0
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="flex items-center gap-1.5 text-sm text-ink font-medium truncate min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
          <span className="truncate">{name}</span>
        </span>
        <span className="text-sm text-ink-2 tabular shrink-0">{c(amount)}</span>
      </div>
      <Bar pct={pct} color={barColor} height={7} animate={false} />
    </div>
  )
}

const BILL_BAR_COLOR = CALM // one calm, light tone for all bills — never the heavy near-black
const FUND_BAR_COLOR = ACCENT // one calm tone for all funds
const TRANSFER_BAR_COLOR = INK_3 // lightest of the three — visually "quietest," not spending

function WhereItWentCard({ ym, onPrev, onNext, canNext, breakdown, loading, error, onRetry }) {
  const bills = breakdown?.bills ?? []
  const allFunds = breakdown?.funds ?? []
  const spendFunds = allFunds.filter((f) => f.destination_type !== 'transfer_out')
  const transferFunds = allFunds.filter((f) => f.destination_type === 'transfer_out')

  const maxSpend = Math.max(1, ...bills.map((b) => b.spent_cents), ...spendFunds.map((f) => f.spent_cents))
  const maxTransfer = Math.max(1, ...transferFunds.map((f) => f.spent_cents))

  const empty = !loading && !error && bills.length === 0 && spendFunds.length === 0 && transferFunds.length === 0

  return (
    <Card className="p-5 mb-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Where It Went</p>
        <div className="flex items-center gap-1">
          <IconButton onClick={onPrev} aria-label="Previous month"><ChevronLeft size={16} /></IconButton>
          <span className="text-xs font-semibold text-ink-2 w-28 text-center">{monthFullLabel(ym.year, ym.month)}</span>
          <IconButton onClick={onNext} disabled={!canNext} className={!canNext ? 'opacity-30 pointer-events-none' : ''} aria-label="Next month">
            <ChevronRight size={16} />
          </IconButton>
        </div>
      </div>

      {error && (
        <div className="text-center py-4">
          <p className="text-sm text-critical mb-2">{error}</p>
          <PrimaryButton onClick={onRetry} className="text-xs py-2 px-4">Retry</PrimaryButton>
        </div>
      )}

      {!error && loading && <p className="text-sm text-ink-3 py-4 text-center">Loading…</p>}

      {!error && !loading && empty && (
        <EmptyState title="No spending recorded for this month." />
      )}

      {!error && !loading && !empty && (
        <>
          {bills.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-ink-3 mb-2">Bills</p>
              {bills.map((b) => (
                <SpendRow key={`bill-${b.line_item_id}`} name={b.name} amount={b.spent_cents} dotColor={colorForId(b.line_item_id)} barColor={BILL_BAR_COLOR} maxVal={maxSpend} />
              ))}
            </div>
          )}
          {spendFunds.length > 0 && (
            <div className={transferFunds.length > 0 || bills.length > 0 ? 'mb-4' : ''}>
              <p className="text-xs font-semibold text-ink-3 mb-2">Funds</p>
              {spendFunds.map((f) => (
                <SpendRow key={`fund-${f.fund_id}`} name={f.name ?? 'Deleted fund'} amount={f.spent_cents} dotColor={colorForId(f.fund_id)} barColor={FUND_BAR_COLOR} maxVal={maxSpend} />
              ))}
            </div>
          )}
          {transferFunds.length > 0 && (
            <div className="pt-3 border-t border-line opacity-70">
              <p className="text-xs font-semibold text-ink-3 mb-2">Transfers out — not spending</p>
              {transferFunds.map((f) => (
                <SpendRow key={`transfer-${f.fund_id}`} name={f.name ?? 'Deleted fund'} amount={f.spent_cents} dotColor={colorForId(f.fund_id)} barColor={TRANSFER_BAR_COLOR} maxVal={maxTransfer} />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [range, setRange] = useState(6)
  const [monthly, setMonthly] = useState(null)
  const [series, setSeries] = useState(null)
  const [mainLoading, setMainLoading] = useState(true)
  const [mainError, setMainError] = useState('')

  const [breakdownYM, setBreakdownYM] = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownError, setBreakdownError] = useState('')

  const [refreshKey, setRefreshKey] = useState(0)
  const breakdownInitRef = useRef(false)

  const loadMain = useCallback(async () => {
    setMainLoading(true)
    setMainError('')
    try {
      const [monthlyData, seriesData] = await Promise.all([
        apiGet(`/overview/monthly?months=${range}`),
        apiGet(`/overview/balance-series?months=${range}`),
      ])
      setMonthly(monthlyData.months)
      setSeries(seriesData.series)
      if (!breakdownInitRef.current && monthlyData.months.length > 0) {
        breakdownInitRef.current = true
        const last = monthlyData.months[monthlyData.months.length - 1]
        setBreakdownYM({ year: last.year, month: last.month })
      }
    } catch (err) {
      setMainError(err.message || 'Failed to load')
    } finally {
      setMainLoading(false)
    }
  }, [range])

  useEffect(() => { loadMain() }, [loadMain, refreshKey])

  const loadBreakdown = useCallback(async () => {
    if (!breakdownYM) return
    setBreakdownLoading(true)
    setBreakdownError('')
    try {
      const data = await apiGet(`/overview/spending-breakdown?year=${breakdownYM.year}&month=${breakdownYM.month}`)
      setBreakdown(data)
    } catch (err) {
      setBreakdownError(err.message || 'Failed to load')
    } finally {
      setBreakdownLoading(false)
    }
  }, [breakdownYM])

  useEffect(() => { loadBreakdown() }, [loadBreakdown, refreshKey])

  useEffect(() => {
    function onRefresh() { setRefreshKey((k) => k + 1) }
    window.addEventListener('dev-refresh', onRefresh)
    return () => window.removeEventListener('dev-refresh', onRefresh)
  }, [])

  if (mainError) {
    return (
      <div className="flex items-center justify-center h-64 px-4">
        <Card className="p-6 text-center max-w-sm">
          <p className="text-sm text-critical mb-4">{mainError}</p>
          <PrimaryButton onClick={loadMain}>Retry</PrimaryButton>
        </Card>
      </div>
    )
  }

  if (mainLoading || !monthly || !series) {
    return <div className="flex items-center justify-center h-64 text-ink-3">Loading…</div>
  }

  const hasActivity = monthly.some((m) => m.income_cents !== 0 || m.spent_cents !== 0 || m.transfers_out_cents !== 0)
  const currentYM = monthly.length > 0 ? { year: monthly[monthly.length - 1].year, month: monthly[monthly.length - 1].month } : null
  const canNext = !!(breakdownYM && currentYM && (breakdownYM.year < currentYM.year || (breakdownYM.year === currentYM.year && breakdownYM.month < currentYM.month)))

  return (
    <div className="px-4 pt-6 pb-6">
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-3xl font-bold text-ink tracking-tight">Overview</h1>
        <Segmented
          value={range}
          onChange={setRange}
          options={[{ value: 6, label: '6 mo' }, { value: 12, label: '12 mo' }]}
        />
      </div>

      {!hasActivity && (breakdown?.bills?.length ?? 0) === 0 && (breakdown?.funds?.length ?? 0) === 0 ? (
        <Card className="p-8 flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-1">
            <LayoutDashboard size={20} />
          </div>
          <p className="text-ink font-semibold">Analytics will show up here</p>
          <p className="text-sm text-ink-3 max-w-xs">
            As paychecks land and money moves, trends, monthly comparisons, and spending breakdowns will appear on this page.
          </p>
        </Card>
      ) : (
        <>
          <KeptVsSpentChart months={monthly} />
          <BalanceTrendsChart series={series} />
          {breakdownYM && (
            <WhereItWentCard
              ym={breakdownYM}
              onPrev={() => setBreakdownYM((ym) => shiftYM(ym.year, ym.month, -1))}
              onNext={() => canNext && setBreakdownYM((ym) => shiftYM(ym.year, ym.month, 1))}
              canNext={canNext}
              breakdown={breakdown}
              loading={breakdownLoading}
              error={breakdownError}
              onRetry={loadBreakdown}
            />
          )}
        </>
      )}
    </div>
  )
}
