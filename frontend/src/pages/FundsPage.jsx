import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Trash2, Plus, ArrowRightLeft, AlertTriangle, ChevronRight } from 'lucide-react'
import { fmt, toCents, apiGet, apiPost, apiPatch, apiDel } from '../api'
import { SAVINGS_SWATCH, RESERVE_SWATCH, colorForId } from '../theme'
import Modal from '../components/Modal'
import TransferModal from '../components/TransferModal'
import { Card, SectionLabel, Badge, PrimaryButton, IconButton, EmptyState, Segmented, Bar } from '../components/ui'

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

// Honesty over neatness: every bucket appears in the written legend — negative
// in red, zero shown plainly — even though the stacked bar itself can only
// render positive segments (a negative or zero width makes no visual sense).
function RealCashBreakdown({ savings, monthly_reserve, funds, total }) {
  const all = [
    { label: 'Savings', amount: savings.balance_cents, color: SAVINGS_SWATCH },
    { label: 'Monthly Reserve', amount: monthly_reserve.balance_cents, color: RESERVE_SWATCH },
    ...funds.map((f) => ({ label: f.name, amount: f.balance_cents, color: colorForId(f.id) })),
  ]
  if (all.length === 0) return null
  const positive = all.filter((seg) => seg.amount > 0)

  return (
    <div className="mt-4 pt-4 border-t border-line">
      {total > 0 && positive.length > 0 && (
        <div className="h-2 rounded-full bg-paper overflow-hidden flex gap-[2px]">
          {positive.map((seg) => (
            <div key={seg.label} className="h-full" style={{ width: `${(seg.amount / total) * 100}%`, background: seg.color }} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
        {all.map((seg) => (
          <div key={seg.label} className="flex items-start gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full shrink-0 mt-0.5" style={{ background: seg.color }} />
            <span className="text-ink-2 flex-1 min-w-0">{seg.label}</span>
            <span className={`tabular font-medium shrink-0 ${seg.amount < 0 ? 'text-critical' : 'text-ink-3'}`}>
              {c(seg.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthlyReserveCard({ mr, savings, onUpdate }) {
  const [toppingOff, setToppingOff] = useState(false)
  const [topOffError, setTopOffError] = useState('')
  const [topOffNote, setTopOffNote] = useState('')

  const shortfall = mr.target_cents > 0 ? Math.max(0, mr.target_cents - mr.balance_cents) : 0
  const atTarget = mr.target_cents > 0 && mr.balance_cents >= mr.target_cents

  async function handleTopOff() {
    setToppingOff(true)
    setTopOffError('')
    setTopOffNote('')
    try {
      const data = await apiPost('/monthly-reserve/top-off')
      if (data.status === 'already_at_target') {
        setTopOffNote('Reserve already at target')
      } else if (data.status === 'no_bills') {
        setTopOffNote('No Bills configured yet')
      }
      onUpdate()
    } catch (err) {
      setTopOffError(err.message || 'Top-off failed')
    } finally {
      setToppingOff(false)
    }
  }

  const pct = mr.target_cents > 0 ? Math.min(100, (mr.balance_cents / mr.target_cents) * 100) : 0

  return (
    <Card className="p-4 flex flex-col">
      <div className="flex items-center justify-between gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Monthly Reserve</p>
        {atTarget && <Badge tone="good">Funded</Badge>}
      </div>
      <p className="text-xl font-bold text-ink mt-1 tabular">{c(mr.balance_cents)}</p>
      {mr.target_cents > 0 ? (
        <>
          <p className="text-[11px] text-ink-3 mt-1">of {c(mr.target_cents)} target</p>
          <div className="mt-2">
            <Bar pct={pct} color={RESERVE_SWATCH} height={5} />
          </div>
        </>
      ) : (
        <p className="text-[11px] text-ink-3 mt-1">No Bills configured yet</p>
      )}
      {shortfall > 0 && (
        <button
          onClick={handleTopOff}
          disabled={toppingOff || savings.balance_cents < shortfall}
          className="mt-2.5 w-full text-xs font-semibold bg-accent text-white rounded-full py-2 disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {toppingOff ? 'Topping off…' : `Top Off ${c(shortfall)}`}
        </button>
      )}
      {topOffError && <p className="mt-2 text-[11px] text-critical">{topOffError}</p>}
      {topOffNote && <p className="mt-2 text-[11px] text-ink-3">{topOffNote}</p>}
    </Card>
  )
}

export default function FundsPage() {
  const navigate = useNavigate()
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [editFund, setEditFund] = useState(null)
  const [distributing, setDistributing] = useState(false)
  const [distributeResult, setDistributeResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await apiGet('/state')
      setState(data)
    } catch (err) {
      setLoadError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  async function handleCreate(data) {
    await apiPost('/funds/', data)
    await load()
  }

  async function handleUpdate(id, data) {
    await apiPatch(`/funds/${id}`, data)
    await load()
  }

  async function handleDelete(fund) {
    if (!confirm(`Delete "${fund.name}"? Its balance (${c(fund.balance_cents)}) will return to Savings.`)) return
    await apiDel(`/funds/${fund.id}`)
    await load()
  }

  async function handleDistribute() {
    setDistributing(true)
    setDistributeResult(null)
    try {
      const data = await apiPost('/funds/distribute')
      setDistributeResult(data)
      await load()
    } catch (err) {
      setDistributeResult({ error: err.message || 'Distribute failed' })
    } finally {
      setDistributing(false)
    }
  }

  async function handleTransfer(data) {
    await apiPost('/transfers/', data)
    await load()
  }

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

      {/* Real Cash — ranks #1 through size, not darkness */}
      <Card
        className="p-5 mb-3"
        style={{ background: 'linear-gradient(180deg, #eef6f2 0%, #ffffff 60%)' }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Real Cash</p>
        <p className="hero-figure text-5xl font-bold text-ink mt-1.5">{c(real_cash.balance_cents)}</p>
        <p className="text-xs text-ink-3 mt-2">Total across your bank account(s)</p>
        <RealCashBreakdown savings={savings} monthly_reserve={monthly_reserve} funds={funds} total={real_cash.balance_cents} />
      </Card>

      {/* Savings + Monthly Reserve — compact two-up */}
      <div className="grid grid-cols-2 gap-3 mb-3 items-stretch">
        <Card className="p-4 flex flex-col">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Savings</p>
          <p className="hero-figure text-xl font-bold text-ink mt-1">{c(savings.balance_cents)}</p>
          <p className="text-[11px] text-ink-3 mt-1">Default resting place</p>
          {/* Decorative rest-state bar — Savings has no target/ceiling to track
              progress against, but a quiet full bar keeps this card's rhythm
              matched to Monthly Reserve's, instead of trailing off into blank
              space below the microcopy. */}
          <div className="mt-auto pt-3">
            <div className="h-[5px] rounded-full" style={{ background: SAVINGS_SWATCH, opacity: 0.3 }} />
          </div>
        </Card>
        <MonthlyReserveCard mr={monthly_reserve} savings={savings} onUpdate={load} />
      </div>

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
              {distributeResult.status === 'no_contributions' && (
                <p>No funds have a monthly contribution set.</p>
              )}
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
          {funds.map((fund) => {
            const color = colorForId(fund.id)
            return (
              <Card
                key={fund.id}
                className="p-4 cursor-pointer active:scale-[0.99] transition-transform"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/funds/${fund.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/funds/${fund.id}`) }}
              >
                {/* Line 1: identity + balance */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                    {fund.balance_cents < 0 && <AlertTriangle size={13} className="text-critical shrink-0" />}
                    <p className="font-semibold text-ink">{fund.name}</p>
                  </div>
                  <p className={`text-lg font-bold shrink-0 tabular ${fund.balance_cents < 0 ? 'text-critical' : 'text-ink'}`}>{c(fund.balance_cents)}</p>
                </div>

                {/* Line 2: contribution + badges, actions */}
                <div className="flex items-center justify-between gap-2 mt-1.5 pl-5">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span className="text-xs text-ink-3 whitespace-nowrap">
                      {fund.monthly_contribution_cents > 0
                        ? `${c(fund.monthly_contribution_cents)}/mo`
                        : 'No contribution set'}
                    </span>
                    {fund.destination_type === 'transfer_out' && <Badge tone="accent">Transfer Out</Badge>}
                    {fund.balance_cents < 0 && <Badge tone="critical">Recovering</Badge>}
                  </div>
                  <div className="flex items-center shrink-0">
                    <IconButton onClick={(e) => { e.stopPropagation(); setEditFund(fund) }}><Pencil size={13} /></IconButton>
                    <IconButton onClick={(e) => { e.stopPropagation(); handleDelete(fund) }} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={13} /></IconButton>
                    <ChevronRight size={15} className="text-ink-3 ml-0.5" />
                  </div>
                </div>

                {fund.balance_cents < 0 && (
                  <p className="text-xs text-ink-3 mt-1 pl-5">
                    {fund.monthly_contribution_cents > 0
                      ? `At ${c(fund.monthly_contribution_cents)}/mo, back to $0 in ~${Math.ceil(Math.abs(fund.balance_cents) / fund.monthly_contribution_cents)} months`
                      : 'No contribution set — will not recover automatically'}
                  </p>
                )}
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
