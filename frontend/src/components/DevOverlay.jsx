import { useState, useEffect } from 'react'
import { fmt, toCents } from '../api'

async function fetchState() {
  const r = await fetch('/api/state')
  return r.json()
}

async function fetchSimTxns() {
  const r = await fetch('/api/dev/simulated-transactions')
  return r.json()
}

async function devPost(path, body) {
  const r = await fetch(`/api/dev/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail || 'Request failed')
  }
  return r.json()
}

function c(cents) {
  return fmt(cents / 100)
}

function SetField({ label, currentCents, onSet }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSet() {
    if (!value) return
    setSaving(true)
    setError('')
    try {
      await onSet(toCents(value))
      setValue('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-300 flex-1">{label}</span>
        <span className="text-sm font-mono tabular text-white w-24 text-right shrink-0">
          {c(currentCents)}
        </span>
        <input
          type="number"
          step="0.01"
          placeholder="new value"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && handleSet()}
          className="w-28 border border-white/10 bg-white/5 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-white/30"
        />
        <button
          onClick={handleSet}
          disabled={saving || !value}
          className="text-sm bg-accent text-white rounded-lg px-3 py-1.5 disabled:opacity-40 shrink-0 font-medium"
        >
          Set
        </button>
      </div>
      {error && <p className="text-xs text-critical mt-1 text-right">{error}</p>}
    </div>
  )
}

function Reconciliation({ state }) {
  const rc = state.real_cash.balance_cents
  const savings = state.savings.balance_cents
  const mr = state.monthly_reserve.balance_cents
  const fundTotal = state.funds.reduce((s, f) => s + f.balance_cents, 0)
  const buckets = savings + mr + fundTotal
  const gap = rc - buckets

  return (
    <div className="bg-white/5 rounded-2xl p-4 space-y-2 border border-white/10">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
        Reconciliation
      </p>
      <div className="flex justify-between text-sm font-semibold text-white">
        <span>Real Cash</span>
        <span className="font-mono tabular">{c(rc)}</span>
      </div>
      <div className="ml-3 space-y-1 text-sm text-slate-400">
        <div className="flex justify-between">
          <span>Savings</span>
          <span className="font-mono tabular">{c(savings)}</span>
        </div>
        <div className="flex justify-between">
          <span>Monthly Reserve</span>
          <span className="font-mono tabular">{c(mr)}</span>
        </div>
        {state.funds.map((f) => (
          <div key={f.id} className="flex justify-between">
            <span>{f.name}</span>
            <span className="font-mono tabular">{c(f.balance_cents)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-white/10 pt-1 text-slate-200 font-medium">
          <span>Buckets total</span>
          <span className="font-mono tabular">{c(buckets)}</span>
        </div>
      </div>
      <div
        className={`flex justify-between items-center rounded-xl px-3 py-2 text-sm font-semibold mt-1 ${
          gap === 0
            ? 'bg-good/20 text-good'
            : gap > 0
            ? 'bg-warn/20 text-warn'
            : 'bg-critical/20 text-critical'
        }`}
      >
        <span>
          {gap === 0
            ? 'Balanced'
            : gap > 0
            ? 'Unallocated (add to buckets)'
            : 'Over-allocated (reduce buckets)'}
        </span>
        <span className="font-mono tabular">{gap === 0 ? '✓' : c(Math.abs(gap))}</span>
      </div>
    </div>
  )
}

function SimulateSpend({ state, onDone }) {
  const buckets = [
    { id: 'mr', label: 'Monthly Reserve', balance_cents: state.monthly_reserve.balance_cents },
    ...state.funds.map((f) => ({ id: `fund:${f.id}`, label: f.name, balance_cents: f.balance_cents })),
    { id: 'savings', label: 'Savings', balance_cents: state.savings.balance_cents },
  ]

  const [bucket, setBucket] = useState(buckets[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = buckets.find((b) => b.id === bucket)

  async function handleSpend() {
    if (!amount) return setError('Amount is required')
    setSaving(true)
    setError('')
    try {
      await devPost('simulate-transaction', {
        bucket,
        amount_cents: toCents(amount),
        label: label.trim() || null,
      })
      setAmount('')
      setLabel('')
      await onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (buckets.length === 0) {
    return <p className="text-xs text-slate-400">No spendable buckets yet (add MR balance or a Fund).</p>
  }

  return (
    <div className="space-y-2">
      <select
        value={bucket}
        onChange={(e) => setBucket(e.target.value)}
        className="w-full border border-white/10 bg-white/5 rounded-lg px-2.5 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/30"
      >
        {buckets.map((b) => (
          <option key={b.id} value={b.id} className="bg-ink">
            {b.label} — {c(b.balance_cents)}
          </option>
        ))}
      </select>
      {bucket === 'savings' && (
        <p className="text-xs text-warn bg-warn/10 rounded-lg px-2.5 py-1.5">
          Spending directly from Savings is unusual — money won't be coming from any specific fund or budget.
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="number"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="flex-1 border border-white/10 bg-white/5 rounded-lg px-2.5 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/30 placeholder:text-slate-500"
        />
        <input
          type="text"
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="flex-1 border border-white/10 bg-white/5 rounded-lg px-2.5 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/30 placeholder:text-slate-500"
        />
      </div>
      {error && <p className="text-xs text-critical">{error}</p>}
      <button
        onClick={handleSpend}
        disabled={saving || !amount}
        className="w-full bg-accent text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40"
      >
        {saving ? 'Spending…' : 'Simulate Spend'}
      </button>
    </div>
  )
}

function bucketLabel(bucketRef, funds) {
  if (bucketRef === 'savings') return 'Savings'
  if (bucketRef === 'mr') return 'Monthly Reserve'
  if (bucketRef.startsWith('fund:')) {
    const id = parseInt(bucketRef.split(':')[1])
    return funds.find((f) => f.id === id)?.name ?? bucketRef
  }
  return bucketRef
}

export default function DevOverlay() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState(null)
  const [simTxns, setSimTxns] = useState([])
  const [resetting, setResetting] = useState(false)
  const [paycheckCount, setPaycheckCount] = useState(0)
  const [paycheckError, setPaycheckError] = useState('')
  const [simulating, setSimulating] = useState(false)

  async function load() {
    const [s, txns] = await Promise.all([fetchState(), fetchSimTxns()])
    setState(s)
    setSimTxns(txns)
  }

  function close() {
    setOpen(false)
    window.dispatchEvent(new Event('dev-refresh'))
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  async function doSet(path, body) {
    await devPost(path, body)
    await load()
  }

  async function handleReset() {
    if (!confirm('Reset all data to zero?')) return
    setResetting(true)
    try {
      await devPost('reset', {})
      setPaycheckCount(0)
      setPaycheckError('')
      await load()
    } finally {
      setResetting(false)
    }
  }

  async function handleSimulatePaycheck() {
    setSimulating(true)
    setPaycheckError('')
    try {
      await devPost('simulate-paycheck', {})
      setPaycheckCount((n) => n + 1)
      await load()
    } catch (err) {
      setPaycheckError(err.message)
    } finally {
      setSimulating(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-24 right-4 z-50 bg-ink text-white text-[11px] font-bold tracking-wide px-3.5 py-2 rounded-full shadow-pop border border-white/10"
      >
        DEV
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end items-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={close} />

          <div className="relative bg-ink rounded-[28px] shadow-pop flex flex-col max-h-[85vh] w-full max-w-sm mx-auto mb-4 border border-white/10">
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 shrink-0">
              <span className="font-bold text-white">Dev Panel</span>
              <button onClick={close} className="text-slate-400 text-sm font-medium">Done</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-5">
              {!state ? (
                <p className="text-slate-400 text-sm text-center py-12">Loading…</p>
              ) : (
                <>
                  <Reconciliation state={state} />

                  {/* Set Values */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Set Values</p>
                    <div className="divide-y divide-white/10">
                      <SetField
                        label="Real Cash → Savings"
                        currentCents={state.real_cash.balance_cents}
                        onSet={(cents) => doSet('set-real-cash', { balance_cents: cents })}
                      />
                      <SetField
                        label="Savings"
                        currentCents={state.savings.balance_cents}
                        onSet={(cents) => doSet('set-savings', { balance_cents: cents })}
                      />
                      <SetField
                        label="MR Balance"
                        currentCents={state.monthly_reserve.balance_cents}
                        onSet={(cents) => doSet('set-mr-balance', { balance_cents: cents })}
                      />
                      <SetField
                        label="MR Target"
                        currentCents={state.monthly_reserve.target_cents}
                        onSet={(cents) => doSet('set-mr-target', { target_cents: cents })}
                      />
                    </div>
                  </div>

                  {/* Funds */}
                  {state.funds.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Funds</p>
                      <div className="space-y-4">
                        {state.funds.map((fund) => (
                          <div key={fund.id}>
                            <p className="text-sm font-semibold text-slate-200 mb-1">{fund.name}</p>
                            <div className="divide-y divide-white/10">
                              <SetField
                                label="Balance"
                                currentCents={fund.balance_cents}
                                onSet={(cents) => doSet('set-fund-balance', { fund_id: fund.id, balance_cents: cents })}
                              />
                              <SetField
                                label="Contribution"
                                currentCents={fund.monthly_contribution_cents}
                                onSet={(cents) => doSet('set-fund-contribution', { fund_id: fund.id, monthly_contribution_cents: cents })}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Simulate Paycheck */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Simulate Paycheck</p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSimulatePaycheck}
                        disabled={simulating}
                        className="flex-1 bg-good text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
                      >
                        {simulating ? 'Adding…' : '+ Simulate Paycheck'}
                      </button>
                      {paycheckCount > 0 && (
                        <span className="text-xs font-semibold text-slate-400 shrink-0">
                          ×{paycheckCount} this session
                        </span>
                      )}
                    </div>
                    {paycheckError && <p className="text-xs text-critical mt-1">{paycheckError}</p>}
                    <p className="text-xs text-slate-500 mt-1">Adds one month's income to Savings + Real Cash.</p>
                  </div>

                  {/* Simulate Spending */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Simulate Spending</p>
                    <SimulateSpend state={state} onDone={load} />
                  </div>

                  {/* Recent simulated transactions */}
                  {simTxns.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Recent Simulated Spends</p>
                      <div className="space-y-1">
                        {simTxns.map((t) => (
                          <div key={t.id} className="flex justify-between text-xs text-slate-400 py-1 border-b border-white/5">
                            <span className="truncate flex-1">
                              {bucketLabel(t.bucket_ref, state.funds)}
                              {t.label ? ` · ${t.label}` : ''}
                            </span>
                            <span className="font-mono tabular text-slate-200 ml-2 shrink-0">−{c(t.amount_cents)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    className="w-full bg-critical text-white rounded-xl py-3 font-semibold disabled:opacity-40"
                  >
                    {resetting ? 'Resetting…' : 'Reset All Data'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
