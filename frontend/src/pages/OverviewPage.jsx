import { useState, useEffect, useCallback, useRef } from 'react'
import { LayoutDashboard, Check, AlertTriangle } from 'lucide-react'
import { apiGet, fmt } from '../api'
import {
  colorForId, BILLS, FUNDS_HUE, SAVING, SAVING_TEXT, SAVING_SOFT, TRANSFER_OUT, CRITICAL,
  INK, INK_2, INK_3, LINE, PAPER, areaGradientId,
} from '../theme'
import { Card, SectionLabel, GroupDivider, EmptyState, Segmented, PrimaryButton, Bar, Badge } from '../components/ui'

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

// "3m" / "1y" — the same short form the range Segmented uses, for delta
// labels and footnotes so a multi-month window never has to spell itself out.
function rangeShortLabel(months) {
  return months === 12 ? '1y' : `${months}m`
}

// "July 2026" for a single month; "Feb – Jul 2026" for a range — year appears
// once unless the window crosses a year boundary.
function rangeHeaderLabel(startY, startM, endY, endM) {
  if (startY === endY && startM === endM) return monthFullLabel(endY, endM)
  const startPart = startY === endY ? monthShortLabel(startY, startM) : `${monthShortLabel(startY, startM)} ${startY}`
  return `${startPart} – ${monthShortLabel(endY, endM)} ${endY}`
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

// Path for a rect with only its top two corners rounded — used for the topmost
// segment of each stack so straight seams stay flat everywhere else.
function topRoundedRectPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h, w / 2))
  if (rr < 0.5) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`
  return `M ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} H ${x} Z`
}

// ── Period review — headline summary of the selected range ────────────────────
// Months with no activity at all (no income, no spending) are excluded from
// the averages and the rate so a long 1y window isn't diluted by history that
// predates the seed/real data.

function Stat({ label, value, dotColor, tone }) {
  const valueClass = tone === 'critical' ? 'text-critical' : tone === 'muted' ? 'text-ink-3 font-normal' : 'text-ink'
  return (
    <div>
      <p className="text-[11px] text-ink-3 mb-0.5 flex items-center gap-1.5">
        {dotColor && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />}
        {label}
      </p>
      <p className={`text-sm font-semibold tabular ${valueClass}`}>{value}</p>
    </div>
  )
}

// Months with no activity at all are excluded so a long 1y window isn't
// diluted by history that predates the seed/real data. Shared by
// PeriodReviewCard and MoneyFlowCard so both cards agree on the same totals.
function aggregateRange(months) {
  const active = months.filter((m) => m.income_cents !== 0 || m.bills_spent_cents !== 0 || m.funds_spent_cents !== 0 || m.transfers_out_cents !== 0)
  const n = active.length
  const totalIncome = active.reduce((s, m) => s + m.income_cents, 0)
  const totalKept = active.reduce((s, m) => s + m.kept_cents, 0)
  const totalBills = active.reduce((s, m) => s + m.bills_spent_cents, 0)
  const totalFunds = active.reduce((s, m) => s + m.funds_spent_cents, 0)
  const totalTransfers = active.reduce((s, m) => s + m.transfers_out_cents, 0)
  const overspentCount = active.filter((m) => m.kept_cents < 0).length
  return { n, totalIncome, totalKept, totalBills, totalFunds, totalTransfers, overspentCount }
}

function PeriodReviewCard({ months, rangeMonths }) {
  const { n, totalIncome, totalKept, totalBills, totalFunds, totalTransfers, overspentCount } = aggregateRange(months)
  const avgSpent = n > 0 ? (totalBills + totalFunds) / n : 0
  const avgKept = n > 0 ? totalKept / n : 0
  const rate = totalIncome > 0 ? (totalKept / totalIncome) * 100 : null
  const singleMonth = rangeMonths === 1

  return (
    <Card className="p-5 mb-3">
      <SectionLabel>Period Review</SectionLabel>
      {n === 0 ? (
        <EmptyState title="No activity in this period yet." />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-base font-semibold text-ink leading-snug">
              You kept <span className="tabular">{c(totalKept)}</span> of <span className="tabular">{c(totalIncome)}</span> income
            </p>
            {rate != null && (
              <span className="text-2xl font-bold tabular shrink-0" style={{ color: rate < 0 ? CRITICAL : SAVING }}>
                {Math.round(rate)}%
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4 pt-4 border-t border-line">
            <Stat label="Spent on bills" value={c(totalBills)} dotColor={BILLS} />
            <Stat label="Spent from funds" value={c(totalFunds)} dotColor={FUNDS_HUE} />
            <Stat label="Transfers out" value={c(totalTransfers)} dotColor={TRANSFER_OUT} />
            {!singleMonth && <Stat label="Avg spent / month" value={c(avgSpent)} />}
            {!singleMonth && <Stat label="Avg kept / month" value={c(avgKept)} />}
            <Stat
              label="Overspent months"
              value={overspentCount > 0 ? String(overspentCount) : '0 — nice'}
              tone={overspentCount > 0 ? 'critical' : 'muted'}
            />
          </div>

          {!singleMonth && (
            <p className="text-xs text-ink-3 mt-3">
              {n} active month{n === 1 ? '' : 's'}{n < rangeMonths ? ` of ${rangeMonths}` : ''}
            </p>
          )}
        </>
      )}
    </Card>
  )
}

// ── Money Flow — Monarch-style cash-flow sankey for the selected range ──────
// Single left source "Income $X" fans into right destination nodes: Bills
// (umber), Funds (blue), Transfers out (stone), Kept (SAVING) — a
// two-column, hand-rolled SVG sankey (no library). Ribbons are flat fills at
// ~85% opacity, no gradients — calm by design. Zero income hides the card
// entirely; a zero-value destination just omits its ribbon/node. When the
// period is overspent (outflows > income), there is no "Kept" node — instead
// the diagram fans Income proportionally into the real destinations (which
// now sum to more than Income), and the resulting shortfall is called out
// as a dashed red bracket + caption rather than invented as a fake node
// (never misrepresent a real node's own dollar amount to make room for it).

// Nodes are sized proportionally to their real dollar amount (honest
// geometry), but that means a small node (e.g. Transfers out next to a much
// bigger Bills) can sit close enough to its neighbor that two-line labels
// would overlap. Labels get their own collision-resolved centers — nudged
// apart to a minimum gap — while the node rects/ribbons keep their true
// proportional positions; only the label anchor moves.
function resolveLabelCenters(naturalCenters, minGap, lo, hi) {
  const centers = [...naturalCenters]
  for (let i = 1; i < centers.length; i++) {
    if (centers[i] - centers[i - 1] < minGap) centers[i] = centers[i - 1] + minGap
  }
  if (centers[centers.length - 1] > hi) {
    centers[centers.length - 1] = hi
    for (let i = centers.length - 2; i >= 0; i--) {
      if (centers[i + 1] - centers[i] < minGap) centers[i] = centers[i + 1] - minGap
    }
  }
  return centers.map((y) => Math.max(lo, y))
}

function MoneyFlowCard({ months }) {
  const agg = aggregateRange(months)
  if (agg.totalIncome <= 0) return null

  const overspent = agg.totalKept < 0

  const rightDefs = [
    { key: 'bills', label: 'Bills', amount: agg.totalBills, color: BILLS },
    { key: 'funds', label: 'Funds', amount: agg.totalFunds, color: FUNDS_HUE },
    { key: 'transfers', label: 'Transfers out', amount: agg.totalTransfers, color: TRANSFER_OUT },
    ...(overspent ? [] : [{ key: 'kept', label: 'Kept', amount: agg.totalKept, color: SAVING }]),
  ].filter((d) => d.amount > 0)

  if (rightDefs.length === 0) return null

  const leftTotal = agg.totalIncome
  const rightTotal = rightDefs.reduce((s, d) => s + d.amount, 0)
  const scaleTotal = Math.max(leftTotal, rightTotal)
  const gapCents = overspent ? Math.max(0, rightTotal - leftTotal) : 0

  const NODE_W = 8
  const VBW = 190
  const LABEL_MIN_GAP = 32 // px between adjacent right-label centers, enough for two lines of 11px text
  const topPad = 8
  const bottomPad = 8
  const VBH = Math.max(120, (rightDefs.length - 1) * LABEL_MIN_GAP + topPad + bottomPad + 24)
  const plotH = VBH - topPad - bottomPad
  const scale = plotH / scaleTotal

  const leftH = leftTotal * scale
  const leftY0 = topPad + (plotH - leftH) / 2
  const leftX0 = 0
  const rightX0 = VBW - NODE_W

  let cursor = topPad
  const rightNodes = rightDefs.map((d) => {
    const h = Math.max(d.amount * scale, 1)
    const node = { ...d, y0: cursor, h }
    cursor += h
    return node
  })
  const labelCenters = resolveLabelCenters(
    rightNodes.map((n) => n.y0 + n.h / 2),
    LABEL_MIN_GAP, topPad + 12, VBH - bottomPad - 12
  )

  // Proportional fan from the single Income source: each ribbon's source
  // slice is that node's cumulative-fraction-of-rightTotal remapped onto
  // Income's own (possibly shorter, when overspent) height. When the period
  // isn't overspent, rightTotal === leftTotal and this is an exact 1:1,
  // edge-to-edge match — no compression. Cumulative fraction MUST be tracked
  // in dollar amount (node.amount), not pixel height (node.h) — mixing the
  // two units made every ribbon's source slice collapse to ~0, so all
  // ribbons appeared to droop from the very top of the Income node instead
  // of fanning out from their own proportional slice.
  let cum = 0
  const ribbons = rightNodes.map((node) => {
    const f0 = cum / rightTotal
    const f1 = (cum + node.amount) / rightTotal
    cum += node.amount
    const midX = (leftX0 + NODE_W + rightX0) / 2
    const y0a = leftY0 + f0 * leftH
    const y1a = leftY0 + f1 * leftH
    const y0b = node.y0
    const y1b = node.y0 + node.h
    const x0 = leftX0 + NODE_W
    const x1 = rightX0
    const d = `M ${x0} ${y0a.toFixed(1)} C ${midX} ${y0a.toFixed(1)} ${midX} ${y0b.toFixed(1)} ${x1} ${y0b.toFixed(1)} `
      + `L ${x1} ${y1b.toFixed(1)} C ${midX} ${y1b.toFixed(1)} ${midX} ${y1a.toFixed(1)} ${x0} ${y1a.toFixed(1)} Z`
    return { key: node.key, color: node.color, path: d }
  })

  // Fixed pixel budget for all three columns — deliberately NOT flex-1 on
  // the svg. Absolutely-positioned label children ignore a flex parent's
  // computed width, so a flexible middle column makes the outer columns'
  // real available width unpredictable (labels overflowed past the card
  // edge with flex-1 here). Every column width below is explicit, so the
  // total is provably within the card's ~318px content box at 390px.
  const LEFT_COL = 76
  const SVG_COL = 108
  const RIGHT_COL = 112
  const COL_GAP = 6

  return (
    <Card className="p-5 mb-3">
      <SectionLabel>Money Flow</SectionLabel>
      <div className="flex items-stretch" style={{ gap: COL_GAP }}>
        <div className="relative shrink-0" style={{ width: LEFT_COL, height: VBH }}>
          {/* Absolute children ignore the flex parent's width, so each label
              gets its own explicit width — otherwise long amounts/names can
              silently overflow past the card edge instead of wrapping. */}
          <div className="absolute right-0 text-right -translate-y-1/2" style={{ top: `${((leftY0 + leftH / 2) / VBH) * 100}%`, width: LEFT_COL }}>
            <p className="text-xs font-semibold text-ink leading-tight">Income</p>
            <p className="text-xs text-ink-2 tabular leading-tight">{c(leftTotal)}</p>
          </div>
        </div>
        <svg width={SVG_COL} height={VBH} viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="none" className="shrink-0 block overflow-visible">
          <rect x={leftX0} y={leftY0} width={NODE_W} height={Math.max(leftH, 1)} rx={2} fill={INK_2} />
          {ribbons.map((r) => <path key={r.key} d={r.path} fill={r.color} opacity={0.85} />)}
          {rightNodes.map((node) => (
            <rect key={node.key} x={rightX0} y={node.y0} width={NODE_W} height={node.h} rx={2} fill={node.color} />
          ))}
          {gapCents > 0 && (
            <rect
              x={rightX0 - 2.5} y={topPad + plotH - gapCents * scale} width={NODE_W + 5} height={gapCents * scale}
              rx={2} fill="none" stroke={CRITICAL} strokeWidth={1.5} strokeDasharray="2 2"
            />
          )}
        </svg>
        <div className="relative shrink-0" style={{ width: RIGHT_COL, height: VBH }}>
          {rightNodes.map((node, i) => (
            <div key={node.key} className="absolute left-1 -translate-y-1/2" style={{ top: `${(labelCenters[i] / VBH) * 100}%`, width: RIGHT_COL - 4 }}>
              <p className="text-xs font-semibold text-ink leading-tight flex items-start gap-1">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5" style={{ background: node.color }} />
                <span>{node.label}</span>
              </p>
              <p className="text-xs text-ink-2 tabular leading-tight pl-2.5">{c(node.amount)}</p>
            </div>
          ))}
        </div>
      </div>
      {gapCents > 0 && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 border-2" style={{ borderColor: CRITICAL }} />
          <p className="text-xs font-semibold text-critical">Overspent +{c(gapCents)} — beyond what income covered this period</p>
        </div>
      )}
    </Card>
  )
}

// ── Kept vs Spent — stacked bar (bills + funds + transfers + kept) ───────────
// Form: one stacked bar per month, bottom→top: Bills (BILLS umber), Funds
// (FUNDS_HUE blue), Transfers out (TRANSFER_OUT stone), Kept (SAVING
// green). A dashed income tick marks where income landed, so an overspent
// month (kept clamped to 0) visibly rises above its own income line — the
// honest way to show a leak without a second axis. A single-month window (1m)
// still renders one centered, sensibly-capped bar rather than stretching to
// fill the whole plot width.

function KeptVsSpentChart({ months }) {
  const n = months.length
  const VBW = 330
  const VBH = 176
  const leftPad = 42
  const rightPad = 6
  const topPad = 20 // extra headroom above the tallest bar / income tick
  const bottomPad = 22
  const plotW = VBW - leftPad - rightPad
  const plotH = VBH - topPad - bottomPad
  const GAP = 1.5 // px seam between stacked segments

  const maxTotal = Math.max(
    1,
    ...months.map((m) => Math.max(
      m.income_cents,
      m.bills_spent_cents + m.funds_spent_cents + m.transfers_out_cents + Math.max(m.kept_cents, 0)
    ))
  )
  const ticks = niceTicks(0, maxTotal, 4)
  const scaleMax = Math.max(ticks[ticks.length - 1], maxTotal)

  const yScale = (v) => topPad + plotH - (v / scaleMax) * plotH
  const baselineY = yScale(0)
  const bandW = plotW / Math.max(n, 1)
  const barW = Math.min(bandW * 0.56, 56) // capped so a 1-bar window stays a bar, not a slab — more air between bars

  const last = months[months.length - 1]
  let summary
  if (!last || (last.income_cents === 0 && last.bills_spent_cents === 0 && last.funds_spent_cents === 0 && last.transfers_out_cents === 0)) {
    summary = 'No activity yet this month.'
  } else if (last.income_cents === 0) {
    summary = `Spent ${c(last.bills_spent_cents + last.funds_spent_cents)} with no income recorded this month.`
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
            const billsH = (m.bills_spent_cents / scaleMax) * plotH
            const fundsH = (m.funds_spent_cents / scaleMax) * plotH
            const transferH = (m.transfers_out_cents / scaleMax) * plotH
            const keptH = (Math.max(m.kept_cents, 0) / scaleMax) * plotH

            const segs = []
            if (billsH > 0) segs.push({ h: billsH, fill: BILLS })
            if (fundsH > 0) segs.push({ h: fundsH, fill: FUNDS_HUE })
            if (transferH > 0) segs.push({ h: transferH, fill: TRANSFER_OUT })
            if (keptH > 0) segs.push({ h: keptH, fill: SAVING })

            let cursor = baselineY
            const rects = segs.map((seg, si) => {
              const topY = cursor - seg.h
              const isTop = si === segs.length - 1
              const node = isTop ? (
                <path key={si} d={topRoundedRectPath(x, topY, barW, seg.h, 2)} fill={seg.fill} />
              ) : (
                <rect key={si} x={x} y={topY} width={barW} height={seg.h} fill={seg.fill} />
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
                  n === 1 ? 'left-1/2 -translate-x-1/2' : i === 0 ? 'left-0' : i === n - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                }`}
              >
                <p className="font-semibold mb-1">{monthFullLabel(m.year, m.month)}</p>
                <p>Income: <span className="tabular">{c(m.income_cents)}</span></p>
                <p>Bills: <span className="tabular">{c(m.bills_spent_cents)}</span></p>
                <p>Funds: <span className="tabular">{c(m.funds_spent_cents)}</span></p>
                <p>Transfers out: <span className="tabular">{c(m.transfers_out_cents)}</span></p>
                <p>Kept: <span className="tabular">{c(m.kept_cents)}</span></p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 pt-3 border-t border-line">
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className="w-2 h-2 rounded-full" style={{ background: BILLS }} />Bills</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className="w-2 h-2 rounded-full" style={{ background: FUNDS_HUE }} />Funds</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className="w-2 h-2 rounded-full" style={{ background: TRANSFER_OUT }} />Transfers out</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className="w-2 h-2 rounded-full" style={{ background: SAVING }} />Kept</span>
      </div>
      <p className="text-sm text-ink-2 mt-3">{summary}</p>
    </Card>
  )
}

// ── Spending Pace — current month only, Copilot-style ─────────────────────────
// Dotted straight line = pace from $0 to the month's planned spending total.
// Solid stepped line = cumulative actual spending by day (transfer-out
// exclusions already applied by the caller). A dot marks today; a plain-
// language verdict sits underneath. Always pinned to the effective current
// month regardless of the page's range selector — the small month tag in the
// header makes that scope explicit.

function SpendingPaceChart({ year, month, day, plannedTotal, txns, tag }) {
  const lastDay = new Date(year, month, 0).getDate()
  const today = Math.min(Math.max(day, 1), lastDay)

  const dailyTotals = {}
  for (const tx of txns) {
    dailyTotals[tx.date] = (dailyTotals[tx.date] ?? 0) + tx.amount_cents
  }
  const cumByDay = [0]
  let running = 0
  for (let d = 1; d <= today; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    running += dailyTotals[dateStr] ?? 0
    cumByDay.push(running)
  }
  const actualToday = running
  const paceToday = Math.round((plannedTotal * today) / lastDay)
  const diff = actualToday - paceToday
  const overPace = diff > 0

  const VBW = 330
  const VBH = 190
  const leftPad = 46
  const rightPad = 8
  const topPad = 12
  const bottomPad = 22
  const plotW = VBW - leftPad - rightPad
  const plotH = VBH - topPad - bottomPad

  const maxVal = Math.max(1, plannedTotal, actualToday)
  const ticks = niceTicks(0, maxVal, 4)
  const scaleMax = Math.max(ticks[ticks.length - 1], maxVal)

  const xScale = (d) => leftPad + (d / lastDay) * plotW
  const yScale = (v) => topPad + plotH - (v / scaleMax) * plotH
  const baselineY = yScale(0)

  const paceLine = `M ${xScale(0).toFixed(1)} ${yScale(0).toFixed(1)} L ${xScale(lastDay).toFixed(1)} ${yScale(plannedTotal).toFixed(1)}`

  let actualPath = `M ${xScale(0).toFixed(1)} ${yScale(cumByDay[0]).toFixed(1)}`
  for (let d = 1; d <= today; d++) {
    actualPath += ` L ${xScale(d).toFixed(1)} ${yScale(cumByDay[d - 1]).toFixed(1)} L ${xScale(d).toFixed(1)} ${yScale(cumByDay[d]).toFixed(1)}`
  }
  const areaPath = `${actualPath} L ${xScale(today).toFixed(1)} ${baselineY.toFixed(1)} L ${xScale(0).toFixed(1)} ${baselineY.toFixed(1)} Z`

  const gradId = areaGradientId('pace')
  const todayX = xScale(today)
  const todayY = yScale(actualToday)

  // Hover: nearest day by pointer x.
  const containerRef = useRef(null)
  const [hoverDay, setHoverDay] = useState(null)
  function handleMove(clientX) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const relX = ((clientX - rect.left) / rect.width) * VBW
    const d = Math.round(((relX - leftPad) / plotW) * lastDay)
    setHoverDay(Math.min(Math.max(d, 0), today))
  }
  const hoverX = hoverDay != null ? xScale(hoverDay) : null
  const hoverActual = hoverDay != null ? cumByDay[hoverDay] : null
  const hoverPace = hoverDay != null ? Math.round((plannedTotal * hoverDay) / lastDay) : null

  return (
    <Card className="p-5 mb-3">
      <SectionLabel action={tag && <Badge tone="neutral">{tag}</Badge>}>Spending Pace</SectionLabel>
      <div
        ref={containerRef}
        className="relative select-none"
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseLeave={() => setHoverDay(null)}
        onTouchStart={(e) => handleMove(e.touches[0].clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onTouchEnd={() => setHoverDay(null)}
      >
        <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" height={VBH} preserveAspectRatio="none" className="block overflow-visible">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INK} stopOpacity="0.12" />
              <stop offset="100%" stopColor={INK} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={leftPad} x2={VBW - rightPad} y1={yScale(t)} y2={yScale(t)} stroke={LINE} strokeWidth={1} />
              <text x={leftPad - 6} y={yScale(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={INK_3} className="tabular">
                {fmtTick(t)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
          <path d={paceLine} fill="none" stroke={INK_3} strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" />
          <path d={actualPath} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={todayX} cy={todayY} r={4} fill={INK} stroke="#ffffff" strokeWidth={2} />

          {hoverDay != null && (
            <>
              <line x1={hoverX} x2={hoverX} y1={topPad} y2={topPad + plotH} stroke={LINE} strokeWidth={1} strokeDasharray="2 2" />
              <circle cx={hoverX} cy={yScale(hoverActual)} r={3.5} fill={INK} stroke="#ffffff" strokeWidth={1.5} />
            </>
          )}

          <text x={leftPad} y={VBH - 6} textAnchor="start" fontSize="11" fill={INK_3}>1</text>
          <text x={VBW - rightPad} y={VBH - 6} textAnchor="end" fontSize="11" fill={INK_3}>{lastDay}</text>
        </svg>

        {hoverDay != null && (
          <div
            className="pointer-events-none absolute top-1 opacity-100 z-10 whitespace-nowrap rounded-xl bg-ink text-white text-[11px] px-2.5 py-2 shadow-pop"
            style={{ left: `${Math.min(Math.max((hoverX / VBW) * 100, 8), 78)}%` }}
          >
            <p className="font-semibold mb-1">Day {hoverDay}</p>
            <p>Actual: <span className="tabular">{c(hoverActual)}</span></p>
            <p>Pace: <span className="tabular">{c(hoverPace)}</span></p>
          </div>
        )}
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 pt-3 border-t border-line">
        <span className="flex items-center gap-1.5 text-xs text-ink-2">
          <span className="w-3 h-0 border-t-2 border-dashed" style={{ borderColor: INK_3 }} />Pace
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2">
          <span className="w-3 h-0.5 rounded-full" style={{ background: INK }} />Actual spending
        </span>
      </div>

      <p className="text-sm text-ink-2 mt-3">
        Day {today} — <span className="font-semibold text-ink tabular">{c(actualToday)}</span> spent ·{' '}
        <span className={overPace ? 'text-critical font-semibold' : 'text-ink-2'}>
          {c(Math.abs(diff))} {overPace ? 'over pace' : 'under pace'}
        </span>
      </p>
    </Card>
  )
}

// ── Savings rate — compact. Multi-month: one small bar per month. 1m: a big
// stat instead of a one-bar chart, since a single bar has nothing to compare
// itself against. ───────────────────────────────────────────────────────────

function SavingsRateSingleMonth({ month }) {
  const hasIncome = month.income_cents > 0
  const pct = hasIncome ? (month.kept_cents / month.income_cents) * 100 : null
  return (
    <Card className="p-5 mb-3">
      <SectionLabel>Savings Rate</SectionLabel>
      {pct != null ? (
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold tabular" style={{ color: pct < 0 ? CRITICAL : SAVING }}>
            {Math.round(pct)}%
          </span>
          <p className="text-sm text-ink-2">
            Kept <span className="font-semibold text-ink tabular">{c(month.kept_cents)}</span> of{' '}
            <span className="tabular">{c(month.income_cents)}</span> income this month.
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-3">No income recorded this month.</p>
      )}
    </Card>
  )
}

function SavingsRateCard({ months }) {
  if (months.length === 1) {
    return <SavingsRateSingleMonth month={months[0]} />
  }

  const last6 = months.slice(-6)
  const withIncome = last6.filter((m) => m.income_cents > 0)
  const avgPct = withIncome.length
    ? withIncome.reduce((s, m) => s + (m.kept_cents / m.income_cents) * 100, 0) / withIncome.length
    : null

  const VBW = 330
  const VBH = 128
  const leftPad = 8
  const rightPad = 8
  const topPad = 24
  const bottomPad = 20
  const plotW = VBW - leftPad - rightPad
  const plotH = VBH - topPad - bottomPad
  const n = last6.length
  const bandW = plotW / Math.max(n, 1)
  const barW = Math.min(30, bandW * 0.5)
  const baselineY = topPad + plotH

  return (
    <Card className="p-5 mb-3">
      <SectionLabel>Savings Rate</SectionLabel>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" height={VBH} preserveAspectRatio="none" className="block overflow-visible">
        {avgPct != null && (
          <line
            x1={leftPad} x2={VBW - rightPad}
            y1={topPad + plotH - (Math.min(Math.max(avgPct, 0), 100) / 100) * plotH}
            y2={topPad + plotH - (Math.min(Math.max(avgPct, 0), 100) / 100) * plotH}
            stroke={INK_3} strokeWidth={1} strokeDasharray="3 2"
          />
        )}
        {last6.map((m, i) => {
          const cx = leftPad + (i + 0.5) * bandW
          const hasIncome = m.income_cents > 0
          const pct = hasIncome ? (m.kept_cents / m.income_cents) * 100 : null
          const barColor = pct != null && pct < 0 ? CRITICAL : SAVING
          const barH = pct != null ? (Math.min(Math.max(pct, 0), 100) / 100) * plotH : 0
          return (
            <g key={`${m.year}-${m.month}`}>
              {pct != null ? (
                <path d={topRoundedRectPath(cx - barW / 2, baselineY - barH, barW, Math.max(barH, 2), 3)} fill={barColor} />
              ) : (
                <text x={cx} y={baselineY - 4} textAnchor="middle" fontSize="14" fill={INK_3}>—</text>
              )}
              {pct != null && (
                // Paper-colored halo (paint-order stroke) so the label always
                // wins over the dashed average line crossing behind it,
                // instead of the two visually merging.
                <text
                  x={cx} y={Math.max(baselineY - barH - 6, topPad - 4)}
                  textAnchor="middle" fontSize="10" fontWeight="600" fill={INK_2} className="tabular"
                  stroke={PAPER} strokeWidth="3" paintOrder="stroke" strokeLinejoin="round"
                >
                  {Math.round(pct)}%
                </text>
              )}
              <text x={cx} y={VBH - 4} textAnchor="middle" fontSize="11" fill={INK_3}>
                {monthShortLabel(m.year, m.month)}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="text-sm text-ink-2 mt-1">
        {avgPct != null
          ? <>You keep ~<span className="font-semibold text-ink tabular">{Math.round(avgPct)}%</span> of income on average.</>
          : 'Not enough income history yet.'}
      </p>
    </Card>
  )
}

// ── Bills Coverage — stat strip, the cash-flow-smoothing heart of the app.
// Renamed from "Reserve Check" (owner: "idk what the reserve check is") —
// the copy now says outright what the Monthly Reserve is FOR. Always pinned
// to the effective current month regardless of range. ─────────────────────

function ReserveCheckCard({ mrBalanceCents, remainingBillsCents, tag }) {
  if (remainingBillsCents <= 0) return null

  const covered = mrBalanceCents >= remainingBillsCents
  const shortfall = covered ? 0 : remainingBillsCents - mrBalanceCents
  const Icon = covered ? Check : AlertTriangle

  let segments
  if (covered) {
    const reservedPct = mrBalanceCents > 0 ? (remainingBillsCents / mrBalanceCents) * 100 : 100
    segments = [
      { pct: reservedPct, color: BILLS },
      { pct: Math.max(0, 100 - reservedPct), color: SAVING },
    ]
  } else {
    const coveredPct = (mrBalanceCents / remainingBillsCents) * 100
    segments = [
      { pct: Math.max(0, coveredPct), color: BILLS },
      { pct: Math.max(0, 100 - coveredPct), color: CRITICAL },
    ]
  }

  return (
    <Card className="p-5 mb-3">
      <SectionLabel action={tag && <Badge tone="neutral">{tag}</Badge>}>Bills Coverage</SectionLabel>
      <div className="flex items-start gap-3">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: covered ? SAVING_SOFT : '#f8e7e4', color: covered ? SAVING_TEXT : CRITICAL }}
        >
          <Icon size={14} />
        </div>
        <p className="text-sm text-ink-2 flex-1">
          Set aside for bills: <span className="font-semibold text-ink tabular">{c(mrBalanceCents)}</span> · Bills left to pay: <span className="font-semibold text-ink tabular">{c(remainingBillsCents)}</span> —{' '}
          {covered
            ? <span className="font-semibold" style={{ color: SAVING_TEXT }}>covered ✓</span>
            : <span className="font-semibold text-critical">short by {c(shortfall)}</span>}
        </p>
      </div>
      <div className="h-2 rounded-full bg-paper overflow-hidden flex gap-[2px] mt-3">
        {segments.map((seg, i) => seg.pct > 0.5 && (
          <div key={i} className="h-full" style={{ width: `${seg.pct}%`, background: seg.color }} />
        ))}
      </div>
      <p className="text-[11px] text-ink-3 mt-2.5">
        Your Monthly Reserve holds this month's bill money so paychecks never get raided mid-month.
      </p>
    </Card>
  )
}

// ── Where it went — spending breakdown, aggregated over the selected range ────
// Identity stays as a small colored dot (colorForId); the bar fill itself
// switches to the semantic bucket color (Bills umber, Funds blue,
// Transfers stone) so the list reads as one system, not a rainbow. The range
// selector replaces per-month navigation — this card always shows the
// selected window ending at the effective current month, with a delta against
// the same-length window immediately before it.

// Bar fill uses the row's own identity color by default (matching its dot) —
// like the donut, so the list reads as its own entities, not a rainbow of
// blue bills. Transfers-out rows pass an explicit TRANSFER_OUT barColor
// override (semantic — "not spending," never an entity identity).
function SpendRow({ name, amount, dotColor, barColor, maxVal, delta, deltaLabel }) {
  const pct = maxVal > 0 ? (amount / maxVal) * 100 : 0
  const showDelta = delta != null && delta !== 0
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="flex items-center gap-1.5 text-sm text-ink font-medium truncate min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
          <span className="truncate">{name}</span>
        </span>
        <span className="flex items-baseline gap-1.5 shrink-0">
          <span className="text-sm text-ink-2 tabular">{c(amount)}</span>
          {showDelta && (
            <span className={`text-[11px] tabular ${delta > 0 ? 'text-critical' : 'text-ink-3'}`}>
              {delta > 0 ? '+' : '−'}{c(Math.abs(delta))} vs {deltaLabel}
            </span>
          )}
        </span>
      </div>
      <Bar pct={pct} color={barColor ?? dotColor} height={7} animate={false} />
    </div>
  )
}

// Straight-butt-cap donut with gaps (the same treatment as the Expenses
// category donut) — top 6 spending entities across the range + "Other",
// identity colors matching the dots in the list below. Center shows total
// spent (bills + funds, transfers-out excluded — not spending).
function RangeDonut({ bills, spendFunds }) {
  const entities = [
    ...bills.map((b) => ({ colorId: b.line_item_id, name: b.name, amount: b.spent_cents })),
    ...spendFunds.map((f) => ({ colorId: f.fund_id, name: f.name ?? 'Deleted fund', amount: f.spent_cents })),
  ].filter((e) => e.amount > 0).sort((a, b) => b.amount - a.amount)

  if (entities.length === 0) return null

  const top = entities.slice(0, 6)
  const otherAmount = entities.slice(6).reduce((s, e) => s + e.amount, 0)
  const segments = top.map((e) => ({ label: e.name, amount: e.amount, color: colorForId(e.colorId) }))
  if (otherAmount > 0) segments.push({ label: 'Other', amount: otherAmount, color: INK_3 })
  const total = segments.reduce((s, seg) => s + seg.amount, 0)

  const SIZE = 132
  const cx = SIZE / 2, cy = SIZE / 2
  const R = 50, SW = 16
  const circ = 2 * Math.PI * R
  const GAP = 3
  let cumFrac = 0

  return (
    <div className="flex justify-center mb-4 pb-4 border-b border-line">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={cx} cy={cy} r={R} fill="none" stroke={LINE} strokeWidth={SW} />
          {segments.map((seg, i) => {
            const frac = seg.amount / total
            const dash = Math.max(0, frac * circ - GAP)
            const rot = -90 + cumFrac * 360
            cumFrac += frac
            return (
              <circle key={i} cx={cx} cy={cy} r={R} fill="none"
                stroke={seg.color} strokeWidth={SW} strokeLinecap="butt"
                strokeDasharray={`${dash} ${circ}`}
                transform={`rotate(${rot} ${cx} ${cy})`} />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-ink tabular">{c(total)}</span>
          <span className="text-[10px] text-ink-3">spent</span>
        </div>
      </div>
    </div>
  )
}

function WhereItWentCard({ rangeMonths, endYM, breakdown, prevBreakdown, loading, error, onRetry }) {
  const bills = breakdown?.bills ?? []
  const allFunds = breakdown?.funds ?? []
  const spendFunds = allFunds.filter((f) => f.destination_type !== 'transfer_out')
  const transferFunds = allFunds.filter((f) => f.destination_type === 'transfer_out')

  const maxSpend = Math.max(1, ...bills.map((b) => b.spent_cents), ...spendFunds.map((f) => f.spent_cents))
  const maxTransfer = Math.max(1, ...transferFunds.map((f) => f.spent_cents))

  const startYM = shiftYM(endYM.year, endYM.month, -(rangeMonths - 1))
  const headerLabel = rangeHeaderLabel(startYM.year, startYM.month, endYM.year, endYM.month)
  const deltaLabel = rangeMonths === 1
    ? monthShortLabel(shiftYM(endYM.year, endYM.month, -1).year, shiftYM(endYM.year, endYM.month, -1).month)
    : `prior ${rangeShortLabel(rangeMonths)}`
  const prevBillByName = Object.fromEntries((prevBreakdown?.bills ?? []).map((b) => [b.name, b.spent_cents]))
  const prevFundById = Object.fromEntries((prevBreakdown?.funds ?? []).map((f) => [f.fund_id, f.spent_cents]))

  const empty = !loading && !error && bills.length === 0 && spendFunds.length === 0 && transferFunds.length === 0

  return (
    <Card className="p-5 mb-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Where It Went</p>
        <span className="text-xs font-semibold text-ink-2">{headerLabel}</span>
      </div>

      {error && (
        <div className="text-center py-4">
          <p className="text-sm text-critical mb-2">{error}</p>
          <PrimaryButton onClick={onRetry} className="text-xs py-2 px-4">Retry</PrimaryButton>
        </div>
      )}

      {!error && loading && <p className="text-sm text-ink-3 py-4 text-center">Loading…</p>}

      {!error && !loading && empty && (
        <EmptyState title="No spending recorded for this period." />
      )}

      {!error && !loading && !empty && (
        <>
          <RangeDonut bills={bills} spendFunds={spendFunds} />
          {bills.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-ink-3 mb-2">Bills</p>
              {bills.map((b) => {
                const prev = prevBillByName[b.name]
                const delta = prev != null ? b.spent_cents - prev : null
                return (
                  <SpendRow key={`bill-${b.line_item_id}`} name={b.name} amount={b.spent_cents}
                    dotColor={colorForId(b.line_item_id)} maxVal={maxSpend}
                    delta={delta} deltaLabel={deltaLabel} />
                )
              })}
            </div>
          )}
          {spendFunds.length > 0 && (
            <div className={transferFunds.length > 0 || bills.length > 0 ? 'mb-4' : ''}>
              <p className="text-xs font-semibold text-ink-3 mb-2">Funds</p>
              {spendFunds.map((f) => {
                const prev = prevFundById[f.fund_id]
                const delta = prev != null ? f.spent_cents - prev : null
                return (
                  <SpendRow key={`fund-${f.fund_id}`} name={f.name ?? 'Deleted fund'} amount={f.spent_cents}
                    dotColor={colorForId(f.fund_id)} maxVal={maxSpend}
                    delta={delta} deltaLabel={deltaLabel} />
                )
              })}
            </div>
          )}
          {transferFunds.length > 0 && (
            <div className="pt-3 border-t border-line opacity-70">
              <p className="text-xs font-semibold text-ink-3 mb-2">Transfers out — not spending</p>
              {transferFunds.map((f) => (
                <SpendRow key={`transfer-${f.fund_id}`} name={f.name ?? 'Deleted fund'} amount={f.spent_cents} dotColor={colorForId(f.fund_id)} barColor={TRANSFER_OUT} maxVal={maxTransfer} />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { value: 1, label: '1m' },
  { value: 3, label: '3m' },
  { value: 6, label: '6m' },
  { value: 12, label: '1y' },
]

export default function OverviewPage() {
  const [range, setRange] = useState(6)
  const [monthly, setMonthly] = useState(null)
  const [mainLoading, setMainLoading] = useState(true)
  const [mainError, setMainError] = useState('')

  const [breakdown, setBreakdown] = useState(null)
  const [prevBreakdown, setPrevBreakdown] = useState(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownError, setBreakdownError] = useState('')

  // Current-month data for Spending Pace + Reserve Check + the "Where it
  // went" window's end month — pinned to the effective current month
  // regardless of the range selector.
  const [current, setCurrent] = useState(null)
  const [currentLoading, setCurrentLoading] = useState(true)
  const [currentError, setCurrentError] = useState('')

  const [refreshKey, setRefreshKey] = useState(0)

  const loadMain = useCallback(async () => {
    setMainLoading(true)
    setMainError('')
    try {
      const monthlyData = await apiGet(`/overview/monthly?months=${range}`)
      setMonthly(monthlyData.months)
    } catch (err) {
      setMainError(err.message || 'Failed to load')
    } finally {
      setMainLoading(false)
    }
  }, [range])

  useEffect(() => { loadMain() }, [loadMain, refreshKey])

  const loadCurrent = useCallback(async () => {
    setCurrentLoading(true)
    setCurrentError('')
    try {
      const clock = await apiGet('/dev/current-date')
      const [y, m, d] = clock.effective_date.split('-').map(Number)
      const [summary, state, txns, funds, curBreakdown] = await Promise.all([
        apiGet(`/monthly-summary?year=${y}&month=${m}`),
        apiGet('/state'),
        apiGet(`/transactions/?year=${y}&month=${m}`),
        apiGet('/funds/'),
        apiGet(`/overview/spending-breakdown?year=${y}&month=${m}`),
      ])
      const transferFundNames = new Set(funds.filter((f) => f.destination_type === 'transfer_out').map((f) => f.name))
      const paceTxns = txns.filter((tx) => !(tx.fund_name && transferFundNames.has(tx.fund_name)))
      const actualBillsSpent = (curBreakdown.bills ?? []).reduce((s, b) => s + b.spent_cents, 0)
      setCurrent({
        year: y, month: m, day: d,
        plannedTotal: summary.expected_bills_total_cents + summary.expected_fund_contributions_total_cents,
        paceTxns,
        mrBalanceCents: state.monthly_reserve.balance_cents,
        remainingBillsCents: summary.expected_bills_total_cents - actualBillsSpent,
      })
    } catch (err) {
      setCurrentError(err.message || 'Failed to load')
    } finally {
      setCurrentLoading(false)
    }
  }, [])

  useEffect(() => { loadCurrent() }, [loadCurrent, refreshKey])

  // "Where it went" always ends at the effective current month (from
  // `current`) and aggregates the selected range; it waits for `current` to
  // resolve so it never has to fetch the effective date a second time.
  const loadBreakdown = useCallback(async () => {
    if (!current) return
    setBreakdownLoading(true)
    setBreakdownError('')
    try {
      const { year, month } = current
      const startYM = shiftYM(year, month, -(range - 1))
      const prevEnd = shiftYM(startYM.year, startYM.month, -1)
      const [data, prevData] = await Promise.all([
        apiGet(`/overview/spending-breakdown?year=${year}&month=${month}&months=${range}`),
        apiGet(`/overview/spending-breakdown?year=${prevEnd.year}&month=${prevEnd.month}&months=${range}`),
      ])
      setBreakdown(data)
      setPrevBreakdown(prevData)
    } catch (err) {
      setBreakdownError(err.message || 'Failed to load')
    } finally {
      setBreakdownLoading(false)
    }
  }, [current, range])

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

  if (mainLoading || !monthly) {
    return <div className="flex items-center justify-center h-64 text-ink-3">Loading…</div>
  }

  const hasActivity = monthly.some((m) => m.income_cents !== 0 || m.bills_spent_cents !== 0 || m.funds_spent_cents !== 0 || m.transfers_out_cents !== 0)
  const currentTag = current ? monthShortLabel(current.year, current.month) : null

  return (
    <div className="px-4 pt-6 pb-6">
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-3xl font-bold text-ink tracking-tight">Overview</h1>
        <Segmented value={range} onChange={setRange} options={RANGE_OPTIONS} />
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
          <PeriodReviewCard months={monthly} rangeMonths={range} />

          {/* THIS MONTH — always the effective current month, regardless of
              the range selector above (each card carries its own Jul tag). */}
          <GroupDivider>This Month</GroupDivider>

          {!currentLoading && !currentError && current && current.plannedTotal > 0 && (
            <SpendingPaceChart
              year={current.year} month={current.month} day={current.day}
              plannedTotal={current.plannedTotal} txns={current.paceTxns} tag={currentTag}
            />
          )}

          {!currentLoading && !currentError && current && (
            <ReserveCheckCard mrBalanceCents={current.mrBalanceCents} remainingBillsCents={current.remainingBillsCents} tag={currentTag} />
          )}

          {currentError && (
            <Card className="p-4 mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-critical">{currentError}</p>
              <button onClick={loadCurrent} className="text-xs font-semibold text-accent shrink-0">Retry</button>
            </Card>
          )}

          {/* OVER THIS PERIOD — the selected range from the top selector. */}
          <GroupDivider>Over This Period</GroupDivider>

          <MoneyFlowCard months={monthly} />

          <KeptVsSpentChart months={monthly} />

          <SavingsRateCard months={monthly} />

          {current && (
            <WhereItWentCard
              rangeMonths={range}
              endYM={{ year: current.year, month: current.month }}
              breakdown={breakdown}
              prevBreakdown={prevBreakdown}
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
