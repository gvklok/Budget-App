import { useState } from 'react'
import { ArrowDownRight, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { fmt } from '../api'
import { IconButton } from './ui'
import { BILLS, FUNDS_HUE, CRITICAL } from '../theme'

function c(cents) { return fmt((cents ?? 0) / 100) }

// Reasons for this month's unplanned Savings spending: merchant names of
// from_savings external_spend transactions, biggest first, deduped.
export function savingsReasons(txns) {
  const byName = new Map()
  for (const tx of txns ?? []) {
    if (!tx.from_savings || tx.destination_type === 'transfer_out') continue
    const name = (tx.merchant || '').trim() || 'Unlabeled'
    byName.set(name, (byName.get(name) ?? 0) + tx.amount_cents)
  }
  return [...byName.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}

export function Row({ dot, label, children, right, sub, onClick, open }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <div>
      <Tag onClick={onClick} className={`w-full flex items-baseline justify-between gap-3 ${onClick ? 'text-left' : ''}`}>
        <p className="min-w-0 text-sm text-ink flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: dot }} />
          <span><span className="font-semibold">{label}</span>{' '}<span className="text-ink-2 tabular">{children}</span></span>
        </p>
        <span className="flex items-center gap-1.5 shrink-0">
          {right}
          {onClick && (open ? <ChevronUp size={14} className="text-ink-3 self-center" /> : <ChevronDown size={14} className="text-ink-3 self-center" />)}
        </span>
      </Tag>
      {sub && <p className="text-xs text-ink-3 mt-0.5 pl-4">{sub}</p>}
    </div>
  )
}

export function monthStatusVisible(summary) {
  if (!summary) return false
  return (summary.bills_planned_cents ?? 0) > 0 || (summary.bills_spent_cents ?? 0) > 0
    || (summary.actual_spending_cents ?? 0) > 0
}

// Three-line month headline: Bills vs plan, Funds spent, unplanned From
// Savings. All numbers come straight from /monthly-summary; From Savings is
// deliberately red (per owner) and never counted toward "over".
// Optional `withdrawals` + `onDeleteWithdrawal` make the From Savings line
// expandable into the individual Savings spends (Expenses page only).
export default function MonthStatus({ summary, reasons = [], withdrawals, onDeleteWithdrawal, locked = false, showOnTrack = true }) {
  const [open, setOpen] = useState(false)
  if (!monthStatusVisible(summary)) return null
  const planned = summary.bills_planned_cents ?? 0
  const billsSpent = summary.bills_spent_cents ?? 0
  const over = summary.bills_over_cents ?? 0
  const fromSavings = summary.savings_withdrawals_cents ?? 0
  const fundSpent = Math.max(0, (summary.actual_spending_cents ?? 0) - billsSpent - fromSavings)
  const showBills = planned > 0 || billsSpent > 0

  const shown = reasons.slice(0, 3)
  const extra = reasons.length - shown.length
  const reasonText = shown.join(', ') + (extra > 0 ? ` +${extra} more` : '')

  return (
    <div className="space-y-2.5">
      {showBills && (
        <Row dot={BILLS} label="Bills" right={
          over > 0
            ? <span className="text-xs font-semibold text-critical tabular shrink-0">Over by {c(over)}</span>
            : showOnTrack ? <span className="text-xs font-semibold text-saving-ink shrink-0">✓ on track</span> : null
        }>
          {c(billsSpent)} of {c(planned)} planned
        </Row>
      )}
      {fundSpent > 0 && (
        <Row dot={FUNDS_HUE} label="Funds">{c(fundSpent)} spent from funds</Row>
      )}
      {fromSavings > 0 && (
        <div>
        <Row dot={CRITICAL} label="From Savings"
          onClick={withdrawals?.length ? () => setOpen((v) => !v) : undefined} open={open}
          sub={reasonText ? `${reasonText} · not counted as over` : 'Not counted as over'}
          right={<span className="text-xs font-semibold text-critical tabular shrink-0">{c(fromSavings)} unplanned</span>}
        />
        {open && withdrawals?.length > 0 && (
          <div className="mt-2 ml-4 divide-y divide-line">
            {withdrawals.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-2">
                <ArrowDownRight size={13} className="shrink-0 text-critical" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-ink truncate">Savings withdrawal</p>
                  <p className="text-xs text-ink-3 truncate">
                    {(t.merchant || '').trim() || 'Unlabeled'} · {t.date.slice(5).replace('-', '/')}
                  </p>
                </div>
                <span className="text-xs font-semibold tabular text-critical">{c(t.amount_cents)}</span>
                {!locked && onDeleteWithdrawal && (
                  <IconButton compact onClick={() => onDeleteWithdrawal(t)} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={13} /></IconButton>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      )}
    </div>
  )
}
