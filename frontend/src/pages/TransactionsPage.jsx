import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Search, X } from 'lucide-react'
import { fmt, apiGet, apiDel, apiPatch, monthLabel } from '../api'
import { entityColor, colorForName, TRANSFER_OUT, SAVING, CRITICAL } from '../theme'
import { Card, SectionLabel, Badge, EmptyState, PrimaryButton, Segmented } from '../components/ui'
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

const isIncomeTx = (tx) => tx.kind === 'paycheck' || tx.kind === 'misc_income'

// Single source of truth for a row's displayed name — search matches on this
// same string.
function txName(tx) {
  if (isIncomeTx(tx)) return tx.kind === 'paycheck' ? 'Paycheck' : 'Other Income'
  const isSavings = !!tx.from_savings
  const isTransferOut = tx.destination_type === 'transfer_out'
  if (isSavings && isTransferOut) return `→ ${tx.merchant || 'Other account'}`
  if (isSavings && !isTransferOut) return 'Savings withdrawal'
  return tx.fund_name || tx.line_item_name || 'Uncategorized'
}

function matchesQuery(tx, q) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  if (txName(tx).toLowerCase().includes(needle)) return true
  if ((tx.merchant || '').toLowerCase().includes(needle)) return true
  const digits = needle.replace(/[$,]/g, '')
  if (digits && /^\d*\.?\d*$/.test(digits)) {
    return (Math.abs(tx.amount_cents) / 100).toFixed(2).includes(digits)
  }
  return false
}

const fieldCls = 'w-full min-w-0 bg-card border border-line rounded-xl px-3 py-2 text-base text-ink focus:outline-none focus:border-accent'

// Inline edit form. Only changed fields are sent. Bucket ("From") is a single
// select whose value encodes the kind: b:<lineItemId> | f:<fundId> | s.
function EditForm({ tx, isIncome, funds, currentYM, unlockedYM, onSaved, onCancel }) {
  const origBucket = isIncome ? '' : tx.from_savings ? 's' : tx.fund_id ? `f:${tx.fund_id}` : tx.line_item_id ? `b:${tx.line_item_id}` : ''
  const origNote = isIncome ? (tx.label ?? tx.merchant ?? '') : (tx.merchant ?? '')
  const [amount, setAmount] = useState((tx.amount_cents / 100).toFixed(2))
  const [date, setDate] = useState(tx.date)
  const [note, setNote] = useState(origNote)
  const [bucket, setBucket] = useState(origBucket)
  const [bills, setBills] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (isIncome) return
    const [y, m] = tx.date.split('-').map(Number)
    apiGet(`/line-items/?year=${y}&month=${m}`)
      .then((items) => setBills(items.filter((i) => i.type === 'bill')))
      .catch(() => {})
  }, [tx.date, isIncome])

  async function save() {
    const cents = Math.round(parseFloat(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) { setErr('Enter an amount greater than $0'); return }
    if (!date) { setErr('Pick a date'); return }
    if (currentYM && date.slice(0, 7) < currentYM && date.slice(0, 7) !== unlockedYM) { setErr('That date is in a locked past month'); return }
    const body = {}
    if (cents !== tx.amount_cents) body.amount_cents = cents
    if (date !== tx.date) body.date = date
    if (note !== origNote) body[isIncome ? 'label' : 'merchant'] = note
    if (!isIncome && bucket !== origBucket) {
      if (bucket === 's') body.from_savings = true
      else if (bucket.startsWith('f:')) body.fund_id = Number(bucket.slice(2))
      else if (bucket.startsWith('b:')) body.line_item_id = Number(bucket.slice(2))
    }
    if (Object.keys(body).length === 0) { onCancel(); return }
    setBusy(true)
    setErr('')
    try {
      await apiPatch(isIncome ? `/income/${tx.id}` : `/transactions/${tx.id}`, body)
      await onSaved()
    } catch (e) {
      setErr(e.message || 'Could not save')
      setBusy(false)
    }
  }

  return (
    <div className="px-4 pb-4 -mt-1 space-y-3">
      <label className="block text-xs text-ink-3">
        Amount
        <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldCls} mt-1 tabular`} />
      </label>
      <label className="block text-xs text-ink-3">
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${fieldCls} mt-1`} />
      </label>
      <label className="block text-xs text-ink-3">
        {isIncome ? 'Label' : 'Note'}
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldCls} mt-1`} />
      </label>
      {!isIncome && (
        <label className="block text-xs text-ink-3">
          From
          <select value={bucket} onChange={(e) => setBucket(e.target.value)} className={`${fieldCls} mt-1`}>
            {origBucket === '' && <option value="" disabled>Choose…</option>}
            {bills.length > 0 && (
              <optgroup label="Bills">
                {bills.map((b) => <option key={`b${b.id}`} value={`b:${b.id}`}>{b.name}</option>)}
              </optgroup>
            )}
            {funds.length > 0 && (
              <optgroup label="Funds">
                {funds.map((f) => <option key={`f${f.id}`} value={`f:${f.id}`}>{f.name}</option>)}
              </optgroup>
            )}
            <option value="s">Savings</option>
          </select>
        </label>
      )}
      {err && <p className="text-xs text-critical">{err}</p>}
      <div className="flex items-center gap-4">
        <button onClick={save} disabled={busy} className="text-sm font-semibold text-accent-ink disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} disabled={busy} className="text-sm font-semibold text-ink-3 disabled:opacity-50">Cancel</button>
      </div>
    </div>
  )
}

function TransactionRow({ tx, funds, fundColorById, billColorByName, currentYM, unlockedYM, onUnlock, open, onToggle, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!open) setEditing(false) }, [open])
  const [err, setErr] = useState('')
  // Income entries (paychecks + one-off "Other Income" gifts) arrive in the
  // same list as spend rows (`?include_income=true`) — they carry no
  // fund/bill identity, so they get their own treatment: SAVING green (the
  // app's one "money kept/coming in" hue) instead of an entity color, and an
  // inflow arrow instead of an identity dot.
  const isIncome = isIncomeTx(tx)
  // A transaction that resolved a fund_name is fund-routed (direct fund spend,
  // or a fund-type line item) — same precedence FundsPage/ExpensesPage use to
  // decide "is this row a Fund or a Bill." Bills only ever resolve line_item_name.
  const isFund = !!tx.fund_name
  const isSavings = !!tx.from_savings
  const isTransferOut = tx.destination_type === 'transfer_out'
  // Savings -> outside account: reads as a transfer to that account, not a
  // spend named "Savings".
  const isSavingsTransfer = !isIncome && isSavings && isTransferOut
  const isWithdrawal = !isIncome && isSavings && !isTransferOut
  const name = txName(tx)
  const color = isIncome
    ? SAVING
    : isSavingsTransfer ? TRANSFER_OUT
    : isWithdrawal ? CRITICAL
    : isSavings ? CRITICAL
    : isFund
      ? entityColor({ id: tx.fund_id, color: fundColorById[tx.fund_id] })
      : (billColorByName[stripDeletedSuffix(name)] || colorForName(stripDeletedSuffix(name)))

  const refundTo = isSavings ? 'Savings' : isFund ? tx.fund_name : 'Monthly Reserve'
  // U8: past months are locked; only the effective current month or later is deletable.
  const locked = !!currentYM && tx.date.slice(0, 7) < currentYM && tx.date.slice(0, 7) !== unlockedYM
  async function confirmDelete() {
    setBusy(true)
    setErr('')
    try {
      await apiDel(isIncome ? `/income/${tx.id}` : `/transactions/${tx.id}`)
      await onDeleted()
    } catch (e) {
      setErr(e.message || 'Could not delete')
      setBusy(false)
    }
  }

  return (
    <div>
    <div
      className="flex items-center gap-3 px-4 py-3 cursor-pointer"
      onClick={onToggle}
    >
      {isIncome
        ? <ArrowUpRight size={14} className="shrink-0" style={{ color }} />
        : isWithdrawal
        ? <ArrowDownRight size={14} className="shrink-0" style={{ color }} />
        : <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-ink truncate">{name}</p>
          {/* Honesty over neatness: transfer-out money stays inline (never
              hidden), just visibly marked as "not spending." */}
          {isTransferOut && <Badge tone="transfer" className="shrink-0">Transfer out</Badge>}
        </div>
        <p className="text-xs text-ink-3 mt-0.5 truncate">
          {isWithdrawal
            ? `${tx.merchant || 'Unlabeled'} · ${fmtDate(tx.date)}`
            : isSavings && !isIncome
            ? `from Savings · ${fmtDate(tx.date)}`
            : tx.merchant ? `${tx.merchant} · ${fmtDate(tx.date)}` : fmtDate(tx.date)}
        </p>
      </div>
      <span
        className="text-sm font-semibold tabular shrink-0"
        style={isIncome || isWithdrawal ? { color } : isTransferOut ? { color: TRANSFER_OUT } : undefined}
      >
        {isIncome ? '+' : ''}{c(tx.amount_cents)}
      </span>
    </div>
    {open && locked && (
      <div className="px-4 pb-3 -mt-1 flex items-center gap-3">
        <p className="text-xs text-ink-3 flex-1 min-w-0">Past months are locked</p>
        <button onClick={() => onUnlock(tx.date.slice(0, 7))} className="text-xs font-semibold text-accent-ink shrink-0">Unlock {monthLabel(tx.date.slice(0, 7))}</button>
      </div>
    )}
    {open && !locked && editing && (
      <EditForm tx={tx} isIncome={isIncome} funds={funds} currentYM={currentYM} unlockedYM={unlockedYM} onSaved={onDeleted} onCancel={() => setEditing(false)} />
    )}
    {open && !locked && !editing && (
      <div className="px-4 pb-3 -mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-xs text-ink-2 flex-1 min-w-0">
          {isIncome ? `Delete this income? ${c(tx.amount_cents)} comes out of Savings.` : `Delete this? It goes back to ${refundTo}.`}
        </p>
        <button onClick={() => setEditing(true)} disabled={busy} className="text-xs font-semibold text-accent-ink disabled:opacity-50">Edit</button>
        <button onClick={confirmDelete} disabled={busy} className="text-xs font-semibold text-critical disabled:opacity-50">
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button onClick={onToggle} disabled={busy} className="text-xs font-semibold text-ink-3">Cancel</button>
        {err && <p className="w-full text-xs text-critical">{err}</p>}
      </div>
    )}
    </div>
  )
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([])
  const [funds, setFunds] = useState([])
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [openKey, setOpenKey] = useState(null)
  const [currentYM, setCurrentYM] = useState('')
  // U8: per-visit unlock of one past month, like Expenses' month unlock.
  const [unlockedYM, setUnlockedYM] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const clock = await apiGet('/dev/current-date')
      const [y, m] = clock.effective_date.split('-').map(Number)
      setCurrentYM(clock.effective_date.slice(0, 7))
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

  async function handleDeleted() {
    setOpenKey(null)
    await load()
    window.dispatchEvent(new Event('dev-refresh'))
  }

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
  const filtersActive = !!(query.trim() || typeFilter !== 'all' || fromDate || toDate)
  const filtered = filtersActive
    ? transactions.filter((tx) => {
        const inc = isIncomeTx(tx)
        if (typeFilter === 'income' && !inc) return false
        if (typeFilter === 'spending' && inc) return false
        if (fromDate && tx.date < fromDate) return false
        if (toDate && tx.date > toDate) return false
        return matchesQuery(tx, query)
      })
    : transactions
  const totalOut = filtered.filter((t) => !isIncomeTx(t)).reduce((a, t) => a + t.amount_cents, 0)
  const totalIn = filtered.filter(isIncomeTx).reduce((a, t) => a + t.amount_cents, 0)
  const groups = groupByMonth(filtered)
  function clearFilters() { setQuery(''); setTypeFilter('all'); setFromDate(''); setToDate('') }
  const dateInput = 'w-full min-w-0 bg-card border border-line rounded-xl px-3 py-2 text-base text-ink focus:outline-none focus:border-accent'

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

      {transactions.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, merchant or amount"
              aria-label="Search transactions"
              className="w-full bg-card border border-line rounded-xl pl-9 pr-9 py-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-ink-3 hover:text-ink-2"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <Segmented
            options={[{ value: 'all', label: 'All' }, { value: 'spending', label: 'Spending' }, { value: 'income', label: 'Income' }]}
            value={typeFilter}
            onChange={setTypeFilter}
          />
          <div className="flex gap-3">
            <label className="flex-1 min-w-0 text-xs text-ink-3">
              From
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} className={`${dateInput} mt-1`} />
            </label>
            <label className="flex-1 min-w-0 text-xs text-ink-3">
              To
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} className={`${dateInput} mt-1`} />
            </label>
          </div>
          {filtersActive && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-2 tabular">
                {filtered.length} {filtered.length === 1 ? 'result' : 'results'} · {c(totalOut)} out · {c(totalIn)} in
              </p>
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-accent-ink shrink-0">Clear</button>
            </div>
          )}
        </div>
      )}

      {transactions.length === 0 ? (
        <EmptyState
          title="No transactions logged yet"
          action={<Link to="/expenses" className="text-sm font-semibold text-accent-ink">Log a transaction →</Link>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" />
      ) : (
        groups.map((group) => (
          <div key={group.ym}>
            <SectionLabel>{monthLabel(group.ym)}</SectionLabel>
            <Card className="overflow-hidden divide-y divide-line">
              {group.entries.map((tx) => (
                <TransactionRow key={`${tx.kind}-${tx.id}`} tx={tx} funds={funds} fundColorById={fundColorById} billColorByName={billColorByName} currentYM={currentYM} unlockedYM={unlockedYM} onUnlock={setUnlockedYM}
                  open={openKey === `${tx.kind}-${tx.id}`}
                  onToggle={() => setOpenKey(openKey === `${tx.kind}-${tx.id}` ? null : `${tx.kind}-${tx.id}`)}
                  onDeleted={handleDeleted} />
              ))}
            </Card>
          </div>
        ))
      )}
    </div>
  )
}
