import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { fmt, apiGet, monthLabel } from '../api'
import { entityColor, colorForName, TRANSFER_OUT, SAVING } from '../theme'
import { Card, SectionLabel, Badge, EmptyState, PrimaryButton } from '../components/ui'
import { useRefetchOnFocus } from '../hooks'

function c(cents) { return fmt(cents / 100) }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

// Deleted funds/bills get an "(deleted)" suffix baked into their resolved
// name (see backend _enrich) — strip it before hashing so a deleted entity's
// dot still matches the color it wore while alive, not a re-hashed color.
function stripDeletedSuffix(name) {
  return name ? name.replace(/ \(deleted\)$/, '') : name
}

// Mirrors FundDetailPage's groupByMonth — transactions arrive sorted `date
// desc, id desc` from the API, so grouping consecutive same-month entries
// (no re-sort) keeps newest month first for free.
function groupByMonth(transactions) {
  const groups = []
  for (const tx of transactions) {
    const ym = tx.date.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.ym === ym) last.entries.push(tx)
    else groups.push({ ym, entries: [tx] })
  }
  return groups
}

function TransactionRow({ tx, fundColorById, billColorByName }) {
  // Income entries (paychecks + one-off "Other Income" gifts) arrive in the
  // same list as spend rows (`?include_income=true`) — they carry no
  // fund/bill identity, so they get their own treatment: SAVING green (the
  // app's one "money kept/coming in" hue) instead of an entity color, and an
  // inflow arrow instead of an identity dot.
  const isIncome = tx.kind === 'paycheck' || tx.kind === 'misc_income'
  // A transaction that resolved a fund_name is fund-routed (direct fund spend,
  // or a fund-type line item) — same precedence FundsPage/ExpensesPage use to
  // decide "is this row a Fund or a Bill." Bills only ever resolve line_item_name.
  const isFund = !!tx.fund_name
  const name = isIncome
    ? (tx.kind === 'paycheck' ? 'Paycheck' : 'Other Income')
    : (tx.fund_name || tx.line_item_name || 'Uncategorized')
  const isTransferOut = tx.destination_type === 'transfer_out'
  const color = isIncome
    ? SAVING
    : isFund
      ? entityColor({ id: tx.fund_id, color: fundColorById[tx.fund_id] })
      : (billColorByName[stripDeletedSuffix(name)] || colorForName(stripDeletedSuffix(name)))

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {isIncome
        ? <ArrowUpRight size={14} className="shrink-0" style={{ color }} />
        : <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-ink truncate">{name}</p>
          {/* Honesty over neatness: transfer-out money stays inline (never
              hidden), just visibly marked as "not spending." */}
          {isTransferOut && <Badge tone="transfer" className="shrink-0">Transfer</Badge>}
        </div>
        <p className="text-xs text-ink-3 mt-0.5 truncate">
          {tx.merchant ? `${tx.merchant} · ${fmtDate(tx.date)}` : fmtDate(tx.date)}
        </p>
      </div>
      <span
        className="text-sm font-semibold tabular shrink-0"
        style={isIncome ? { color } : isTransferOut ? { color: TRANSFER_OUT } : undefined}
      >
        {isIncome ? '+' : ''}{c(tx.amount_cents)}
      </span>
    </div>
  )
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([])
  const [funds, setFunds] = useState([])
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const clock = await apiGet('/dev/current-date')
      const [y, m] = clock.effective_date.split('-').map(Number)
      const [txData, fundsData, lineItems] = await Promise.all([
        apiGet('/transactions/?include_income=true'),
        apiGet('/funds/'),
        apiGet(`/line-items/?year=${y}&month=${m}`),
      ])
      setTransactions(txData)
      setFunds(fundsData)
      setBills(lineItems.filter((i) => i.type === 'bill'))
    } catch (err) {
      setLoadError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useRefetchOnFocus(load)

  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-64 px-4">
        <Card className="p-6 text-center max-w-sm">
          <p className="text-sm text-critical mb-4">{loadError}</p>
          <PrimaryButton onClick={load}>Retry</PrimaryButton>
        </Card>
      </div>
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-ink-3">Loading…</div>
  }

  // Current-month bill/fund colors, keyed for lookup — same pattern
  // OverviewPage uses (billColorByName / fundColorById) so a bill or fund's
  // identity dot here always matches its color everywhere else in the app.
  const fundColorById = Object.fromEntries(funds.map((f) => [f.id, f.color]))
  const billColorByName = Object.fromEntries(bills.map((b) => [b.name, b.color]))
  const groups = groupByMonth(transactions)

  return (
    <div className="px-4 pt-6 pb-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/expenses"
          aria-label="Back to Expenses"
          className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-paper hover:text-ink-2 transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-3xl font-bold text-ink tracking-tight">All Transactions</h1>
      </div>

      {transactions.length === 0 ? (
        <EmptyState
          title="No transactions logged yet"
          action={<Link to="/expenses" className="text-sm font-semibold text-accent-ink">Log a transaction →</Link>}
        />
      ) : (
        groups.map((group) => (
          <div key={group.ym}>
            <SectionLabel>{monthLabel(group.ym)}</SectionLabel>
            <Card className="overflow-hidden divide-y divide-line">
              {group.entries.map((tx) => (
                <TransactionRow key={`${tx.kind}-${tx.id}`} tx={tx} fundColorById={fundColorById} billColorByName={billColorByName} />
              ))}
            </Card>
          </div>
        ))
      )}
    </div>
  )
}
