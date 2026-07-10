import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, Plus, ArrowRightLeft, AlertTriangle } from 'lucide-react'
import { fmt, toCents } from '../api'
import { CHART_COLORS, SAVINGS_SWATCH, RESERVE_SWATCH } from '../theme'
import Modal from '../components/Modal'
import { Card, SectionLabel, Badge, PrimaryButton, IconButton, EmptyState, Segmented } from '../components/ui'

function c(cents) {
  return fmt(cents / 100)
}

const inputClass =
  'w-full border border-line rounded-2xl px-3.5 py-2.5 text-ink outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-shadow bg-white'
const labelClass = 'block text-sm font-medium text-ink-2 mb-1.5'

// U1: External Spend (money leaves your net worth) vs Transfer Out (moves to
// another account you own — 401k, Roth, HSA). Reporting-only distinction.
function DestinationTypeField({ value, onChange }) {
  return (
    <div>
      <label className={labelClass}>Destination</label>
      <Segmented
        value={value}
        onChange={onChange}
        options={[
          { value: 'external_spend', label: 'External Spend' },
          { value: 'transfer_out', label: 'Transfer Out' },
        ]}
      />
      <p className="text-xs text-ink-3 mt-1.5">
        {value === 'transfer_out'
          ? "Money moves to another account you own (401k, Roth, HSA) — excluded from spending totals."
          : 'Money leaves your net worth when spent — counts as spending.'}
      </p>
    </div>
  )
}

// U9: lets a Fund's balance drop below zero instead of blocking the spend —
// useful for discretionary Funds that should just "catch up" next month.
function AllowNegativeField({ checked, onChange }) {
  return (
    <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-line bg-white cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <div>
        <p className="text-sm font-medium text-ink">Allow this Fund to go negative</p>
        <p className="text-xs text-ink-3 mt-0.5">Catches up automatically via its monthly contribution. Useful for discretionary spending like Vacation or personal spending — not recommended for Transfer Out Funds or Emergency.</p>
      </div>
    </label>
  )
}

function AddFundModal({ savings_cents, onClose, onSave }) {
  const [name, setName] = useState('')
  const [balance, setBalance] = useState('')
  const [destinationType, setDestinationType] = useState('external_spend')
  const [allowNegative, setAllowNegative] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    setSaving(true)
    setError('')
    try {
      await onSave({
        name: name.trim(),
        balance_cents: toCents(balance),
        monthly_contribution_cents: 0,
        destination_type: destinationType,
        allow_negative_balance: allowNegative,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Add Fund" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Vacation, Emergency"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            Initial balance <span className="text-ink-3 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-ink-3 mb-1.5">Available in savings: {c(savings_cents)}</p>
          <input
            type="number"
            step="0.01"
            min="0"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
        <DestinationTypeField value={destinationType} onChange={setDestinationType} />
        <AllowNegativeField checked={allowNegative} onChange={setAllowNegative} />
        <p className="text-xs text-ink-3">
          Set this fund's monthly contribution on the Expenses page.
        </p>
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? 'Adding…' : 'Add Fund'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

function EditFundModal({ fund, onClose, onSave }) {
  const [name, setName] = useState(fund.name)
  const [destinationType, setDestinationType] = useState(fund.destination_type ?? 'external_spend')
  const [allowNegative, setAllowNegative] = useState(fund.allow_negative_balance ?? false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    setSaving(true)
    setError('')
    try {
      await onSave(fund.id, { name: name.trim(), destination_type: destinationType, allow_negative_balance: allowNegative })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Edit Fund" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <DestinationTypeField value={destinationType} onChange={setDestinationType} />
        <AllowNegativeField checked={allowNegative} onChange={setAllowNegative} />
        <div className="rounded-2xl bg-paper px-3.5 py-3">
          <p className="text-xs text-ink-3 mb-0.5">Monthly contribution</p>
          <p className="text-sm font-semibold text-ink-2">
            {fund.monthly_contribution_cents > 0 ? `${c(fund.monthly_contribution_cents)} / month` : 'Not set'}
          </p>
          <p className="text-xs text-ink-3 mt-1">Edit this on the Expenses page.</p>
        </div>
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving…' : 'Save Changes'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

function TransferModal({ state, onClose, onTransfer }) {
  const buckets = [
    { id: 'savings', label: 'Savings', balance_cents: state.savings.balance_cents },
    { id: 'mr', label: 'Monthly Reserve', balance_cents: state.monthly_reserve.balance_cents },
    ...state.funds.map((f) => ({ id: `fund:${f.id}`, label: f.name, balance_cents: f.balance_cents })),
  ]

  const [from, setFrom] = useState(buckets[0].id)
  const [to, setTo] = useState(buckets[1]?.id ?? buckets[0].id)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const fromBucket = buckets.find((b) => b.id === from)
  const toBuckets = buckets.filter((b) => b.id !== from)

  function handleFromChange(val) {
    setFrom(val)
    if (to === val) setTo(buckets.find((b) => b.id !== val)?.id ?? '')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!amount) return setError('Amount is required')
    setSaving(true)
    setError('')
    try {
      await onTransfer({ from_bucket: from, to_bucket: to, amount_cents: toCents(amount) })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const selectClass = `${inputClass} appearance-none`

  return (
    <Modal title="Transfer" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>From</label>
          <select value={from} onChange={(e) => handleFromChange(e.target.value)} className={selectClass}>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} — {c(b.balance_cents)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>To</label>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={selectClass}>
            {toBuckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} — {c(b.balance_cents)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Amount</label>
          <p className="text-xs text-ink-3 mb-1.5">
            Available: {fromBucket ? c(fromBucket.balance_cents) : '—'}
          </p>
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
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? 'Transferring…' : 'Transfer'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

function RealCashBreakdown({ savings, monthly_reserve, funds, total }) {
  if (total <= 0) return null

  const segments = [
    { label: 'Savings', amount: savings.balance_cents, color: SAVINGS_SWATCH },
    { label: 'Monthly Reserve', amount: monthly_reserve.balance_cents, color: RESERVE_SWATCH },
    ...funds.map((f, i) => ({ label: f.name, amount: f.balance_cents, color: CHART_COLORS[i % CHART_COLORS.length] })),
  ].filter((seg) => seg.amount > 0)

  return (
    <div className="mt-4 pt-4 border-t border-white/10">
      <div className="h-2 rounded-full bg-white/10 overflow-hidden flex gap-[2px]">
        {segments.map((seg) => (
          <div key={seg.label} className="h-full" style={{ width: `${(seg.amount / total) * 100}%`, background: seg.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1.5 text-xs text-white/70">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: seg.color }} />
            {seg.label}
            <span className="text-white/40 tabular">{c(seg.amount)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function MonthlyReserveCard({ mr, savings, onUpdate }) {
  const [toppingOff, setToppingOff] = useState(false)
  const [topOffError, setTopOffError] = useState('')

  const shortfall = mr.target_cents > 0 ? Math.max(0, mr.target_cents - mr.balance_cents) : 0
  const atTarget = mr.target_cents > 0 && mr.balance_cents >= mr.target_cents

  async function handleTopOff() {
    setToppingOff(true)
    setTopOffError('')
    try {
      const r = await fetch('/api/monthly-reserve/top-off', { method: 'POST' })
      if (!r.ok) {
        const err = await r.json()
        setTopOffError(err.detail || 'Top-off failed')
      } else {
        onUpdate()
      }
    } finally {
      setToppingOff(false)
    }
  }

  return (
    <Card className="p-5 mb-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-ink-3 mb-1">Monthly Reserve</p>
          <p className="text-2xl font-bold text-ink tabular">{c(mr.balance_cents)}</p>
          {mr.target_cents > 0 ? (
            <p className="text-xs text-ink-3 mt-1">remaining of {c(mr.target_cents)} bill target</p>
          ) : (
            <p className="text-xs text-ink-3 mt-1">No Bills configured yet</p>
          )}
        </div>
        <div className="shrink-0">
          {shortfall > 0 && (
            <button
              onClick={handleTopOff}
              disabled={toppingOff || savings.balance_cents < shortfall}
              className="text-xs font-semibold bg-ink text-white rounded-full px-4 py-2 disabled:opacity-40 active:scale-[0.98] transition-transform whitespace-nowrap"
            >
              {toppingOff ? 'Topping off…' : `Top Off ${c(shortfall)}`}
            </button>
          )}
          {atTarget && <Badge tone="good">Funded</Badge>}
        </div>
      </div>
      {topOffError && <p className="mt-2 text-xs text-critical text-right">{topOffError}</p>}
    </Card>
  )
}

export default function FundsPage() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [editFund, setEditFund] = useState(null)
  const [distributing, setDistributing] = useState(false)
  const [distributeResult, setDistributeResult] = useState(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/state')
    const data = await r.json()
    setState(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  async function handleCreate(data) {
    const r = await fetch('/api/funds/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.detail || 'Failed to create fund')
    }
    await load()
  }

  async function handleUpdate(id, data) {
    const r = await fetch(`/api/funds/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.detail || 'Failed to update fund')
    }
    await load()
  }

  async function handleDelete(fund) {
    if (!confirm(`Delete "${fund.name}"? Its balance (${c(fund.balance_cents)}) will return to Savings.`)) return
    await fetch(`/api/funds/${fund.id}`, { method: 'DELETE' })
    await load()
  }

  async function handleDistribute() {
    setDistributing(true)
    setDistributeResult(null)
    try {
      const r = await fetch('/api/funds/distribute', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) {
        setDistributeResult({ error: data.detail || 'Distribute failed' })
      } else {
        setDistributeResult(data)
        await load()
      }
    } finally {
      setDistributing(false)
    }
  }

  async function handleTransfer(data) {
    const r = await fetch('/api/transfers/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.detail || 'Transfer failed')
    }
    await load()
  }

  if (loading || !state) {
    return <div className="flex items-center justify-center h-64 text-ink-3">Loading…</div>
  }

  const { real_cash, savings, monthly_reserve, funds } = state

  return (
    <div className="px-4 pt-6 pb-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-3xl font-bold text-ink tracking-tight">Funds</h1>
        <button
          onClick={() => setShowTransfer(true)}
          className="flex items-center gap-1.5 text-sm font-semibold text-ink-2 border border-line bg-white rounded-full px-3.5 py-2 active:scale-[0.98] transition-transform"
        >
          <ArrowRightLeft size={14} />
          Transfer
        </button>
      </div>

      {/* Real Cash */}
      <Card ink className="p-5 mb-3">
        <p className="text-xs uppercase tracking-wide text-white/50">Real Cash</p>
        <p className="text-4xl font-bold mt-1 tabular">{c(real_cash.balance_cents)}</p>
        <p className="text-xs text-white/40 mt-2">Total in your bank account(s)</p>
        <RealCashBreakdown savings={savings} monthly_reserve={monthly_reserve} funds={funds} total={real_cash.balance_cents} />
      </Card>

      {/* Savings */}
      <Card className="p-4 mb-3">
        <p className="text-xs uppercase tracking-wide text-ink-3 mb-1">Savings</p>
        <p className="text-2xl font-bold text-ink tabular">{c(savings.balance_cents)}</p>
        <p className="text-xs text-ink-3 mt-1">Default resting place for all money</p>
      </Card>

      {/* Monthly Reserve */}
      <MonthlyReserveCard mr={monthly_reserve} savings={savings} onUpdate={load} />

      {/* Funds */}
      <SectionLabel
        action={
          <div className="flex items-center gap-3">
            {funds.some((f) => f.monthly_contribution_cents > 0) && (
              <button
                onClick={handleDistribute}
                disabled={distributing}
                className="text-xs font-semibold text-good disabled:opacity-40"
              >
                {distributing ? 'Distributing…' : 'Distribute'}
              </button>
            )}
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 text-sm font-semibold text-ink"
            >
              <Plus size={16} />
              Add
            </button>
          </div>
        }
      >
        Funds
      </SectionLabel>

      {distributeResult && (
        <div className={`mb-3 px-4 py-3 rounded-2xl text-xs ${distributeResult.error ? 'bg-critical-soft text-critical' : 'bg-paper text-ink-2'}`}>
          {distributeResult.error ? distributeResult.error : (
            <>
              {distributeResult.funded.length > 0 && (
                <p>Funded: {distributeResult.funded.map((f) => `${f.name} (${c(f.amount_cents)})`).join(', ')}</p>
              )}
              {distributeResult.skipped.length > 0 && (
                <p className="text-warn mt-0.5">Skipped (not enough savings): {distributeResult.skipped.map((f) => f.name).join(', ')}</p>
              )}
            </>
          )}
        </div>
      )}

      {funds.length === 0 ? (
        <EmptyState title="No funds yet — add one above" />
      ) : (
        <div className="space-y-2.5">
          {funds.map((fund, i) => {
            const color = CHART_COLORS[i % CHART_COLORS.length]
            return (
              <Card key={fund.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {fund.balance_cents < 0 && <AlertTriangle size={13} className="text-critical shrink-0" />}
                        <p className="font-semibold text-ink truncate">{fund.name}</p>
                        {fund.destination_type === 'transfer_out' && <Badge tone="accent">Transfer Out</Badge>}
                        {fund.balance_cents < 0 && <Badge tone="critical">Recovering</Badge>}
                      </div>
                      <p className="text-xs text-ink-3 mt-0.5">
                        {fund.monthly_contribution_cents > 0
                          ? `${c(fund.monthly_contribution_cents)} / month`
                          : 'No contribution set'}
                      </p>
                    </div>
                  </div>
                  <p className={`text-lg font-bold shrink-0 tabular ${fund.balance_cents < 0 ? 'text-critical' : 'text-ink'}`}>{c(fund.balance_cents)}</p>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <IconButton onClick={() => setEditFund(fund)}><Pencil size={14} /></IconButton>
                    <IconButton onClick={() => handleDelete(fund)} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={14} /></IconButton>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {showAdd && (
        <AddFundModal
          savings_cents={savings.balance_cents}
          onClose={() => setShowAdd(false)}
          onSave={handleCreate}
        />
      )}
      {editFund && (
        <EditFundModal
          fund={editFund}
          onClose={() => setEditFund(null)}
          onSave={handleUpdate}
        />
      )}
      {showTransfer && (
        <TransferModal
          state={state}
          onClose={() => setShowTransfer(false)}
          onTransfer={handleTransfer}
        />
      )}
    </div>
  )
}
