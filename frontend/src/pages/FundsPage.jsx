import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, Plus, ArrowRightLeft, Check, X } from 'lucide-react'
import { fmt, toCents } from '../api'
import Modal from '../components/Modal'

function c(cents) {
  return fmt(cents / 100)
}

function AddFundModal({ savings_cents, onClose, onSave }) {
  const [name, setName] = useState('')
  const [balance, setBalance] = useState('')
  const [contribution, setContribution] = useState('')
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
        monthly_contribution_cents: toCents(contribution),
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
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Vacation, Emergency"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Initial balance <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-slate-400 mb-1">Available in savings: {c(savings_cents)}</p>
          <input
            type="number"
            step="0.01"
            min="0"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0.00"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Monthly contribution <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={contribution}
            onChange={(e) => setContribution(e.target.value)}
            placeholder="0.00"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add Fund'}
        </button>
      </form>
    </Modal>
  )
}

function EditFundModal({ fund, onClose, onSave }) {
  const [name, setName] = useState(fund.name)
  const [contribution, setContribution] = useState(
    fund.monthly_contribution_cents ? (fund.monthly_contribution_cents / 100).toFixed(2) : ''
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    setSaving(true)
    setError('')
    try {
      await onSave(fund.id, {
        name: name.trim(),
        monthly_contribution_cents: toCents(contribution),
      })
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
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Monthly contribution</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={contribution}
            onChange={(e) => setContribution(e.target.value)}
            placeholder="0.00"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
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

  const selectClass =
    'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 bg-white'

  return (
    <Modal title="Transfer" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">From</label>
          <select value={from} onChange={(e) => handleFromChange(e.target.value)} className={selectClass}>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} — {c(b.balance_cents)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">To</label>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={selectClass}>
            {toBuckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} — {c(b.balance_cents)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
          <p className="text-xs text-slate-400 mb-1">
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
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50"
        >
          {saving ? 'Transferring…' : 'Transfer'}
        </button>
      </form>
    </Modal>
  )
}

function MonthlyReserveCard({ mr, savings, onUpdate }) {
  const [editingTarget, setEditingTarget] = useState(false)
  const [targetValue, setTargetValue] = useState('')
  const [toppingOff, setToppingOff] = useState(false)
  const [topOffError, setTopOffError] = useState('')

  const shortfall = mr.target_cents > 0 ? Math.max(0, mr.target_cents - mr.balance_cents) : 0
  const atTarget = mr.target_cents > 0 && mr.balance_cents >= mr.target_cents

  async function handleSetTarget() {
    const cents = toCents(targetValue)
    const r = await fetch('/api/monthly-reserve/target', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_cents: cents }),
    })
    if (r.ok) {
      setEditingTarget(false)
      setTargetValue('')
      onUpdate()
    }
  }

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
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4 mb-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Monthly Reserve</p>
          <p className="text-2xl font-bold text-slate-900">{c(mr.balance_cents)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400 mb-1">Target</p>
          {editingTarget ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="number"
                step="0.01"
                min="0"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSetTarget(); if (e.key === 'Escape') setEditingTarget(false) }}
                placeholder="0.00"
                className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm text-right outline-none focus:ring-2 focus:ring-slate-400"
              />
              <button onClick={handleSetTarget} className="text-emerald-600"><Check size={14} /></button>
              <button onClick={() => setEditingTarget(false)} className="text-slate-400"><X size={14} /></button>
            </div>
          ) : (
            <button
              onClick={() => { setTargetValue(mr.target_cents ? (mr.target_cents / 100).toFixed(2) : ''); setEditingTarget(true) }}
              className="flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 group"
            >
              {c(mr.target_cents)}
              <Pencil size={11} className="opacity-0 group-hover:opacity-40 transition-opacity" />
            </button>
          )}
        </div>
      </div>

      {mr.target_cents > 0 && (
        <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${Math.min((mr.balance_cents / mr.target_cents) * 100, 100)}%` }}
          />
        </div>
      )}

      {shortfall > 0 && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleTopOff}
            disabled={toppingOff || savings.balance_cents < shortfall}
            className="text-xs font-semibold bg-slate-900 text-white rounded-xl px-3 py-1.5 disabled:opacity-40"
          >
            {toppingOff ? 'Topping off…' : `Top Off ${c(shortfall)}`}
          </button>
        </div>
      )}
      {atTarget && (
        <p className="mt-2 text-xs text-emerald-600 font-medium">Funded for this Month</p>
      )}
      {topOffError && <p className="mt-2 text-xs text-red-500">{topOffError}</p>}
    </div>
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
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>
  }

  const { real_cash, savings, monthly_reserve, funds } = state

  return (
    <div className="px-4 pt-6 pb-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-slate-950">Funds</h1>
        <button
          onClick={() => setShowTransfer(true)}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 border border-slate-200 bg-white rounded-xl px-3 py-2"
        >
          <ArrowRightLeft size={15} />
          Transfer
        </button>
      </div>

      {/* Real Cash */}
      <div className="rounded-3xl bg-slate-950 text-white p-5 mb-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Real Cash</p>
        <p className="text-4xl font-bold mt-1">{c(real_cash.balance_cents)}</p>
        <p className="text-xs text-slate-500 mt-2">Total in your bank account(s)</p>
      </div>

      {/* Savings */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4 mb-3">
        <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Savings</p>
        <p className="text-2xl font-bold text-slate-900">{c(savings.balance_cents)}</p>
        <p className="text-xs text-slate-400 mt-1">Default resting place for all money</p>
      </div>

      {/* Monthly Reserve */}
      <MonthlyReserveCard mr={monthly_reserve} savings={savings} onUpdate={load} />

      {/* Funds */}
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Funds</p>
        <div className="flex items-center gap-3">
          {funds.some((f) => f.monthly_contribution_cents > 0) && (
            <button
              onClick={handleDistribute}
              disabled={distributing}
              className="text-xs font-semibold text-emerald-700 disabled:opacity-40"
            >
              {distributing ? 'Distributing…' : 'Distribute'}
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-sm font-semibold text-slate-900"
          >
            <Plus size={16} />
            Add
          </button>
        </div>
      </div>
      {distributeResult && (
        <div className={`mb-2 px-4 py-3 rounded-2xl text-xs ${distributeResult.error ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-600'}`}>
          {distributeResult.error ? distributeResult.error : (
            <>
              {distributeResult.funded.length > 0 && (
                <p>Funded: {distributeResult.funded.map((f) => `${f.name} (${c(f.amount_cents)})`).join(', ')}</p>
              )}
              {distributeResult.skipped.length > 0 && (
                <p className="text-amber-600 mt-0.5">Skipped (not enough savings): {distributeResult.skipped.map((f) => f.name).join(', ')}</p>
              )}
            </>
          )}
        </div>
      )}

      {funds.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-slate-400 text-sm">No funds yet — add one above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {funds.map((fund) => (
            <div key={fund.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{fund.name}</p>
                  {fund.monthly_contribution_cents > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {c(fund.monthly_contribution_cents)} / month
                    </p>
                  )}
                </div>
                <p className="text-lg font-bold text-slate-900 shrink-0">{c(fund.balance_cents)}</p>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditFund(fund)}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(fund)}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
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
